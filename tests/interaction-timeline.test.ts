import test from "node:test";
import assert from "node:assert/strict";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
import {
  targets,
  type Command,
  type MoveFrame,
} from "../packages/carry-core/src/index.ts";
import { MotionSmoother } from "../apps/web/src/carry/motion.ts";
import { CarryConnection } from "../apps/web/src/carry/network.ts";

const command = (
  type: Command["type"],
  extra: Partial<Command> = {},
): Command => ({ id: crypto.randomUUID(), seq: 1, type, ...extra });

test("arrival prompt and immediate E use the visible position; authority replays the walk before mining", async () => {
  let now = 0;
  const svc = new CarryService(new MemoryCarryStore(), () => now);
  const s = await svc.create("arrival", 1);
  await svc.update(s.roomId, (row) => {
    row.world.players[s.member].pos = { x: -15.6, y: 0, z: -7 };
  });
  const w = (await svc.store.get(s.roomId))!.world;
  const before = structuredClone(w);
  const motion = new MotionSmoother();
  motion.receive(w, s.member, 0);
  motion.setInput({ x: -1, z: 0 }, 0);
  for (let f = 1; f <= 12; f++)
    motion.step(w, s.member, { x: -1, z: 0 }, 1 / 60, (f * 1000) / 60);
  motion.setInput({ x: 0, z: 0 }, 200);
  const p = motion.player(w, s.member);
  assert.ok(
    !targets(w, w.players[s.member]).length,
    "old snapshot cannot reach the ore",
  );
  assert.equal(targets(w, p)[0]?.id, "vein:metal_scrap");
  assert.deepEqual(
    p.facing,
    { x: -1, z: 0 },
    "release retains latest displayed facing",
  );
  assert.deepEqual(
    w,
    before,
    "display prediction cannot mutate authoritative state",
  );
  now = 200;
  const actionAfter = motion.checkpoint(now);
  const r = await svc.sync(
    s.roomId,
    s.member,
    s.token,
    {
      x: 0,
      z: 0,
      control: 2,
      epoch: s.world.players[s.member].epoch,
      frames: motion.packet(now, actionAfter),
      actionAfter,
    },
    command("INTERACT", { target: targets(w, p)[0].id }),
  );
  assert.equal(r.result?.ok, true);
  assert.deepEqual(r.world.players[s.member].facing, { x: -1, z: 0 });
  assert.equal(r.world.players[s.member].mining?.kind, "metal_scrap");
  assert.ok(Math.abs(r.world.players[s.member].pos.x - p.pos.x) < 1e-7);
});

test("an action waits for movement split across packets without consuming its command or coins", async () => {
  let now = 0;
  const svc = new CarryService(new MemoryCarryStore(), () => now);
  const s = await svc.create("split", 1);
  // These transport tests exercise a funded purchase, independently of new-game funds.
  await svc.update(s.roomId, (row) => {
    row.world.economy.coins = row.world.economy.earned = 80;
  });
  const frames: MoveFrame[] = Array.from({ length: 50 }, (_, i) => ({
    seq: i + 1,
    dt: 0.02,
    x: 1,
    z: 0,
  }));
  const cmd = command("BUY_MACHINE", { machine: "bench" });
  const input = {
    x: 0,
    z: 0,
    control: 2,
    epoch: s.world.players[s.member].epoch,
    actionAfter: 50,
  };
  // Initialize the real-time budget before accumulating a second of input.
  await svc.sync(s.roomId, s.member, s.token, { ...input, frames: [] });
  now = 1000;
  const a = await svc.sync(
    s.roomId,
    s.member,
    s.token,
    { ...input, frames: frames.slice(0, 40) },
    cmd,
  );
  assert.equal(a.result, null);
  assert.equal(a.world.players[s.member].motion?.ack, 40);
  assert.equal(a.world.players[s.member].lastSeq, 0);
  assert.equal(a.world.economy.coins, 80);
  const b = await svc.sync(
    s.roomId,
    s.member,
    s.token,
    { ...input, frames: frames.slice(40) },
    cmd,
  );
  assert.equal(b.result?.ok, true);
  assert.equal(b.world.economy.coins, 78);
  const c = await svc.sync(
    s.roomId,
    s.member,
    s.token,
    { ...input, frames: frames.slice(40) },
    cmd,
  );
  assert.equal(c.result?.id, b.result?.id);
  assert.equal(c.world.economy.coins, 78);
  assert.equal(
    Object.values(c.world.items).filter((i) => i.kind === "kit_bench").length,
    1,
  );
});

