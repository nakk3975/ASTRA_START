import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { D1CarryStore } from "../apps/sites-worker/index.ts";
import { CarryService } from "../packages/carry-core/src/service.ts";
import { spawn, assertCarry } from "../packages/carry-core/src/index.ts";
test("hosted HTTP adapter persists CAS commands in real SQLite using generated migration", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("drizzle/0000_abandoned_wolf_cub.sql", "utf8"));
  const binding = {
    prepare(sql: string) {
      let args: any[] = [];
      const q = {
        bind(...v: any[]) {
          args = v;
          return q;
        },
        async first<T>() {
          return (db.prepare(sql).get(...args) as T) ?? null;
        },
        async run() {
          const r = db.prepare(sql).run(...args);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return q;
    },
  };
  const env = {
    DB: binding,
    ASSETS: {
      async fetch() {
        return new Response("asset");
      },
    },
  };
  const call = async (
    action: string,
    body: any,
    origin = "https://game.test",
  ) => {
    const r = await worker.fetch(
      new Request(`https://game.test/api/carry/${action}`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );
    return { status: r.status, data: (await r.json()) as any };
  };
  try {
    assert.equal(
      (await call("create", { name: "A", planned: 1 }, "https://other.test"))
        .status,
      403,
    );
    const a = (await call("create", { name: "A", planned: 2, profile: "lab" }))
        .data,
      b = (await call("join", { name: "B", code: a.code })).data;
    assert.equal(a.transport, "http");
    const store = new D1CarryStore(binding),
      service = new CarryService(store);
    let item = "";
    await service.update(a.roomId, (s) => {
      for (const p of Object.values(s.world.players))
        p.pos = { x: -14, y: 0, z: 0 };
      item = spawn(s.world, "metal_scrap", { x: -13, y: 0, z: 0 }).id;
    });
    const commands = [a, b].map(() => ({
      id: crypto.randomUUID(),
      seq: 1,
      type: "INTERACT",
      target: item,
    }));
    const auth = (s: any) => ({
      id: s.roomId,
      member: s.member,
      token: s.token,
    });
    const replies = await Promise.all(
      [a, b].map((s, i) =>
        call("sync", {
          ...auth(s),
          input: { x: 0, z: 0, epoch: 1 },
          command: commands[i],
        }),
      ),
    );
    assert.equal(replies.filter((r) => r.data.result.ok).length, 1);
    const win = replies.findIndex((r) => r.data.result.ok),
      s = [a, b][win];
    const resumed = (await call("resume", auth(s))).data;
    assert.equal(
      (
        await call("sync", {
          ...auth(s),
          input: { x: 0, z: 0, epoch: 1 },
          command: commands[win],
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("sync", { ...auth(s), command: commands[win] })).status,
      400,
    );
    assert.equal(
      (
        await call("sync", {
          ...auth(s),
          input: { x: 0, z: 0, epoch: resumed.result },
          command: commands[win],
        })
      ).data.result.ok,
      true,
    );
    const saved = await store.get(a.roomId);
    assertCarry(saved!.world);
    assert.equal(
      Object.values(saved!.world.players).filter((p) => p.hand === item).length,
      1,
    );
  } finally {
    db.close();
  }
});
