import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarryWorld,
  joinCarry,
  spawn,
  commandCarry,
  machinePort,
  tickCarry,
  assertCarry,
  automaticRecipe,
  type Kind,
} from "../packages/carry-core/src/index.ts";
const setup = () => {
  const w = createCarryWorld("auto", "AUTO", 1),
    p = joinCarry(w, "p", "p", 0),
    m = w.machines["starter-bench"];
  const insert = (kind: Kind) => {
    assert.equal(p.hand, null);
    const i = spawn(w, kind, machinePort(m), "hand", p.id);
    p.hand = i.id;
    p.pos = machinePort(m);
    const result = commandCarry(w, p.id, {
      id: crypto.randomUUID(),
      seq: p.lastSeq + 1,
      type: "INTERACT",
      target: `in:${m.id}`,
    });
    assertCarry(w);
    return { result, i };
  };
  return { w, p, m, insert };
};
test("zero-coin starter automatically changes ore to ingot to plate, without recipe commands", () => {
  const { w, p, m, insert } = setup();
  assert.ok(insert("metal_scrap").result.ok);
  tickCarry(w, 0.05);
  for (let n = 0; n < 220; n++) tickCarry(w, 0.05);
  const ingot = w.items[m.output[0]];
  assert.equal(ingot.kind, "ingot");
  p.pos = machinePort(m, true);
  assert.ok(
    commandCarry(w, p.id, {
      id: "pick",
      seq: p.lastSeq + 1,
      type: "INTERACT",
      target: ingot.id,
    }).ok,
  );
  p.pos = machinePort(m);
  assert.ok(
    commandCarry(w, p.id, {
      id: "put",
      seq: p.lastSeq + 1,
      type: "INTERACT",
      target: `in:${m.id}`,
    }).ok,
  );
  assert.equal(m.recipe, "press_plate");
  for (let n = 0; n < 220; n++) tickCarry(w, 0.05);
  assert.equal(w.items[m.output[0]].kind, "plate");
  assert.equal(w.economy.coins, 0);
  assertCarry(w);
});
test("compound inputs stay on the pending job and a rejected input stays in the hand", () => {
  const { w, p, m, insert } = setup();
  w.economy.xp = 100;
  Object.values(w.veins).forEach((v) => (v.unlocked = true));
  // A partially completed hull stage needs plate + polymer.
  w.sockets
    .filter((s) => s.stage === 0)
    .forEach((s) => {
      s.item = spawn(w, s.kind, s.pos, "installed", s.id).id;
    });
  assert.ok(insert("plate").result.ok);
  assert.equal(m.recipe, "assemble_hull");
  const wrong = insert("ingot");
  assert.equal(wrong.result.ok, false);
  assert.equal(p.hand, wrong.i.id);
  assert.equal(m.input.length, 1);
  assert.equal(m.recipe, "assemble_hull");
  wrong.i.state = "ground";
  wrong.i.owner = null;
  p.hand = null;
  assert.ok(insert("polymer").result.ok);
  tickCarry(w, 0.05);
  assert.equal(m.job?.recipe, "assemble_hull");
  assertCarry(w);
});
test("engine stage chooses plate first and then missing gear; automation never consumes rocket material on a bench", () => {
  const { w, m } = setup();
  w.economy.xp = 100;
  Object.values(w.veins).forEach((v) => (v.unlocked = true));
  w.sockets
    .filter((s) => s.stage < 2)
    .forEach((s) => {
      s.item = spawn(w, s.kind, s.pos, "installed", s.id).id;
    });
  assert.equal(automaticRecipe(w, m, "ingot"), "press_plate");
  for (let n = 0; n < 2; n++) spawn(w, "plate", m.pos);
  assert.equal(automaticRecipe(w, m, "ingot"), "cut_gear");
  w.economy.upgrades.push("belts");
  assert.equal(automaticRecipe(w, m, "plate"), "assemble_engine");
});

test("automation workbench can reach alternate kits and old partial bench jobs remain finishable", () => {
  const { w, m } = setup();
  w.economy.xp = 100;
  Object.values(w.veins).forEach((v) => (v.unlocked = true));
  w.economy.upgrades.push("belts");
  m.type = "workbench";
  assert.equal(automaticRecipe(w, m, "plate"), "kit_straight");
  spawn(w, "kit_straight", m.pos);
  assert.equal(automaticRecipe(w, m, "plate"), "kit_corner");
  m.type = "bench";
  m.recipe = "kit_crane";
  const old = spawn(w, "plate", machinePort(m), "input", m.id);
  m.input = [old.id];
  assert.equal(automaticRecipe(w, m, "gear"), "kit_crane");
});
