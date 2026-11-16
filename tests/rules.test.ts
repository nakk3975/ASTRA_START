import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  B,
  M,
  R,
  FP,
  ITEMS,
  type Item,
  type Counts,
} from "../packages/content/src/index.ts";
import {
  createWorld,
  join,
  leave,
  recover,
  maintenance,
  command,
  tick,
  center,
  add,
  plus,
  count,
  assertInvariants,
  placement,
  machineGeometry,
  buffer,
  rocketFree,
  type World,
  type Runtime,
} from "../packages/game-core/src/index.ts";
import { parseCommand, safeShape } from "../packages/protocol/src/index.ts";
function setup(n = 1) {
  let w = createWorld(randomUUID(), "rules", "RULES123", n, "test");
  const rt: Runtime = { now: 0, wallNow: 0, inputs: {} };
  const members = Array.from(
    { length: n },
    (_, i) => join(w, randomUUID(), "작업자" + i, 0).id,
  );
  const cmd = (m: string, type: string, payload: any = {}) => {
    const r = command(
      w,
      m,
      {
        protocolVersion: R.protocol_version,
        roomId: w.id,
        commandId: randomUUID(),
        controllerEpoch: w.members[m].epoch,
        clientSeq: 1,
        minDurableVersion: w.version,
        type,
        payload,
      },
      rt,
    );
    w = r.world;
    return r;
  };
  for (const m of members) cmd(m, "READY_SET", { ready: true });
  cmd(members[0], "START_SESSION", { settingsRevision: 0 });
  return {
    get w() {
      return w;
    },
    rt,
    members,
    cmd,
    step(n = 1) {
      for (let k = 0; k < n; k++) {
        rt.now += 50;
        rt.wallNow += 50;
        for (const m of members)
          if (w.members[m].work)
            rt.inputs[m] = {
              dx: 0,
              dz: 0,
              seq: k,
              at: rt.now,
              hold: w.members[m].work!.id,
              holdAt: rt.now,
            };
        tick(w, rt);
      }
    },
  };
}
function seed(w: World, id: string, items: Counts) {
  for (const [i, n] of Object.entries(items)) {
    add(w.inventories[id], i as Item, n);
    plus(w.ledger.generated, { [i]: n });
  }
}
function unlock(w: World, n: number) {
  w.stage = n;
  for (let i = 0; i < n; i++) w.stages[i].completed = true;
}
test("T01 six actors compete for final shared item: one gain, five rejections", () => {
  const s = setup(6);
  seed(s.w, "shared_warehouse", { metal_scrap: 1 });
  for (const m of s.members)
    s.w.members[m].position = center(
      M.starter_entities[1].service_points[0].cell,
    );
  const results = s.members.map((m) =>
    s.cmd(m, "TRANSFER_ITEM", {
      from: "shared_warehouse",
      to: "bag:" + m,
      itemId: "metal_scrap",
      quantity: 1,
    }),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.filter((r) => r.error === "NOT_ENOUGH_ITEMS").length, 5);
  assert.equal(
    s.members.reduce(
      (n, m) => n + count(s.w.inventories["bag:" + m], "metal_scrap"),
      0,
    ),
    1,
  );
  assert.equal(count(s.w.inventories.shared_warehouse, "metal_scrap"), 0);
  assertInvariants(s.w);
});
test("T02 simultaneous footprint claims pay once and rollback losing costs", () => {
  const s = setup(6);
  unlock(s.w, 1);
  for (const m of s.members) {
    s.w.members[m].position = center({ x: 11, z: 7 });
    seed(s.w, "bag:" + m, B.machines.processor.paid_cost);
  }
  const before = s.members.map((m) =>
    JSON.stringify(s.w.inventories["bag:" + m]),
  );
  const results = s.members.map((m) =>
    s.cmd(m, "PLACE_MACHINE", {
      machineType: "processor",
      x: 11,
      z: 5,
      rotation: 2,
    }),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  for (let i = 1; i < 6; i++)
    assert.equal(
      JSON.stringify(s.w.inventories["bag:" + s.members[i]]),
      before[i],
    );
  assert.equal(
    Object.values(s.w.machines).filter((m) => m.type === "processor").length,
    1,
  );
  assertInvariants(s.w);
});
test("R04 R05 extractor MK2 has 2x work/power, ordinary MK2 1.5x, duplicate denied", () => {
  const s = setup(),
    m = s.members[0];
  unlock(s.w, 4);
  const pad = M.source_zones[0].extractor_pads[0];
  s.w.members[m].position = center(pad.service_points[0].cell);
  seed(s.w, "bag:" + m, B.machines.extractor.paid_cost);
  const place = s.cmd(m, "PLACE_MACHINE", {
    machineType: "extractor",
    x: pad.top_left.x,
    z: pad.top_left.z,
    rotation: 0,
  });
  assert.equal(place.error, undefined);
  const id = place.result.entityId!;
  seed(s.w, "bag:" + m, B.upgrades.extractor_mk2.cost);
  assert.equal(
    s.cmd(m, "UPGRADE_MACHINE", {
      entityId: id,
      upgradeId: "extractor_mk2",
      expectedEntityVersion: 0,
    }).error,
    undefined,
  );
  assert.equal(
    s.cmd(m, "UPGRADE_MACHINE", {
      entityId: id,
      upgradeId: "extractor_mk2",
      expectedEntityVersion: 1,
    }).error,
    "ALREADY_UPGRADED",
  );
  s.step(1200);
  assert.equal(s.w.power.demand, 0);
  assert.equal(count(s.w.inventories[id + ":out"], "metal_scrap"), 20);
  assert.equal(s.w.ledger.generated.metal_scrap, 20);
  assert.equal(
    B.upgrades.machine_mk2.work_rate_multiplier.numerator /
      B.upgrades.machine_mk2.work_rate_multiplier.denominator,
    1.5,
  );
  assertInvariants(s.w);
});
test("R07 actual inspections forbidden until M6 assembly and launch requires all three", () => {
  const s = setup(),
    m = s.members[0];
  unlock(s.w, 5);
  s.w.members[m].position = center(M.rocket_envelope.service_points[0].cell);
  assert.equal(
    s.cmd(m, "WORK_START", {
      kind: "INSPECTION",
      checkId: B.construction.inspection_ids[0],
    }).error,
    "INSPECTIONS_INCOMPLETE",
  );
  assert.equal(s.cmd(m, "PROPOSE_LAUNCH").error, "INSPECTIONS_INCOMPLETE");
  unlock(s.w, 6);
  for (const checkId of B.construction.inspection_ids) {
    assert.equal(
      s.cmd(m, "WORK_START", { kind: "INSPECTION", checkId }).error,
      undefined,
    );
    s.step(39);
    assert.equal(s.w.checks[checkId], false);
    s.step();
    assert.equal(s.w.checks[checkId], true);
  }
  assert.equal(s.cmd(m, "PROPOSE_LAUNCH").error, undefined);
});
test("R08 R17 vote/cancel/countdown never consumes more fuel and launched freezes", () => {
  const s = setup(2);
  unlock(s.w, 6);
  for (const k of Object.keys(s.w.checks)) s.w.checks[k] = true;
  seed(s.w, "shared_warehouse", { fuel_cell: 20 });
  s.cmd(s.members[0], "PROPOSE_LAUNCH");
  const vote = s.w.vote!.id;
  for (const m of s.members) s.cmd(m, "CAST_VOTE", { voteId: vote, yes: true });
  assert.equal(s.w.phase, "COUNTDOWN");
  assert.equal(
    s.cmd(s.members[0], "WORK_START", {
      kind: "GATHER",
      sourceId: "source_metal_scrap",
    }).error,
    "INVALID_ROOM_PHASE",
  );
  s.step(99);
  assert.equal(
    s.cmd(s.members[1], "CANCEL_LAUNCH", { attemptId: s.w.attempt }).error,
    undefined,
  );
  assert.equal(s.w.phase, "RUNNING");
  assert.equal(count(s.w.inventories.shared_warehouse, "fuel_cell"), 20);
  s.cmd(s.members[0], "PROPOSE_LAUNCH");
  const next = s.w.vote!.id;
  for (const m of s.members) s.cmd(m, "CAST_VOTE", { voteId: next, yes: true });
  s.step(100);
  assert.equal(s.w.phase, "LAUNCHED");
  const result = JSON.stringify(s.w.result),
    ticks = s.w.tick;
  s.step(200);
  assert.equal(s.w.tick, ticks);
  assert.equal(JSON.stringify(s.w.result), result);
  assert.equal(count(s.w.inventories.shared_warehouse, "fuel_cell"), 20);
});
test("R15 R19 owner consent and deletion rights are distinct from leader", () => {
  const s = setup(2),
    [owner, other] = s.members;
  assert.equal(s.cmd(other, "ROTATE_ROOM_CODE").error, "NOT_OWNER");
  assert.equal(
    s.cmd(owner, "DELETE_SAVED_ROOM", { version: s.w.version, code: s.w.code })
      .error,
    "ROOM_IN_USE",
  );
  const offer = s.cmd(owner, "TRANSFER_OWNERSHIP", { targetMemberId: other })
    .result.offerId;
  assert.equal(s.w.owner, owner);
  assert.equal(
    s.cmd(owner, "ACCEPT_OWNERSHIP", { offerId: offer }).error,
    "NOT_OWNER",
  );
  assert.equal(
    s.cmd(other, "ACCEPT_OWNERSHIP", { offerId: offer }).result.rotateRecovery,
    true,
  );
  assert.equal(s.w.owner, other);
  assert.equal(s.cmd(owner, "ROTATE_RECOVERY_KEY").error, "NOT_OWNER");
});
test("R16 manual pause survives last disconnect and rejoin", () => {
  const s = setup(),
    m = s.members[0],
    guest = s.w.members[m].guestId;
  s.cmd(m, "SET_ROOM_PAUSE", { paused: true });
  leave(s.w, m, 0, false);
  assert.deepEqual(s.w.pauses, ["MANUAL", "NO_CONNECTED_PLAYERS"]);
  join(s.w, guest, "복귀자", 100);
  assert.deepEqual(s.w.pauses, ["MANUAL"]);
  s.step(20);
  assert.equal(s.w.tick, "0");
  s.w.pauses.push("STORAGE_PENDING");
  s.cmd(m, "SET_ROOM_PAUSE", { paused: false });
  assert.deepEqual(s.w.pauses, ["STORAGE_PENDING"]);
});
test("T24 reserved seat rejects newcomer but permits same guest; expired inventory recovers once", () => {
  const s = setup(6),
    m = s.members[0],
    guest = s.w.members[m].guestId;
  seed(s.w, "bag:" + m, { metal_scrap: 10 });
  leave(s.w, m, 0, false);
  assert.throws(() => join(s.w, randomUUID(), "일곱째", 1), /ROOM_FULL/);
  join(s.w, guest, "재접속", 2);
  assert.equal(count(s.w.inventories["bag:" + m], "metal_scrap"), 10);
  leave(s.w, m, 3, false);
  maintenance(s.w, 30004);
  assert.equal(count(s.w.inventories["bag:" + m], "metal_scrap"), 0);
  const cr = Object.keys(s.w.crates);
  assert.equal(cr.length, 1);
  assert.equal(count(s.w.inventories[cr[0]], "metal_scrap"), 10);
  maintenance(s.w, 30005);
  assert.equal(count(s.w.inventories[cr[0]], "metal_scrap"), 10);
  assertInvariants(s.w);
});
test("T15 work channel reclaim returns WIP to local bench crate once", () => {
  const s = setup(),
    m = s.members[0],
    id = "channel:" + m;
  s.w.members[m].position = center(
    M.starter_entities[0].service_points[0].cell,
  );
  seed(s.w, id + ":in", { metal_scrap: 2 });
  s.cmd(m, "WORK_START", {
    kind: "MANUAL_CRAFT",
    channelId: id,
    recipeId: "smelt_ingot",
  });
  s.step();
  leave(s.w, m, 0, false);
  maintenance(s.w, 120001);
  assert.equal(s.w.machines[id], undefined);
  const crate = Object.keys(s.w.crates)[0];
  assert.equal(count(s.w.inventories[crate], "metal_scrap"), 2);
  assert.ok(crate.startsWith("crate:2:20"));
  maintenance(s.w, 240002);
  assert.equal(count(s.w.inventories[crate], "metal_scrap"), 2);
  assertInvariants(s.w);
});
test("R20 costs must come from carrier inventory; protected routes and crates block construction", () => {
  const s = setup(),
    m = s.members[0];
  unlock(s.w, 1);
  s.w.members[m].position = center({ x: 11, z: 7 });
  seed(s.w, "shared_warehouse", B.machines.processor.paid_cost);
  assert.equal(
    s.cmd(m, "PLACE_MACHINE", {
      machineType: "processor",
      x: 11,
      z: 5,
      rotation: 2,
    }).error,
    "NOT_ENOUGH_ITEMS",
  );
  assert.equal(
    placement(s.w, machineGeometry("g", "processor", 20, 15, 0)),
    "PROTECTED_REGION",
  );
  s.w.crates["crate:11:5"] = { x: 11, z: 5 };
  s.w.inventories["crate:11:5"] = buffer("crate:11:5", 1000);
  seed(s.w, "crate:11:5", { metal_scrap: 1 });
  assert.equal(
    placement(s.w, machineGeometry("g", "processor", 11, 5, 2)),
    "RECOVERY_CRATE_OCCUPIED",
  );
  s.w.members[m].position = center({ x: 11, z: 6 });
  assert.equal(
    s.cmd(m, "TAKE_MAX", {
      from: "crate:11:5",
      to: "bag:" + m,
      itemId: "metal_scrap",
      quantity: 1,
    }).error,
    undefined,
  );
  s.w.members[m].position = center({ x: 11, z: 7 });
  assert.equal(s.w.crates["crate:11:5"], undefined);
  assert.equal(
    placement(s.w, machineGeometry("g", "processor", 11, 5, 2)),
    null,
  );
});
test("T25 stale controller and future durable version rejected before economic changes", () => {
  const s = setup(),
    m = s.members[0];
  const c: any = {
    protocolVersion: 1,
    roomId: s.w.id,
    commandId: randomUUID(),
    controllerEpoch: 0,
    clientSeq: 1,
    minDurableVersion: "0",
    type: "SAVE_BARRIER",
    payload: {},
  };
  assert.equal(command(s.w, m, c, s.rt).error, "SESSION_REPLACED");
  c.controllerEpoch = s.w.members[m].epoch;
  c.minDurableVersion = "999";
  assert.equal(command(s.w, m, c, s.rt).error, "RESYNC_REQUIRED");
});
test("T29 strict input rejects role forgery, negative/nonfinite/fraction quantity and prototype keys", () => {
  const base = {
    protocolVersion: R.protocol_version,
    roomId: randomUUID(),
    commandId: randomUUID(),
    controllerEpoch: 1,
    clientSeq: 1,
    minDurableVersion: "0",
    type: "TRANSFER_ITEM",
    payload: {
      from: "shared_warehouse",
      to: "bag:member",
      itemId: "metal_scrap",
      quantity: 1,
    },
  };
  for (const quantity of [-1, NaN, Infinity, 0.5, 1001])
    assert.throws(() =>
      parseCommand({ ...base, payload: { ...base.payload, quantity } }),
    );
  assert.throws(() => parseCommand({ ...base, role: "owner" }));
  assert.equal(safeShape(JSON.parse('{"__proto__":{"owner":true}}')), false);
  assert.equal(safeShape({ x: Array(101).fill(0) }), false);
});
