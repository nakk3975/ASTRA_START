import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarryWorld,
  joinCarry,
  commandCarry,
  tickCarry,
  spawn,
  assertCarry,
  migrateCarry,
  machinePort,
  machineCanRecipe,
  machineSpeed,
  carryCapacity,
  movementSpeed,
  researchCost,
  startingFunds,
  miningSeconds,
  railSeconds,
  itemValue,
  UPGRADES,
  CHARACTERS,
  MARKET,
  RULES,
  type Command,
  type World,
  type Kind,
} from "../packages/carry-core/src/index.ts";
import { writeFileSync } from "node:fs";
import { movePosition, floorHeight } from "../packages/carry-core/src/index.ts";
import { MotionSmoother } from "../apps/web/src/carry/motion.ts";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
const make = () => {
  const w = createCarryWorld("growth", "GROWTH", 1);
  joinCarry(w, "p", "A", 0);
  return w;
};
const cmd = (w: World, type: Command["type"], data: Partial<Command> = {}) =>
  commandCarry(w, "p", {
    id: crypto.randomUUID(),
    seq: w.players.p.lastSeq + 1,
    type,
    ...data,
  });
const rich = (w: World) => {
  w.economy.coins = 10000;
  w.economy.earned = 10000;
  w.economy.spent = 0;
  w.economy.xp = 10000;
};
const steps = (w: World, seconds: number) => {
  for (let n = 0; n < seconds * 20; n++) tickCarry(w, 0.05);
};
test("empty campaign starts with finite team funds; buy a real cheap crate and manually place rotated equipment", () => {
  const w = make(),
    p = w.players.p;
  assert.equal(w.economy.coins, 80);
  assert.equal(Object.keys(w.machines).length, 0);
  assert.equal(cmd(w, "BUY_MACHINE", { machine: "bench" }).ok, true);
  assert.equal(w.economy.coins, 40);
  const item = p.hand!;
  assert.equal(
    cmd(w, "PLACE_MACHINE", { machine: "bench", x: 15, z: 0, rotation: 0 }).ok,
    false,
  );
  assert.equal(p.hand, item);
  assert.equal(w.items[item].state, "hand");
  p.pos = { x: -10, y: 0, z: -4.5 };
  assert.equal(
    cmd(w, "PLACE_MACHINE", { machine: "bench", x: -10, z: -7, rotation: 1 })
      .ok,
    true,
  );
  const m = Object.values(w.machines)[0];
  assert.equal(m.tier, 0);
  assert.deepEqual(machinePort(m), { x: -10, y: 0, z: -8.6 });
  assert.equal(w.items[item].state, "consumed");
  assert.equal(m.recipe, "smelt_ingot");
  assertCarry(w);
});
test("tier upgrades cost once, unlock recipes gradually, and survive packing without duplication", () => {
  const w = make(),
    p = w.players.p;
  rich(w);
  cmd(w, "BUY_MACHINE", { machine: "bench" });
  p.pos = { x: -10, y: 0, z: -4.5 };
  cmd(w, "PLACE_MACHINE", { machine: "bench", x: -10, z: -7, rotation: 0 });
  let m = Object.values(w.machines)[0];
  assert.equal(machineCanRecipe(m, "assemble_engine"), false);
  assert.equal(machineCanRecipe(m, "assemble_hull"), false);
  p.pos = machinePort(m);
  const c = {
    id: crypto.randomUUID(),
    seq: p.lastSeq + 1,
    type: "UPGRADE_MACHINE" as const,
    target: m.id,
  };
  const before = w.economy.coins;
  assert.equal(commandCarry(w, "p", c).ok, true);
  assert.equal(commandCarry(w, "p", c).ok, true);
  assert.equal(w.economy.coins, before - 70);
  assert.equal(m.tier, 1);
  assert.equal(machineCanRecipe(m, "assemble_hull"), true);
  assert.equal(machineCanRecipe(m, "assemble_engine"), false);
  assert.equal(cmd(w, "UPGRADE_MACHINE", { target: m.id }).ok, true);
  assert.equal(machineCanRecipe(m, "assemble_engine"), true);
  assert.equal(cmd(w, "PACK_MACHINE", { target: m.id }).ok, true);
  assert.equal(Object.keys(w.machines).length, 0);
  p.pos = { x: -10, y: 0, z: -4.5 };
  assert.equal(
    cmd(w, "PLACE_MACHINE", { machine: "bench", x: -10, z: -7, rotation: 0 })
      .ok,
    true,
  );
  m = Object.values(w.machines)[0];
  assert.equal(m.tier, 2);
  assertCarry(w);
});
test("seven carry steps reach eight, speed caps at 30%, and branches do not skip their prerequisites", () => {
  const w = make(),
    p = w.players.p;
  rich(w);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "carry8" }).ok, false);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "rail1" }).ok, false);
  for (let n = 2; n <= 8; n++)
    assert.equal(cmd(w, "UPGRADE", { upgrade: `carry${n}` }).ok, true);
  assert.equal(carryCapacity(w), 8);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "carry9" }).ok, false);
  for (let n = 1; n <= 5; n++)
    assert.equal(cmd(w, "UPGRADE", { upgrade: `speed${n}` }).ok, true);
  assert.equal(movementSpeed(w, p), 3.5 * 1.3);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "speed6" }).ok, false);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "__proto__" }).ok, false);
  assertCarry(w);
});
test("processing gives XP, one-time sale or installation gives money; quality propagates conservatively", () => {
  const w = make(),
    p = w.players.p;
  rich(w);
  cmd(w, "BUY_MACHINE", { machine: "bench" });
  p.pos = { x: -10, y: 0, z: -4.5 };
  cmd(w, "PLACE_MACHINE", { machine: "bench", x: -10, z: -7, rotation: 0 });
  const m = Object.values(w.machines)[0],
    raw = spawn(w, "metal_scrap", machinePort(m), "input", m.id);
  raw.quality = 3;
  m.input.push(raw.id);
  const coins = w.economy.coins;
  steps(w, 12);
  assert.equal(w.economy.coins, coins);
  const i = w.items[m.output[0]];
  assert.equal(i.quality, 3);
  assert.equal(itemValue(i), 7);
  p.pos = machinePort(m, true);
  cmd(w, "INTERACT", { target: i.id });
  p.pos = { ...MARKET };
  const sale = {
    id: crypto.randomUUID(),
    seq: p.lastSeq + 1,
    type: "SELL" as const,
  };
  assert.equal(commandCarry(w, "p", sale).ok, true);
  commandCarry(w, "p", sale);
  assert.equal(w.economy.coins, coins + 7);
  assert.equal(i.state, "consumed");
  assert.equal(cmd(w, "SELL").ok, false);
  assertCarry(w);
});
test("veins upgrade independently without multiplying output; rail and tool progression stays bounded", () => {
  const w = make();
  rich(w);
  const old = miningSeconds(w, "metal_scrap");
  assert.equal(cmd(w, "UPGRADE_VEIN", { target: "metal_scrap" }).ok, true);
  assert.ok(miningSeconds(w, "metal_scrap") < old);
  assert.equal(miningSeconds(w, "plastic_scrap"), old);
  for (let n = 0; n < 3; n++) cmd(w, "UPGRADE_VEIN", { target: "metal_scrap" });
  assert.equal(w.veins.metal_scrap!.level, 4);
  assert.equal(cmd(w, "UPGRADE_VEIN", { target: "metal_scrap" }).ok, false);
  cmd(w, "UPGRADE", { upgrade: "belts" });
  for (let n = 1; n <= 4; n++) cmd(w, "UPGRADE", { upgrade: `rail${n}` });
  assert.equal(railSeconds(w), 0.9);
  assertCarry(w);
});
test("old progress migrates once, preserves money and equipment and does not grant start funds or old milestone bonuses", () => {
  const w = createCarryWorld("old", "OLD", 1, "lab");
  joinCarry(w, "p", "A", 0);
  w.rules = "mining-2.1.0";
  w.economy = {
    coins: 123,
    xp: 90,
    earned: 140,
    spent: 17,
    upgrades: ["carry3", "processing"],
  };
  delete (w as any).veins;
  delete (w as any).stageBonuses;
  for (const m of Object.values(w.machines)) delete (m as any).tier;
  const before = Object.keys(w.machines);
  migrateCarry(w);
  migrateCarry(w);
  assert.equal(w.rules, RULES);
  assert.equal(w.economy.coins, 123);
  assert.ok(w.economy.upgrades.includes("processing1"));
  assert.deepEqual(Object.keys(w.machines), before);
  assertCarry(w);
});
test("per-player avatar persists and unknown avatar IDs are rejected server-side", async () => {
  const store = new MemoryCarryStore(),
    svc = new CarryService(store, () => 100);
  const a = await svc.create("A", 2, "campaign", "worker-engineer"),
    b = await svc.join(a.code, "B", "worker-pilot");
  assert.equal(b.world.players[a.member].avatar, "worker-engineer");
  assert.equal(b.world.players[b.member].avatar, "worker-pilot");
  await assert.rejects(() => svc.join(a.code, "C", "invalid"));
  const restored = await svc.resume(a.roomId, a.member, a.token);
  assert.equal(restored.world.players[a.member].avatar, "worker-engineer");
});
test("1/2/4/6-player opening funds and research costs scale sublinearly with shared upgrades", () => {
  const rows = [1, 2, 4, 6].map((n) => {
    const w = createCarryWorld("scale", "SCALE", n);
    assert.equal(w.economy.coins, startingFunds(n));
    assert.equal(w.economy.coins, w.economy.earned);
    assert.ok(w.economy.coins >= 40);
    return [n, w.economy.coins, researchCost(w, 100)];
  });
  assert.deepEqual(rows, [
    [1, 80, 100],
    [2, 104, 115],
    [4, 152, 145],
    [6, 200, 175],
  ]);
});
test("local prediction and remote interpolation remain continuous under 100–230ms one-way delay", () => {
  const w = make(),
    p = w.players.p;
  p.pos = { x: -10, y: 0, z: 10 };
  const smooth = new MotionSmoother();
  let snapshot = structuredClone(w);
  smooth.receive(snapshot, "p", 0, 0);
  let x = p.pos.x,
    oldX = x,
    oldDisplay = x;
  const predicted: number[] = [],
    baseline: number[] = [],
    remote: number[] = [];
  let prevRemote = x;
  const packets: { at: number; delay: number; w: World }[] = [];
  const dt = 1 / 60;
  for (let frame = 1; frame <= 180; frame++) {
    const now = (frame * 1000) / 60;
    p.input = { x: 1, z: 0, at: w.time };
    tickCarry(w, dt);
    if (frame % 6 === 0) {
      const delay = [100, 160, 230, 180][(frame / 6) % 4];
      packets.push({ at: now + delay, delay, w: structuredClone(w) });
    }
    for (const packet of packets.filter((q) => q.at <= now)) {
      if (packet.w.time >= snapshot.time) {
        snapshot = packet.w;
        smooth.receive(snapshot, "p", now, packet.delay * 2);
      }
    }
    for (let n = packets.length - 1; n >= 0; n--)
      if (packets[n].at <= now) packets.splice(n, 1);
    const display = smooth.step(snapshot, "p", { x: 1, z: 0 }, dt, now);
    oldDisplay +=
      (snapshot.players.p.pos.x - oldDisplay) * (1 - Math.exp(-dt * 15));
    const q = smooth.remote(snapshot, "p", now);
    if (frame > 60) {
      predicted.push(display.x - x);
      baseline.push(oldDisplay - oldX);
      remote.push(Math.abs(q.x - prevRemote));
    }
    x = display.x;
    oldX = oldDisplay;
    prevRemote = q.x;
  }
  const cv = (a: number[]) => {
    const avg = a.reduce((n, x) => n + x, 0) / a.length;
    return (
      Math.sqrt(a.reduce((n, x) => n + (x - avg) ** 2, 0) / a.length) / avg
    );
  };
  writeFileSync(
    "docs/carry/evidence/growth-movement-cpu.json",
    JSON.stringify(
      {
        method:
          "60Hz deterministic CPU movement with 100–230ms one-way jitter; no GPU FPS claim",
        oldStepVariation: cv(baseline),
        newStepVariation: cv(predicted),
        maxPredictedStep: Math.max(...predicted),
        minPredictedStep: Math.min(...predicted),
        frames: 180,
      },
      null,
      2,
    ) + "\n",
  );
  assert.ok(
    cv(predicted) < cv(baseline) * 0.65,
    `jitter old=${cv(baseline)},new=${cv(predicted)}`,
  );
  assert.ok(Math.min(...predicted) > 0, "no repeated position stalls");
  assert.ok(Math.max(...predicted) < 0.12, "no large frame jumps");
});

