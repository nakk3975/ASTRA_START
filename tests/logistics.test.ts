import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { B, M, FP } from "../packages/content/src/index.ts";
import {
  createWorld,
  join,
  buffer,
  machineGeometry,
  add,
  plus,
  logistics,
  tick,
  assertInvariants,
  type World,
} from "../packages/game-core/src/index.ts";
function scenario() {
  const w = createWorld(randomUUID(), "test", "TEST", 1, "hash");
  join(w, randomUUID(), "작업자", 0);
  w.phase = "RUNNING";
  w.stages[0].completed = true;
  w.stages[1].completed = true;
  w.stage = 2;
  for (const [id, x, recipe] of [
    ["p", 11, "smelt_ingot"],
    ["a", 14, "press_plate"],
    ["b", 17, "press_plate"],
  ] as const) {
    w.machines[id] = {
      id,
      type: id === "p" ? "processor" : "fabricator",
      owner: null,
      geometry: machineGeometry(id, "processor", x, 5, 2),
      recipe,
      enabled: false,
      tier: 1,
      version: 0,
      paid: {},
      source: null,
      job: null,
    };
    w.inventories[id + ":in"] = buffer(id + ":in", 20);
    w.inventories[id + ":out"] = buffer(id + ":out", 20);
  }
  for (const dest of ["a", "b"])
    w.links[dest] = {
      id: dest,
      from: "p:out",
      to: dest + ":in",
      item: "ingot",
      version: 0,
      draining: false,
      credit: 40 * FP,
      paid: {},
    };
  return w;
}
test("source cursor alternates scarce cargo and destination reservations conserve stock", () => {
  const w = scenario();
  const winners: string[] = [];
  for (let i = 0; i < 8; i++) {
    add(w.inventories["p:out"], "ingot", 1);
    plus(w.ledger.generated, { ingot: 1 });
    for (const l of Object.values(w.links)) l.credit = 40 * FP;
    logistics(w);
    const c = Object.values(w.cargo).at(-1)!;
    winners.push(c.link);
    assertInvariants(w);
  }
  assert.deepEqual(winners, ["a", "b", "a", "b", "a", "b", "a", "b"]);
  assert.equal(Object.keys(w.cargo).length, 8);
});
test("inbound reservation excludes the final capacity and cargo is not instantly delivered", () => {
  const w = scenario();
  add(w.inventories["p:out"], "ingot", 2);
  add(w.inventories["a:in"], "ingot", 19);
  plus(w.ledger.generated, { ingot: 21 });
  w.links.b.to = "a:in";
  logistics(w);
  assert.equal(Object.keys(w.cargo).length, 1);
  assert.equal((w.inventories["a:in"] as any).counts.ingot, 19);
  assert.equal((w.inventories["p:out"] as any).counts.ingot, 1);
  assertInvariants(w);
  for (let i = 0; i < 50; i++)
    tick(w, { now: i * 50, wallNow: i * 50, inputs: {} });
  assert.equal((w.inventories["a:in"] as any).counts.ingot, 20);
  assert.equal(Object.keys(w.cargo).length, 0);
  assertInvariants(w);
});
test("automatic extractor generates raw material at configured cycle, output pauses at cap", () => {
  const w = scenario();
  w.stages[2].completed = true;
  w.stage = 3;
  const pad = M.source_zones[0].extractor_pads[0];
  w.machines.x = {
    id: "x",
    type: "extractor",
    owner: null,
    geometry: { ...pad, id: "x", kind: "extractor", solid: true },
    recipe: null,
    enabled: true,
    tier: 1,
    version: 0,
    paid: {},
    source: "metal_scrap",
    job: null,
  };
  w.inventories["x:in"] = buffer("x:in", 20);
  w.inventories["x:out"] = buffer("x:out", 20);
  for (let i = 0; i < 3000; i++)
    tick(w, { now: i * 50, wallNow: i * 50, inputs: {} });
  assert.equal((w.inventories["x:out"] as any).counts.metal_scrap, 20);
  assert.equal(w.ledger.generated.metal_scrap, 20);
  assert.equal(w.machines.x.job, null);
  assertInvariants(w);
});
