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
const w = createCarryWorld("walk-campaign", "WALKTEST", 1, "campaign");
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
      assert.ok(++limit < 50, "movement stuck");
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
        m.type === def.machine && m.recipe === rid && !m.job && !m.input.length,
    ) ??
    Object.values(w.machines).find(
      (m) => m.type === def.machine && !m.job && !m.input.length,
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
    assert.ok(n < 400, "machine completion");
    step();
  }
  const id = machine.output.find((id) => !before.has(id))!;
  pick(id);
  return id;
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
      command("UPGRADE", { upgrade: "belts" });
      make("kit_straight");
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
  players: 1,
  firstInstallSeconds: Math.round(first),
  firstAutomationKitSeconds: Math.round(kitAt),
  completionSeconds: Math.round(w.time),
  walkingSeconds: Math.round(walking),
  stageCompletionSeconds: stageTimes.map(Math.round),
  commands,
  installed: w.sockets.filter((s) => s.item).length,
};
writeFileSync(
  "docs/carry/walking-campaign.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
