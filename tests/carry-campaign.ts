import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  createCarryWorld,
  joinCarry,
  commandCarry,
  setInput,
  tickCarry,
  assertCarry,
  currentStage,
  recipe,
  RECIPES,
  ITEM,
  CFG,
  machinePort,
  machineCanRecipe,
  MACHINE_UPGRADE_COST,
  MACHINE_UPGRADE_XP,
  researchCost,
  MARKET,
  startingFunds,
  VEIN_UNLOCKS,
  veinUnlocked,
  UPGRADES,
  type OreKind,
  validFloor,
  reachable,
  floorHeight,
  SOURCES,
  veinPort,
  type Kind,
  type V3,
  type Command,
} from "../packages/carry-core/src/index.ts";
// One deterministic walking actor, no spawn/teleport/stock cheats. This is not a human playtime study.
const planned = Number(process.argv[2] ?? 1);
const w = createCarryWorld("walk-campaign", "WALKTEST", planned, "campaign");
const p = joinCarry(w, "walker", "경로 검증", 0);
let commands = 0,
  walking = 0,
  first = 0,
  kitAt = 0;
function command(type: Command["type"], extra: Partial<Command> = {}) {
  const r = commandCarry(w, p.id, {
    id: crypto.randomUUID(),
    seq: ++commands,
    type,
    ...extra,
  });
  assert.ok(r.ok, r.message);
  assertCarry(w);
  return r;
}
function step(dt = 0.05) {
  tickCarry(w, dt);
}
function go(target: V3) {
  if (
    reachable(w, p.pos, target) &&
    Math.hypot(p.pos.x - target.x, p.pos.z - target.z) < 1
  )
    return;
  const grid = (v: V3) => [Math.round(v.x * 2), Math.round(v.z * 2)],
    key = (x: number, z: number) => `${x},${z}`;
  const start = grid(p.pos),
    queue = [start],
    seen = new Map<string, string | null>([
      [key(...(start as [number, number])), null],
    ]);
  let end: string | undefined;
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head],
      at = { x: x / 2, y: floorHeight(x / 2, z / 2), z: z / 2 };
    if (
      reachable(w, at, target) &&
      Math.hypot(at.x - target.x, at.z - target.z) < 1
    ) {
      end = key(x, z);
      break;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        nz = z + dz,
        k = key(nx, nz);
      if (seen.has(k)) continue;
      const next = { x: nx / 2, y: floorHeight(nx / 2, nz / 2), z: nz / 2 };
      if (!validFloor(w, next, CFG.radius, at)) continue;
      seen.set(k, key(x, z));
      queue.push([nx, nz]);
    }
  }
  assert.ok(
    end,
    `No route to ${JSON.stringify(target)} from ${JSON.stringify(p.pos)}`,
  );
  const points: V3[] = [];
  for (let k: string | null = end; k; k = seen.get(k) ?? null) {
    const [x, z] = k.split(",").map(Number);
    points.unshift({ x: x / 2, y: floorHeight(x / 2, z / 2), z: z / 2 });
  }
  for (const a of points) {
    let limit = 0;
    while (Math.hypot(a.x - p.pos.x, a.z - p.pos.z) > 0.005) {
      assert.ok(
        ++limit < 50,
        `movement stuck from ${JSON.stringify(p.pos)} toward ${JSON.stringify(a)} target ${JSON.stringify(target)} hand ${p.hand}`,
      );
      const dx = a.x - p.pos.x,
        dz = a.z - p.pos.z,
        d = Math.hypot(dx, dz),
        speed =
          CFG.speed * (p.hand && ITEM[w.items[p.hand].kind].heavy ? 0.8 : 1),
        dt = Math.min(0.05, d / speed);
      setInput(w, p.id, dx / d, dz / d);
      step(dt);
      walking += dt;
    }
  }
  setInput(w, p.id, 0, 0);
  assertCarry(w);
}
function pick(id: string) {
  go(w.items[id].pos);
  command("INTERACT", { target: id });
}
let dropSlot = 0;
function stash() {
  // Explicit physical staging in the clear south-west aisle.
  const id = p.hand!;
  const n = dropSlot++ % 10;
  go({ x: -15 + (n % 5) * 1.2, y: 0, z: 9.4 + Math.floor(n / 5) * 1.1 });
  for (const [x, z] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]) {
    setInput(w, p.id, x, z);
    setInput(w, p.id, 0, 0);
    const r = commandCarry(w, p.id, {
      id: crypto.randomUUID(),
      seq: ++commands,
      type: "DROP",
    });
    if (r.ok) {
      assertCarry(w);
      return id;
    }
  }
  throw Error("No staging position");
}
function make(kind: Kind): string {
  const r = Object.entries(RECIPES).find(([, r]) => r.output === kind);
  if (!r) {
    const src = SOURCES.find((s) => s.kind === kind);
    assert.ok(src, "ore source");
    unlock(kind as OreKind);
    go(veinPort(src));
    command("INTERACT", { target: `vein:${kind}` });
    while (p.mining) step();
    assert.ok(p.hand);
    return p.hand;
  }
  const [rid, def] = r,
    staged: string[] = [];
  for (const [input, n] of Object.entries(def.input))
    for (let k = 0; k < n; k++) {
      make(input as Kind);
      staged.push(stash());
    }
  const machine =
    Object.values(w.machines).find(
      (m) =>
        machineCanRecipe(m, rid) &&
        m.recipe === rid &&
        !m.job &&
        !m.input.length,
    ) ??
    Object.values(w.machines).find(
      (m) => machineCanRecipe(m, rid) && !m.job && !m.input.length,
    );
  assert.ok(machine, "available recipe machine");
  go(machinePort(machine));
  if (machine.recipe !== rid)
    command("RECIPE", { target: machine.id, recipe: rid });
  for (const id of staged) {
    pick(id);
    go(machinePort(machine));
    command("INTERACT", { target: `in:${machine.id}` });
  }
  const before = new Set(machine.output);
  go(machinePort(machine, true));
  for (let n = 0; !machine.output.some((id) => !before.has(id)); n++) {
    assert.ok(n < 800, "machine completion");
    step();
  }
  const id = machine.output.find((id) => !before.has(id))!;
  pick(id);
  return id;
}
// Real fresh start: no granted money, items or extra machinery.
assert.equal(Object.keys(w.machines).length, 1);
assert.equal(w.economy.coins, 0);
assert.equal(w.economy.coins, startingFunds(planned));
assert.deepEqual(
  SOURCES.filter((s) => veinUnlocked(w, s.kind)).map((s) => s.kind),
  ["metal_scrap"],
);
const bench = w.machines["starter-bench"];
const starterAt = w.time;
let extraPractice = 0;
const unlockTimes: { kind: string; seconds: number; cost: number }[] = [];
function earn(coins: number, xp = 0) {
  assert.ok(
    w.economy.coins >= coins,
    "installation income must cover optional purchases",
  );
  while (w.economy.xp < xp) {
    make("plate");
    stash();
    assert.ok(++extraPractice < 30);
  }
}
function unlock(kind: OreKind) {
  if (veinUnlocked(w, kind)) return;
  const spec = VEIN_UNLOCKS[kind];
  if (spec.requires) unlock(spec.requires);
  const cost = researchCost(w, spec.cost);
  earn(cost, spec.xp);
  command("UNLOCK_VEIN", { target: kind });
  unlockTimes.push({ kind, seconds: Math.round(w.time), cost });
}
function improve(tier: number) {
  while (bench.tier < tier) {
    earn(
      researchCost(w, MACHINE_UPGRADE_COST[bench.tier]),
      MACHINE_UPGRADE_XP[bench.tier],
    );
    go(machinePort(bench));
    command("UPGRADE_MACHINE", { target: bench.id });
  }
}
const stageTimes: number[] = [];
while (currentStage(w) !== -1) {
  const stage = currentStage(w),
    socket = w.sockets.find((s) => s.stage === stage && !s.item)!;
  make(socket.kind);
  go(socket.pos);
  command("INTERACT", { target: socket.id });
  first ||= w.time;
  if (currentStage(w) !== stage) {
    stageTimes.push(w.time);
    if (stage === 0) {
      earn(2);
      command("BUY_MACHINE", { machine: "bench" });
      go({ x: -6, y: 0, z: -2.5 });
      command("PLACE_MACHINE", { machine: "bench", x: -6, z: 0, rotation: 0 });
      const bought = Object.values(w.machines).find((m) => m.id !== bench.id)!;
      go(machinePort(bought));
      command("PACK_MACHINE", { target: bought.id });
      go({ x: -6, y: 0, z: -2.5 });
      command("PLACE_MACHINE", { machine: "bench", x: -6, z: 0, rotation: 0 });
    }
    if (stage === 1) {
      improve(1);
      earn(researchCost(w, UPGRADES.belts.cost), UPGRADES.belts.xp);
      command("UPGRADE", { upgrade: "belts" });
      earn(1);
      command("BUY_DEVICE", { device: "straight" });
      kitAt = w.time;
      stash();
    }
  }
}
go({ x: 14, y: 1.2, z: 4 });
command("LAUNCH");
assert.equal(w.phase, "LAUNCHED");
assertCarry(w);
const report = {
  pass: true,
  method:
    "single deterministic walking actor; no spawning, teleporting or inventory shortcuts",
  actors: 1,
  planned,
  initialCoins: 0,
  initialBasicMachines: 1,
  unlockTimes,
  purchasePackReinstall: true,
  starterAtSeconds: Math.round(starterAt),
  extraPractice,
  sales: 0,
  coinsAtLaunch: w.economy.coins,
  xpAtLaunch: w.economy.xp,
  firstInstallSeconds: Math.round(first),
  firstAutomationKitSeconds: Math.round(kitAt),
  completionSeconds: Math.round(w.time),
  walkingSeconds: Math.round(walking),
  stageCompletionSeconds: stageTimes.map(Math.round),
  commands,
  installed: w.sockets.filter((s) => s.item).length,
};
writeFileSync(
  `docs/carry/evidence/progression-3.3-campaign-${planned}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
