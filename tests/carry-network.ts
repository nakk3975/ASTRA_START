import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "@colyseus/sdk";
import pg from "pg";
import { localDatabase } from "../scripts/local-db.ts";
import { CarryService } from "../packages/carry-core/src/service.ts";
import { PgCarryStore } from "../apps/server/src/carry/store.ts";
import { CarryRoom, bindCarry } from "../apps/server/src/carry/room.ts";
import { mountCarry } from "../apps/server/src/carry/routes.ts";
import {
  spawn,
  assertCarry,
  machinePort,
} from "../packages/carry-core/src/index.ts";
const directory = mkdtempSync(path.join(tmpdir(), "carry-qa-"));
const db = await localDatabase({ directory, port: 55439 });
let pool = new pg.Pool({ connectionString: db.url });
let store = new PgCarryStore(pool);
await store.migrate();
let svc = new CarryService(store);
bindCarry(svc);
const app = express();
app.use(express.json({ limit: "8kb" }));
mountCarry(app);
const http = createServer(app);
const server = new Server({
  transport: new WebSocketTransport({ server: http }),
  greet: false,
});
server.define("carry", CarryRoom);
await server.listen(0, "127.0.0.1");
const port = (http.address() as any).port,
  base = `http://127.0.0.1:${port}`;
const api = async (action: string, body: any) => {
  const res = await fetch(`${base}/api/carry/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const r = await res.json();
  if (!res.ok) throw Error(r.error);
  return r;
};
const guests: any[] = [],
  rooms: Room[] = [];
const worlds = new Map<number, any>();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, label: string) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (fn()) return;
    await delay(30);
  }
  throw Error("Timeout: " + label);
}
const auth = (g: any) => ({ id: g.roomId, member: g.member, token: g.token });
try {
  const first = await api("create", {
    name: "QA 1",
    planned: 6,
    profile: "lab",
  });
  guests.push(first);
  for (let i = 1; i < 6; i++)
    guests.push(await api("join", { name: `QA ${i + 1}`, code: first.code }));
  await assert.rejects(
    () => api("join", { name: "QA 7", code: first.code }),
    /가득/,
  );
  for (const [i, g] of guests.entries()) {
    const runtime = await api("runtime", auth(g));
    const room = await new Client(base.replace("http", "ws")).joinById(
      runtime.runtimeRoomId,
      { member: g.member, token: g.token },
    );
    rooms.push(room);
    for (const type of ["WORLD", "WELCOME", "ACK"])
      room.onMessage(type, (r) => worlds.set(i, r));
    room.onMessage("ERROR", () => {});
    room.onMessage("STORAGE_ERROR", () => {});
  }
  const heart = setInterval(
    () =>
      rooms.forEach((r) => {
        if (r.connection.isOpen) r.send("INPUT", { x: 0, z: 0 });
      }),
    140,
  );
  try {
    await until(() => worlds.size === 6, "six independent clients");
    assert.ok(
      [...worlds.values()].every(
        (r) =>
          Object.values(r.world.players).filter((p: any) => p.connected)
            .length === 6,
      ),
    );
    await svc.update(first.roomId, (s) => {
      s.world.players[first.member].pos = { x: -14, y: 0, z: 0 };
      s.world.players[guests[1].member].pos = { x: -14, y: 0, z: 0 };
      spawn(s.world, "metal_scrap", { x: -13, y: 0, z: 0 });
    });
    const fixture = (await store.get(first.roomId))!,
      item = Object.values(fixture.world.items).at(-1)!;
    const commands = guests
      .slice(0, 2)
      .map(() => ({
        id: crypto.randomUUID(),
        seq: 1,
        type: "INTERACT",
        target: item.id,
      }));
    for (let i = 0; i < 2; i++) rooms[i].send("COMMAND", commands[i]);
    await until(
      () =>
        [0, 1].every(
          (i) => worlds.get(i)?.world.players[guests[i].member].lastSeq === 1,
        ),
      "race acknowledgements",
    );
    const after = (await store.get(first.roomId))!;
    assert.equal(
      Object.values(after.world.players).filter((p) => p.hand === item.id)
        .length,
      1,
    );
    const winner = guests.findIndex(
      (g) => g.member === after.world.items[item.id].owner,
    );
    rooms[winner].send("COMMAND", commands[winner]);
    await delay(180);
    assertCarry((await store.get(first.roomId))!.world);
    // Use a separate actor for actual network movement, including stopped input.
    const moving = guests[2];
    const start = (await store.get(first.roomId))!.world.players[moving.member]
      .pos.x;
    for (let n = 0; n < 6; n++) {
      rooms[2].send("INPUT", { x: 1, z: 0 });
      await delay(100);
    }
    rooms[2].send("INPUT", { x: 0, z: 0 });
    await delay(200);
    assert.ok(
      (await store.get(first.roomId))!.world.players[moving.member].pos.x >
        start + 0.5,
    );
    await rooms[winner].leave();
    await until(
      () => worlds.get(5)?.world.items[item.id].state === "ground",
      "disconnect drop",
    );
    assert.equal(
      (await store.get(first.roomId))!.world.items[item.id].recovered,
      1,
    );
    // Job persistence + delayed receipt retry after SQL connection/service restart.
    await svc.update(first.roomId, (s) => {
      const m = s.world.machines["press-a"];
      const raw = spawn(
        s.world,
        "metal_scrap",
        machinePort(m),
        "processing",
        m.id,
      );
      m.job = { input: [raw.id], remaining: 2, recipe: "lab_plate" };
    });
    clearInterval(heart);
    await Promise.all(
      rooms.filter((r) => r.connection.isOpen).map((r) => r.leave()),
    );
    await delay(350);
    await server.gracefullyShutdown(false);
    await pool.end();
    await db.db.stop();
    const restarted = await localDatabase({ directory, port: 55439 });
    try {
      pool = new pg.Pool({ connectionString: restarted.url });
      store = new PgCarryStore(pool);
      svc = new CarryService(store);
      const restored = (await store.get(first.roomId))!;
      assert.ok(restored.world.machines["press-a"].job);
      assert.equal(restored.world.items[item.id].recovered, 1);
      assertCarry(restored.world);
      const resumed = await svc.resume(
        first.roomId,
        guests[winner].member,
        guests[winner].token,
      );
      const replay = await svc.sync(
        first.roomId,
        guests[winner].member,
        guests[winner].token,
        { x: 0, z: 0, epoch: resumed.result },
        commands[winner] as any,
      );
      assert.equal(replay.result?.ok, true);
      assert.equal(replay.world.players[guests[winner].member].hand, null);
      assertCarry(replay.world);
      console.log(
        JSON.stringify(
          {
            pass: true,
            realClients: 6,
            transport: "Colyseus WebSocket",
            storage: "PostgreSQL",
            checks: [
              "seventh guest rejected",
              "same-item pickup race",
              "actual network movement",
              "disconnect safe drop once",
              "SQL process restart preserves jobs and command receipts",
            ],
          },
          null,
          2,
        ),
      );
      await pool.end();
    } finally {
      await restarted.db.stop();
    }
  } finally {
    clearInterval(heart);
  }
} finally {
  await server.gracefullyShutdown(false).catch(() => {});
  await pool.end().catch(() => {});
  await db.db.stop();
}
