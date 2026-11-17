import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkshopPanel } from "../apps/web/src/carry/WorkshopPanel.tsx";
import {
  createCarryWorld,
  joinCarry,
  commandCarry,
  tickCarry,
  assertCarry,
  migrateCarry,
  veinUnlocked,
  veinPort,
  SOURCES,
  machinePort,
  MARKET,
  targets,
  walls,
  recipeAvailable,
  VEIN_UNLOCKS,
  researchCost,
  RULES,
  type Command,
  type OreKind,
} from "../packages/carry-core/src/index.ts";

function setup(planned = 1) {
  const w = createCarryWorld("quarry-test", "QUARRY", planned);
  const p = joinCarry(w, "p", "작업자", 0);
  const command = (type: Command["type"], data: Partial<Command> = {}) =>
    commandCarry(w, p.id, {
      id: crypto.randomUUID(),
      seq: p.lastSeq + 1,
      type,
      ...data,
    });
  return { w, p, command };
}
test("all 1–6-player campaigns start at zero with exactly one lowest-tier bench and only iron present", () => {
  for (let n = 1; n <= 6; n++) {
    const { w, p, command } = setup(n);
    assert.equal(w.economy.coins, 0);
    assert.equal(w.economy.earned, 0);
    const machines = Object.values(w.machines);
    assert.equal(machines.length, 1);
    assert.equal(machines[0].type, "bench");
    assert.equal(machines[0].tier, 0);
    assert.equal(command("BUY_MACHINE", { machine: "bench" }).ok, false);
    for (const src of SOURCES) {
      const open = src.kind === "metal_scrap";
      assert.equal(veinUnlocked(w, src.kind), open);
      p.pos = veinPort(src);
      assert.equal(
        targets(w, p).some((t) => t.id === `vein:${src.kind}`),
        open,
      );
      assert.equal(
        walls(w).some((r) => r.x === src.x && r.z === src.z),
        open,
      );
      if (!open)
        assert.equal(
          command("INTERACT", { target: `vein:${src.kind}` }).ok,
          false,
        );
    }
    assert.equal(recipeAvailable(w, "smelt_ingot"), true);
    assert.equal(recipeAvailable(w, "draw_wire"), false);
    assert.equal(recipeAvailable(w, "assemble_hull"), false);
    assertCarry(w);
  }
});
test("iron processing XP unlocks every ore without currency; duplicate unlocks are idempotent", () => {
  const { w, p, command } = setup(),
    bench = w.machines["starter-bench"];
  let produced = 0;
  function processIngot() {
    p.pos = veinPort(SOURCES[0]);
    assert.equal(command("INTERACT", { target: "vein:metal_scrap" }).ok, true);
    for (let tick = 0; p.mining; tick++) {
      assert.ok(tick < 40);
      tickCarry(w, 0.05);
    }
    p.pos = machinePort(bench);
    assert.equal(command("INTERACT", { target: `in:${bench.id}` }).ok, true);
    for (let tick = 0; !bench.output.length; tick++) {
      assert.ok(tick < 400);
      tickCarry(w, 0.05);
    }
    p.pos = machinePort(bench, true);
    assert.equal(command("INTERACT", { target: bench.output[0] }).ok, true);
    p.pos = {
      x: -15 + (produced % 8) * 1.2,
      y: 0,
      z: 5 + Math.floor(produced / 8) * 1.2,
    };
    p.facing = { x: 0, z: 1 };
    assert.equal(command("DROP").ok, true);
    assert.equal(w.economy.coins, 0);
    assertCarry(w);
    produced++;
  }
  assert.equal(command("UNLOCK_VEIN", { target: "plastic_scrap" }).ok, false);
  assert.equal(command("UNLOCK_VEIN", { target: "cable_scrap" }).ok, false);
  assert.equal(command("UPGRADE_VEIN", { target: "cable_scrap" }).ok, false);
  assert.equal(command("UNLOCK_VEIN", { target: "__proto__" }).ok, false);
  for (const kind of [
    "cable_scrap",
    "plastic_scrap",
    "energy_shard",
  ] as OreKind[]) {
    const spec = VEIN_UNLOCKS[kind],
      cost = researchCost(w, spec.cost);
    while (w.economy.coins < cost || w.economy.xp < spec.xp) {
      processIngot();
      assert.ok(produced < 40);
    }
    const before = w.economy.coins,
      xp = w.economy.xp;
    const cmd = {
      id: crypto.randomUUID(),
      seq: p.lastSeq + 1,
      type: "UNLOCK_VEIN" as const,
      target: kind,
    };
    assert.equal(commandCarry(w, p.id, cmd).ok, true);
    assert.equal(commandCarry(w, p.id, cmd).ok, true);
    assert.equal(w.economy.coins, before - cost);
    assert.equal(w.economy.xp, xp);
    assert.equal(veinUnlocked(w, kind), true);
    const restored = JSON.parse(JSON.stringify(w));
    migrateCarry(restored);
    assert.equal(JSON.stringify(restored), JSON.stringify(w));
  }
  assert.ok(recipeAvailable(w, "assemble_engine"));
  assertCarry(w);
});
test("unlocking an occupied ore footprint leaves currency and unlock state intact", () => {
  const { w, p, command } = setup();
  w.economy.coins = w.economy.earned = 100;
  w.economy.xp = 100;
  p.pos = { x: SOURCES[1].x, y: 0, z: SOURCES[1].z };
  const r = command("UNLOCK_VEIN", { target: "cable_scrap" });
  assert.equal(r.ok, false);
  assert.match(r.message, /옮겨/);
  assert.equal(w.economy.coins, 100);
  assert.equal(veinUnlocked(w, "cable_scrap"), false);
});
test("3.1 saves preserve installed equipment, all already-open ores, money and inventory on repeat migration", () => {
  const { w } = setup();
  w.rules = "quarry-3.1.0";
  w.economy.coins = w.economy.earned = 147;
  w.veins.cable_scrap!.level = 2;
  for (const v of Object.values(w.veins)) delete v.unlocked;
  const oldMachines = structuredClone(w.machines),
    money = structuredClone(w.economy);
  migrateCarry(w);
  const once = structuredClone(w);
  migrateCarry(w);
  assert.equal(w.rules, RULES);
  assert.deepEqual(w, once);
  assert.deepEqual(w.machines, oldMachines);
  assert.deepEqual(w.economy, money);
  assert.ok(SOURCES.every((s) => veinUnlocked(w, s.kind)));
  assert.equal(w.veins.cable_scrap!.level, 2);
  assertCarry(w);
});
test("vein menu shows the chain, free unlock requirement and missing XP", () => {
  const { w, p } = setup();
  const html = renderToStaticMarkup(
    React.createElement(WorkshopPanel, {
      world: w,
      player: p,
      initial: "veins",
      send: () => {},
    }),
  );
  assert.match(html, /철 → 구리 → 규석 → 석탄/);
  assert.match(html, /무료 해금.*12.*XP/s);
  assert.match(html, /12 XP가 필요합니다/);
  assert.match(html, /구리광석부터 해금/);
});
