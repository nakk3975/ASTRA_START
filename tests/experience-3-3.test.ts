import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarryWorld,
  joinCarry,
  spawn,
  commandCarry,
  assertCarry,
  migrateCarry,
  recipeAvailable,
  machineCanRecipe,
  itemValue,
  tickCarry,
  RULES,
  type Receipt,
} from "../packages/carry-core/src/index.ts";
import {
  workProgress,
  progressText,
} from "../apps/web/src/carry/work-progress.ts";
import { ZOOM, wheelDistance } from "../apps/web/src/carry/zoom.ts";
import { CarryAudio, receiptCue } from "../apps/web/src/carry/audio.ts";

test("every basic rocket installation pays exactly one coin once, without stage bonuses", () => {
  const w = createCarryWorld("reward", "REWARD", 1, "lab"),
    p = joinCarry(w, "p", "p", 0);
  for (const socket of w.sockets) {
    const item = spawn(w, "plate", socket.pos, "hand", p.id);
    p.hand = item.id;
    p.pos = { ...socket.pos };
    const c = {
      id: crypto.randomUUID(),
      seq: p.lastSeq + 1,
      type: "INTERACT" as const,
      target: socket.id,
    };
    assert.equal(commandCarry(w, p.id, c).ok, true);
    const coins = w.economy.coins;
    assert.equal(commandCarry(w, p.id, c).ok, true);
    assert.equal(w.economy.coins, coins);
  }
  assert.equal(w.economy.coins, 4);
  assert.equal(w.economy.earned, 4);
  assertCarry(w);
});
test("higher material components pay more; placing or repacking equipment never generates reward", () => {
  const w = createCarryWorld("r", "R", 1),
    p = joinCarry(w, "p", "p", 0);
  assert.deepEqual(
    [
      "plate",
      "wire",
      "polymer",
      "hull_panel",
      "fuel_cell",
      "engine_part",
      "control_part",
    ].map((kind) => itemValue({ kind, quality: 0 } as any)),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(itemValue({ kind: "plate", quality: 2 } as any), 3);
  assert.equal(itemValue({ kind: "kit_bench", quality: 3 } as any), 0);
  const i = spawn(w, "plate", p.pos, "hand", p.id);
  p.hand = i.id;
  const c = { id: "old-sale", seq: 1, type: "SELL" as const };
  assert.equal(commandCarry(w, p.id, c).ok, false);
  assert.equal(i.state, "hand");
  assert.equal(w.economy.coins, 0);
  assertCarry(w);
});
test("essential crafting remains reachable with an empty wallet and a tier-zero bench", () => {
  const w = createCarryWorld("xp", "XP", 1),
    m = w.machines["starter-bench"];
  for (const v of Object.values(w.veins)) v.unlocked = true;
  assert.equal(recipeAvailable(w, "assemble_hull"), false);
  w.economy.xp = 24;
  assert.equal(recipeAvailable(w, "assemble_hull"), true);
  assert.equal(recipeAvailable(w, "assemble_engine"), false);
  w.economy.xp = 50;
  assert.equal(recipeAvailable(w, "assemble_engine"), true);
  for (const id of [
    "smelt_ingot",
    "press_plate",
    "assemble_hull",
    "assemble_engine",
    "assemble_control",
  ])
    assert.equal(machineCanRecipe(m, id), true);
  assert.equal(w.economy.coins, 0);
  assert.equal(m.tier, 0);
});
test("3.2 migration preserves wallet, machines, installed parts and locked ore state idempotently", () => {
  const w = createCarryWorld("old", "OLD", 1);
  w.rules = "quarry-3.2.0";
  w.economy.coins = 17;
  const before = structuredClone(w);
  migrateCarry(w);
  assert.equal(w.rules, RULES);
  assert.deepEqual(w.veins, before.veins);
  assert.deepEqual(w.machines, before.machines);
  assert.deepEqual(w.economy, before.economy);
  const once = structuredClone(w);
  migrateCarry(w);
  assert.deepEqual(w, once);
});
test("mining and processing gauges show authoritative duration, partial progress, completion and blocked output", () => {
  const w = createCarryWorld("gauge", "GAUGE", 1),
    p = joinCarry(w, "p", "p", 0),
    m = w.machines["starter-bench"];
  p.mining = { kind: "metal_scrap", remaining: 0.4 };
  m.job = { input: [], remaining: 2.5, recipe: "press_plate" };
  let rows = workProgress(w);
  assert.equal(rows[0].ratio, 0.5);
  assert.equal(rows[0].remaining, 0.4);
  const bar = rows.find((r) => r.id === m.id)!;
  assert.equal(bar.ratio, 0.5);
  assert.ok(Math.abs(bar.remaining - 2.5 / 0.55) < 1e-9);
  assert.match(progressText(bar), /4.5초 남음/);
  assert.ok(
    workProgress(w, 10)[0].remaining > 0,
    "client prediction cannot claim server completion",
  );
  m.job.remaining = 0;
  assert.equal(workProgress(w).find((r) => r.id === m.id)!.status, "blocked");
  m.job = null;
  const i = spawn(w, "plate", m.pos, "output", m.id);
  m.output = [i.id];
  assert.equal(workProgress(w).find((r) => r.id === m.id)!.status, "ready");
  p.mining = null;
  m.output = [];
  assert.equal(workProgress(w).length, 0);
});
test("wheel zoom handles both directions, delta modes, limits and invalid input", () => {
  assert.ok(wheelDistance(22, -100) < 22);
  assert.ok(wheelDistance(22, 100) > 22);
  assert.equal(wheelDistance(22, 3, 1), wheelDistance(22, 48, 0));
  let d = 22;
  for (let i = 0; i < 100; i++) d = wheelDistance(d, -100);
  assert.equal(d, ZOOM.min);
  for (let i = 0; i < 100; i++) d = wheelDistance(d, 100);
  assert.equal(d, ZOOM.max);
  assert.equal(wheelDistance(22, NaN), ZOOM.initial);
  assert.ok(32 / ZOOM.initial > 1.45);
});
test("audio classifies distinct actions and suppresses duplicate receipts and historical world events", () => {
  const receipt = (message: string, ok = true): Receipt => ({
    id: message,
    seq: 1,
    fingerprint: "",
    message,
    ok,
  });
  assert.equal(receiptCue(receipt("철판 들기")), "pickup");
  assert.equal(receiptCue(receipt("입력 받침대에 투입")), "input");
  assert.equal(receiptCue(receipt("내려놓기")), "drop");
  assert.equal(receiptCue(receipt("짧게 던지기")), "throw");
  assert.equal(receiptCue(receipt("안됨", false)), "error");
  const audio = new CarryAudio(),
    played: string[] = [];
  audio.play = (cue) => {
    played.push(cue);
  };
  const r = receipt("철판 들기");
  audio.ack(r);
  audio.ack(r);
  assert.deepEqual(played, ["pickup"]);
  const w = createCarryWorld("sound", "SOUND", 1);
  w.events = [{ time: 1, text: "철판 설치 +1 코인", item: "old" }];
  audio.observe(w, "p");
  assert.equal(played.length, 1);
  w.events.push({ time: 2, text: "철판 설치 +1 코인", item: "new" });
  audio.observe(w, "p");
  audio.observe(w, "p");
  assert.deepEqual(played, ["pickup", "install", "reward"]);
  w.phase = "LAUNCHED";
  audio.observe(w, "p");
  audio.observe(w, "p");
  assert.equal(played.filter((c) => c === "launch").length, 1);
});