test("server time budget delays the action until its final frame and still rejects invalid barriers", async () => {
  let now = 0;
  const svc = new CarryService(new MemoryCarryStore(), () => now),
    s = await svc.create("budget", 1);
  // These transport tests exercise a funded purchase, independently of new-game funds.
  await svc.update(s.roomId, (row) => {
    row.world.economy.coins = row.world.economy.earned = 80;
  });
  const cmd = command("BUY_MACHINE", { machine: "bench" });
  const input = {
    x: 0,
    z: 0,
    control: 1,
    epoch: s.world.players[s.member].epoch,
    actionAfter: 20,
    frames: Array.from({ length: 20 }, (_, i) => ({
      seq: i + 1,
      dt: 0.05,
      x: 1,
      z: 0,
    })),
  };
  const a = await svc.sync(s.roomId, s.member, s.token, input, cmd);
  assert.equal(a.world.players[s.member].motion?.ack, 5);
  assert.equal(a.result, null);
  assert.equal(a.world.economy.coins, 80);
  now = 1000;
  const b = await svc.sync(s.roomId, s.member, s.token, input, cmd);
  assert.equal(b.result?.ok, true);
  assert.equal(b.world.players[s.member].motion?.ack, 20);
  await assert.rejects(() =>
    svc.sync(s.roomId, s.member, s.token, { ...input, actionAfter: -1 }, cmd),
  );
});

test("action checkpoint seals its interval and holds subsequent movement until the action is acknowledged", async () => {
  const svc = new CarryService(new MemoryCarryStore(), () => 0),
    s = await svc.create("boundary", 1);
  const m = new MotionSmoother();
  m.receive(s.world, s.member, 0);
  m.setInput({ x: 1, z: 0 }, 0);
  const boundary = m.checkpoint(30);
  const before = m.packet(30, boundary);
  m.step(s.world, s.member, { x: 1, z: 0 }, 0.02, 50);
  m.setInput({ x: -1, z: 0 }, 70);
  assert.deepEqual(m.packet(100, boundary), before);
  const after = m.packet(100);
  assert.ok(after.some((f) => f.seq > boundary));
  assert.ok(after.some((f) => f.x === -1));
});

test("E/placement commands get an expedited request even while a regular HTTP sync is pending", async () => {
  const svc = new CarryService(new MemoryCarryStore()),
    s = await svc.create("network", 1);
  const net = new CarryConnection();
  net.session = {
    roomId: s.roomId,
    member: s.member,
    token: s.token,
    code: s.code,
  };
  net.world = s.world;
  net.epoch = s.world.players[s.member].epoch;
  net.movement.receive(s.world, s.member, performance.now());
  net.stopped = false;
  const calls: any[] = [],
    responses: ((r: any) => void)[] = [];
  net.api = async (_action, data) => {
    calls.push(data);
    return new Promise((resolve) => responses.push(resolve));
  };
  const regular = net.sync();
  net.command("BUY_MACHINE", { machine: "bench" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].command.type, "BUY_MACHINE");
  assert.equal(calls[1].input.actionAfter, 0);
  assert.equal("pos" in calls[1].input, false);
  net.stopped = true;
  responses.forEach((resolve) => resolve({ world: s.world, revision: 0 }));
  await regular;
});

test("resuming clears old movement barriers while keeping command identity for deduplicated recovery", async () => {
  const svc = new CarryService(new MemoryCarryStore()),
    s = await svc.create("resume", 1);
  // These transport tests exercise a funded purchase, independently of new-game funds.
  await svc.update(s.roomId, (row) => {
    row.world.economy.coins = row.world.economy.earned = 80;
  });
  const net = new CarryConnection();
  net.session = {
    roomId: s.roomId,
    member: s.member,
    token: s.token,
    code: s.code,
  };
  net.epoch = s.world.players[s.member].epoch;
  net.world = s.world;
  net.movement.receive(s.world, s.member, performance.now());
  net.stopped = false;
  const requests: any[] = [],
    responses: ((r: any) => void)[] = [];
  net.api = async (_action, data) => {
    requests.push(data);
    return new Promise((resolve) => responses.push(resolve));
  };
  net.command("BUY_MACHINE", { machine: "bench" });
  const original = requests[0].command;
  const resumed = await svc.resume(s.roomId, s.member, s.token);
  net.generation++;
  net.accept(resumed);
  await Promise.resolve();
  const retry = net.sync(true);
  assert.equal(requests[1].command.id, original.id);
  assert.equal(requests[1].input.actionAfter, undefined);
  assert.equal(requests[1].input.epoch, resumed.result);
  const result = await svc.sync(
    s.roomId,
    s.member,
    s.token,
    requests[1].input,
    requests[1].command,
  );
  responses[1](result);
  await retry;
  assert.equal(net.pending.size, 0);
  responses[0]({ world: s.world, revision: 0 });
  await Promise.resolve();
  assert.equal(
    net.world?.economy.coins,
    78,
    "late previous-session response cannot undo the purchase",
  );
  net.stopped = true;
});
