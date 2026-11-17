import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
import { MotionSmoother } from "../apps/web/src/carry/motion.ts";
import { CarryConnection } from "../apps/web/src/carry/network.ts";
import type { MovePacket, World } from "../packages/carry-core/src/index.ts";
import {
  migrateCarry,
  RULES,
  veinPort,
  SOURCES,
} from "../packages/carry-core/src/index.ts";
test("previous workshop saves retain progress and acknowledged movers can still mine", async () => {
  let now = 0;
  const svc = new CarryService(new MemoryCarryStore(), () => now),
    s = await svc.create("miner", 1);
  await svc.update(s.roomId, (row) => {
    row.world.players[s.member].pos = veinPort(SOURCES[0]);
    row.world.economy.coins = 321;
    row.world.economy.earned = 321;
    row.world.veins.metal_scrap!.level = 2;
  });
  const old = (await svc.store.get(s.roomId))!.world;
  old.rules = "workshop-3.0.0";
  const before = structuredClone(old);
  migrateCarry(old);
  migrateCarry(old);
  assert.equal(old.rules, RULES);
  assert.deepEqual(old.economy, before.economy);
  assert.deepEqual(old.veins, before.veins);
  assert.deepEqual(old.players, before.players);
  const epoch = s.world.players[s.member].epoch,
    input = { x: 0, z: 0, epoch, control: 0, frames: [] };
  const mining = await svc.sync(s.roomId, s.member, s.token, input, {
    id: crypto.randomUUID(),
    seq: 1,
    type: "INTERACT",
    target: "vein:metal_scrap",
  });
  assert.equal(mining.result!.ok, true);
  now = 1000;
  const mined = await svc.sync(s.roomId, s.member, s.token, input);
  const p = mined.world.players[s.member];
  assert.ok(p.hand);
  assert.equal(mined.world.items[p.hand!].kind, "metal_scrap");
  assert.equal(mined.world.items[p.hand!].quality, 2);
  assert.equal(p.motion!.ack, 0);
  assert.equal(mined.world.economy.coins, 321);
});
test("sequenced HTTP input stops exactly at release through jitter, reversals and out-of-order replies", async () => {
  let now = 0;
  const service = new CarryService(new MemoryCarryStore(), () => now),
    s = await service.create("movement", 1);
  // A clear real aisle, starting spawn; no client position supplied to authority.
  const smooth = new MotionSmoother();
  let snapshot = s.world,
    revision = -1;
  const member = s.member,
    epoch = s.world.players[member].epoch;
  smooth.receive(snapshot, member, 0);
  let control = 0,
    input = { x: 0, z: 0 },
    last = { ...snapshot.players[member].pos };
  const outgoing: { at: number; input: MovePacket }[] = [],
    incoming: { at: number; value: any }[] = [];
  let sent = 0,
    maxDrift = 0,
    stopAt = last,
    maxStep = 0;
  const samples: any[] = [];
  const transmit = () => {
    const n = sent++;
    outgoing.push({
      at: now + [90, 190, 70, 150][n % 4],
      input: { ...input, epoch, control, frames: smooth.packet(now) },
    });
  };
  for (let frame = 0; frame <= 300; frame++) {
    now = (frame * 1000) / 60;
    for (const req of outgoing.filter((r) => r.at <= now)) {
      const value = await service.sync(s.roomId, member, s.token, req.input);
      incoming.push({
        at: now + [110, 60, 180, 90][Math.round(req.at) % 4],
        value,
      });
    }
    for (let n = outgoing.length - 1; n >= 0; n--)
      if (outgoing[n].at <= now) outgoing.splice(n, 1);
    for (const r of incoming.filter((r) => r.at <= now)) {
      if (r.value.revision > revision) {
        snapshot = r.value.world;
        revision = r.value.revision;
        smooth.receive(snapshot, member, now);
      }
    }
    for (let n = incoming.length - 1; n >= 0; n--)
      if (incoming[n].at <= now) incoming.splice(n, 1);
    const change =
      frame === 12
        ? { x: 1, z: 0 }
        : frame === 54
          ? { x: 0, z: 0 }
          : frame === 90
            ? { x: -1, z: 0 }
            : frame === 120
              ? { x: 0, z: 0 }
              : frame === 156
                ? { x: 0, z: 1 }
                : frame === 198
                  ? { x: 0, z: 0 }
                  : null;
    if (change) {
      smooth.setInput(change, now);
      input = change;
      control++;
      transmit();
    }
    const pos = smooth.step(snapshot, member, input, 1 / 60, now);
    if ([54, 120, 198].includes(frame)) stopAt = pos;
    if (
      (frame > 54 && frame < 90) ||
      (frame > 120 && frame < 156) ||
      frame > 198
    )
      maxDrift = Math.max(
        maxDrift,
        Math.hypot(pos.x - stopAt.x, pos.z - stopAt.z),
      );
    maxStep = Math.max(maxStep, Math.hypot(pos.x - last.x, pos.z - last.z));
    last = pos;
    samples.push({ frame, x: pos.x, z: pos.z });
    if (frame % 6 === 0) transmit();
  }
  const row = await service.store.get(s.roomId);
  const authoritative = row!.world.players[member].pos;
  assert.ok(maxDrift < 1e-7, `post-release drift ${maxDrift}`);
  assert.ok(maxStep < 0.1, `frame jump ${maxStep}`);
  assert.ok(
    samples[92].x < samples[91].x,
    "reversal responds without a second stop",
  );
  assert.ok(
    Math.hypot(last.x - authoritative.x, last.z - authoritative.z) < 1e-6,
    "drained inputs exactly agree with authority",
  );
  writeFileSync(
    "docs/carry/evidence/quarry-movement.json",
    JSON.stringify(
      {
        pass: true,
        method:
          "full CarryService HTTP replay with 70–190ms request and 60–180ms response jitter, out-of-order messages, three start/stop periods and reversal",
        frames: 301,
        maxReleaseDrift: maxDrift,
        maxFrameStep: maxStep,
        finalPositionError: Math.hypot(
          last.x - authoritative.x,
          last.z - authoritative.z,
        ),
        gpu: false,
      },
      null,
      2,
    ) + "\n",
  );
});
test("duplicate and late movement cannot coast, replay, override stop or bypass server duration budget", async () => {
  let now = 0;
  const svc = new CarryService(new MemoryCarryStore(), () => now),
    s = await svc.create("p", 1),
    epoch = s.world.players[s.member].epoch;
  const frames = Array.from({ length: 40 }, (_, n) => ({
    seq: n + 1,
    dt: 0.05,
    x: 1,
    z: 0,
  }));
  const a = await svc.sync(s.roomId, s.member, s.token, {
    x: 0,
    z: 0,
    epoch,
    control: 2,
    frames,
  });
  const start = s.world.players[s.member].pos.x;
  assert.ok(a.world.players[s.member].pos.x - start <= 3.5 * 0.25 + 1e-6);
  const b = await svc.sync(s.roomId, s.member, s.token, {
    x: 1,
    z: 0,
    epoch,
    control: 1,
    frames,
  });
  assert.equal(b.world.players[s.member].input.x, 0);
  assert.equal(
    b.world.players[s.member].pos.x,
    a.world.players[s.member].pos.x,
  );
  now = 1000;
  const c = await svc.pulse(s.roomId);
  assert.equal(
    c.world.players[s.member].pos.x,
    a.world.players[s.member].pos.x,
    "pulse never integrates an old velocity",
  );
  await assert.rejects(() =>
    svc.sync(s.roomId, s.member, s.token, {
      x: 1,
      z: 0,
      epoch,
      control: 3,
      frames: [{ seq: 6, dt: 1, x: 1, z: 0 }],
    }),
  );
  const gap = await svc.sync(s.roomId, s.member, s.token, {
    x: 0,
    z: 0,
    epoch,
    control: 4,
    frames: [{ seq: 500, dt: 0.05, x: 1, z: 0 }],
  });
  assert.equal(gap.world.players[s.member].motion!.ack, 5);
  const resumed = await svc.resume(s.roomId, s.member, s.token);
  await assert.rejects(() =>
    svc.sync(s.roomId, s.member, s.token, {
      x: 1,
      z: 0,
      epoch,
      control: 5,
      frames: [],
    }),
  );
  assert.equal(resumed.world.players[s.member].motion, undefined);
});
test("keyup transmits an expedited zero input while an HTTP request is still pending", async () => {
  const svc = new CarryService(new MemoryCarryStore()),
    s = await svc.create("client", 1),
    net = new CarryConnection();
  net.session = {
    roomId: s.roomId,
    member: s.member,
    token: s.token,
    code: s.code,
  };
  net.world = s.world;
  net.epoch = s.world.players[s.member].epoch;
  net.stopped = false;
  net.movement.receive(s.world, s.member, performance.now());
  const calls: any[] = [];
  const pending: ((v: any) => void)[] = [];
  net.api = async (_a, data) => {
    calls.push(data);
    return new Promise((r) => pending.push(r));
  };
  net.setInput({ x: 1, z: 0 });
  net.setInput({ x: 0, z: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input.x, 0);
  assert.ok(calls[1].input.control > calls[0].input.control);
  net.stopped = true;
  for (const resolve of pending) resolve({ world: s.world, revision: 0 });
  await Promise.resolve();
});