test("ramp seam tolerates floating point noise, prediction respects walls, reverses and stops during outages", () => {
  const w = make(),
    p = w.players.p;
  p.pos = { x: 12, y: 1.2, z: -2.0000000000000004 };
  const next = movePosition(w, p, p.pos, { x: -1, z: 0 }, 0.05);
  assert.ok(next.x < 12);
  assert.equal(next.y, floorHeight(next.x, next.z));
  p.pos = { x: -17.7, y: 0, z: -7 };
  for (let n = 0; n < 100; n++)
    p.pos = movePosition(w, p, p.pos, { x: -1, z: 0 }, 0.016);
  assert.ok(p.pos.x >= -17.74, "ore wall prevents crossing");
  p.pos = { x: -10, y: 0, z: 10 };
  const smooth = new MotionSmoother();
  smooth.receive(w, "p", 0);
  const a = smooth.step(w, "p", { x: 1, z: 0 }, 0.016, 16);
  const b = smooth.step(w, "p", { x: -1, z: 0 }, 0.016, 32);
  assert.ok(b.x < a.x);
  const stop = smooth.step(w, "p", { x: 0, z: 0 }, 0.016, 48);
  assert.equal(stop.x, b.x);
  const stale = smooth.step(w, "p", { x: 1, z: 0 }, 0.016, 1000);
  assert.equal(stale.x, b.x);
});
