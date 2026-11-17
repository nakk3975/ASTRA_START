import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarryWorld,
  joinCarry,
  spawn,
  commandCarry,
  tickCarry,
  setInput,
  leaveCarry,
  assertCarry,
  currentStage,
  deviceEnds,
  machinePort,
  floorHeight,
  ITEM,
  SOURCES,
  veinPort,
  hands,
  carryCapacity,
  migrateCarry,
  RULES,
  placementReason,
  type World,
  type Command,
} from "../packages/carry-core/src/index.ts";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
const world = (profile: "lab" | "campaign" = "lab") => {
  const w = createCarryWorld("test", "CODE1234", 1, profile);
  joinCarry(w, "p", "작업자", 0);
  return w;
};
const cmd = (
  w: World,
  type: Command["type"],
  extra: Partial<Command> = {},
  id = "p",
) =>
  commandCarry(w, id, {
    id: crypto.randomUUID(),
    seq: w.players[id].lastSeq + 1,
    type,
    ...extra,
  });
const steps = (w: World, n: number) => {
  for (let t = 0; t < n * 20; t++) tickCarry(w, 0.05);
  assertCarry(w);
};
test("single carry pickup-processing-output-install is physical, exclusive and idempotent", () => {
  const w = world(),
    p = w.players.p,
    m = w.machines["press-a"];
  p.pos = machinePort(m);
  const raw = spawn(w, "metal_scrap", { x: p.pos.x - 0.5, y: 0, z: p.pos.z });
  const c = {
    id: crypto.randomUUID(),
    seq: 1,
    type: "INTERACT" as const,
    target: raw.id,
  };
  assert.equal(commandCarry(w, "p", c).ok, true);
  assert.equal(commandCarry(w, "p", c).ok, true);
  assert.equal(raw.state, "hand");
  assert.equal(p.hand, raw.id);
  assert.equal(cmd(w, "INTERACT", { target: `in:${m.id}` }).ok, true);
  steps(w, 4.2);
  assert.equal(raw.state, "consumed");
  assert.equal(m.output.length, 1);
  const plate = w.items[m.output[0]];
  assert.equal(plate.kind, "plate");
  assert.notEqual(plate.id, raw.id);
  p.pos = machinePort(m, true);
  assert.equal(cmd(w, "INTERACT", { target: plate.id }).ok, true);
  p.pos = { x: 13, y: 1.2, z: -4.2 };
  assert.equal(cmd(w, "INTERACT", { target: w.sockets[0].id }).ok, true);
  assert.equal(plate.state, "installed");
  assert.equal(p.hand, null);
  assert.equal(w.sockets.filter((s) => s.item).length, 1);
  assertCarry(w);
});
test("two players racing for one object get exactly one owner", () => {
  const w = world();
  joinCarry(w, "q", "동료", 0);
  w.players.p.pos = w.players.q.pos = { x: -14, y: 0, z: 0 };
  const i = spawn(w, "metal_scrap", { x: -13, y: 0, z: 0 });
  const results = ["p", "q"].map((id) =>
    cmd(w, "INTERACT", { target: i.id }, id),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assertCarry(w);
});
test("reach, wall occlusion, one hand and wrong socket do not change ownership", () => {
  const w = world(),
    p = w.players.p;
  p.pos = { x: -9.6, y: 0, z: 0 };
  const far = spawn(w, "metal_scrap", { x: 4, y: 0, z: 0 }),
    wall = spawn(w, "metal_scrap", { x: -6.4, y: 0, z: 0 });
  assert.equal(cmd(w, "INTERACT", { target: far.id }).ok, false);
  assert.equal(cmd(w, "INTERACT", { target: wall.id }).ok, false);
  const i = spawn(w, "cable_scrap", { x: -10, y: 0, z: 0 });
  assert.equal(cmd(w, "INTERACT", { target: i.id }).ok, true);
  assert.equal(cmd(w, "INTERACT", { target: wall.id }).ok, false);
  p.pos = { x: 13, y: 1.2, z: -4.2 };
  assert.equal(cmd(w, "INTERACT", { target: w.sockets[0].id }).ok, false);
  assert.equal(p.hand, i.id);
  assertCarry(w);
});
test("drop and short throw return a real recoverable object; thrown hits never feed a machine", () => {
  const w = world(),
    p = w.players.p;
  p.pos = { x: -14, y: 0, z: 0 };
  const i = spawn(w, "metal_scrap", { x: -13.5, y: 0, z: 0 });
  cmd(w, "INTERACT", { target: i.id });
  assert.equal(cmd(w, "THROW").ok, true);
  assert.equal(i.state, "air");
  steps(w, 2);
  assert.equal(i.state, "ground");
  assert.ok(i.pos.x < -9.3);
  assert.equal(w.machines["press-b"].input.length, 0);
  p.pos = { ...i.pos, x: i.pos.x - 0.7 };
  assert.equal(cmd(w, "INTERACT", { target: i.id }).ok, true);
  assert.equal(cmd(w, "DROP").ok, true);
  assert.equal(i.state, "ground");
  assertCarry(w);
});
test("heavy hand is 80 percent speed, players pass each other, ramp height changes and pad cliffs block", () => {
  const w = world();
  joinCarry(w, "q", "동료", 0);
  const p = w.players.p,
    q = w.players.q;
  p.pos = { x: 7.7, y: 0, z: 0 };
  q.pos = { ...p.pos };
  const i = spawn(w, "metal_scrap", p.pos, "hand", p.id);
  p.hand = i.id;
  setInput(w, "p", 1, 0);
  setInput(w, "q", 1, 0);
  tickCarry(w, 0.1);
  assert.ok(Math.abs((p.pos.x - 7.7) / (q.pos.x - 7.7) - 0.8) < 1e-8);
  for (let n = 0; n < 40; n++) {
    setInput(w, "q", 1, 0);
    tickCarry(w, 0.05);
  }
  assert.ok(q.pos.x > 12 && q.pos.y === 1.2);
  p.pos = { x: 11.9, y: 0, z: 5 };
  for (let n = 0; n < 20; n++) {
    setInput(w, "p", 1, 0);
    tickCarry(w, 0.05);
  }
  assert.ok(p.pos.x < 12);
  assertCarry(w);
});
test("full output stalls without consuming extra input and resumes exactly once when freed", () => {
  const w = world(),
    m = w.machines["press-a"];
  for (let n = 0; n < 3; n++) {
    const i = spawn(w, "plate", machinePort(m, true), "output", m.id);
    m.output.push(i.id);
  }
  const raw = spawn(w, "metal_scrap", machinePort(m), "input", m.id);
  m.input.push(raw.id);
  steps(w, 10);
  assert.equal(raw.state, "input");
  assert.equal(m.job, null);
  const old = w.items[m.output.shift()!];
  old.state = "ground";
  old.owner = null;
  old.pos = { x: -12, y: 0, z: 10 };
  steps(w, 4.2);
  assert.equal(raw.state, "consumed");
  assert.equal(m.output.length, 3);
  steps(w, 10);
  assert.equal(m.output.length, 3);
  assertCarry(w);
});
test("disconnect and reconnect preserve machine jobs and drop hand once, including save reload", () => {
  let w = world();
  const p = w.players.p,
    i = spawn(w, "gear", p.pos, "hand", p.id);
  p.hand = i.id;
  leaveCarry(w, "p");
  leaveCarry(w, "p");
  assert.equal(i.recovered, 1);
  assert.equal(i.state, "ground");
  w = JSON.parse(JSON.stringify(w));
  joinCarry(w, "p", "작업자", 0);
  assert.equal(w.players.p.hand, null);
  assertCarry(w);
});
test("automation moves the same ID and retains it when blocked; crane pickup is protected", () => {
  const w = world();
  w.devices.a = {
    id: "a",
    type: "straight",
    pos: { x: -12, y: 0, z: 4 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  w.devices.b = {
    id: "b",
    type: "tray",
    pos: { x: -10.6, y: 0, z: 4 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  const i = spawn(w, "plate", w.devices.a.pos, "device", "a");
  w.devices.a.item = i.id;
  steps(w, 2);
  assert.equal(w.devices.b.item, i.id);
  assert.equal(i.owner, "b");
  assert.equal(w.devices.a.item, null);
  const c = (w.devices.c = {
    id: "c",
    type: "crane" as const,
    pos: { x: -12, y: 0, z: 8 },
    rotation: 0,
    item: i.id,
    progress: 0,
  });
  w.devices.b.item = null;
  i.owner = "c";
  i.pos = { ...deviceEnds(c).from };
  w.players.p.pos = { ...i.pos };
  assert.equal(cmd(w, "INTERACT", { target: i.id }).ok, false);
  steps(w, 5);
  assert.equal(c.item, i.id);
  assert.equal(c.progress, 1);
  assertCarry(w);
});
test("kit consumption is atomic and invalid/cancelled placement does not spend it", () => {
  const w = world(),
    p = w.players.p;
  p.pos = { x: -13, y: 0, z: 4 };
  const i = spawn(w, "kit_straight", p.pos, "hand", p.id);
  p.hand = i.id;
  assert.equal(
    cmd(w, "PLACE", { device: "crane", x: -12, z: 4, rotation: 0 }).ok,
    false,
  );
  assert.equal(p.hand, i.id);
  assert.equal(
    cmd(w, "PLACE", { device: "straight", x: 14, z: 0, rotation: 0 }).ok,
    false,
  );
  assert.equal(p.hand, i.id);
  const c = {
    id: crypto.randomUUID(),
    seq: p.lastSeq + 1,
    type: "PLACE" as const,
    device: "straight" as const,
    x: -12,
    z: 4,
    rotation: 0,
  };
  assert.equal(commandCarry(w, "p", c).ok, true);
  commandCarry(w, "p", c);
  assert.equal(Object.keys(w.devices).length, 1);
  assert.equal(i.state, "consumed");
  assertCarry(w);
});
test("CAS service serializes competing clients and keeps receipts across restart", async () => {
  let now = 1000;
  const store = new MemoryCarryStore(),
    svc = new CarryService(store, () => now);
  const s = await svc.create("하나", 1, "lab");
  const second = await svc.join(s.code, "둘");
  await svc.update(s.roomId, (row) => {
    row.world.players[s.member].pos = { x: -14, y: 0, z: 0 };
    row.world.players[second.member].pos = { x: -14, y: 0, z: 0 };
    spawn(row.world, "metal_scrap", { x: -13, y: 0, z: 0 });
  });
  const row = await store.get(s.roomId),
    item = Object.values(row!.world.items).at(-1)!;
  const commands = [s, second].map((sess) => ({
    sess,
    c: {
      id: crypto.randomUUID(),
      seq: 1,
      type: "INTERACT" as const,
      target: item.id,
    },
  }));
  const replies = await Promise.all(
    commands.map(({ sess, c }) =>
      svc.sync(s.roomId, sess.member, sess.token, { x: 0, z: 0, epoch: 1 }, c),
    ),
  );
  assert.equal(replies.filter((r) => r.result?.ok).length, 1);
  const winner = commands[replies.findIndex((r) => r.result?.ok)];
  const restarted = new CarryService(store, () => now);
  const again = await restarted.sync(
    s.roomId,
    winner.sess.member,
    winner.sess.token,
    { x: 0, z: 0, epoch: 1 },
    winner.c,
  );
  assert.equal(again.result?.ok, true);
  assertCarry(again.world);
  now += 13000;
  await restarted.pulse(s.roomId);
  const after = (await store.get(s.roomId))!.world;
  assert.equal(after.items[item.id].state, "ground");
  assert.equal(after.items[item.id].recovered, 1);
});
test("planned 1/2/4/6 player goals are frozen and all sockets stay on reachable platform floor", () => {
  const counts = [];
  for (const planned of [1, 2, 4, 6]) {
    const w = createCarryWorld("fixed", "FIXED", planned, "campaign");
    const before = JSON.stringify(w.sockets);
    for (let n = 0; n < 6; n++) joinCarry(w, String(n), "P", 0);
    leaveCarry(w, "1");
    joinCarry(w, "1", "P", 0);
    assert.equal(JSON.stringify(w.sockets), before);
    for (const s of w.sockets) {
      assert.equal(s.pos.y, floorHeight(s.pos.x, s.pos.z));
      assert.ok(s.pos.x < 16);
    }
    counts.push(w.sockets.length);
  }
  assert.deepEqual(counts, [16, 24, 39, 47]);
});
test("corner changes direction, reversed belt blocks handoff, and blocked output retains ID", () => {
  const w = world();
  w.devices.a = {
    id: "a",
    type: "corner",
    pos: { x: -12, y: 0, z: 4 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  w.devices.b = {
    id: "b",
    type: "straight",
    pos: { x: -12, y: 0, z: 5.4 },
    rotation: 3,
    item: null,
    progress: 0,
  };
  const i = spawn(w, "plate", w.devices.a.pos, "device", "a");
  w.devices.a.item = i.id;
  steps(w, 3);
  assert.equal(i.owner, "a");
  assert.equal(i.pos.z, 5.4);
  w.devices.b.rotation = 1;
  steps(w, 0.1);
  assert.equal(i.owner, "b");
  steps(w, 3);
  assert.equal(i.owner, "b");
  assert.equal(w.devices.b.item, i.id);
  assertCarry(w);
});
test("out-of-bounds throw recovers same ID with an explicit recovery event", () => {
  const w = world();
  const i = spawn(w, "gear", { x: 500, y: -5, z: 500 }, "air");
  steps(w, 0.1);
  assert.equal(i.state, "ground");
  assert.equal(i.recovered, 1);
  assert.ok(w.events.some((e) => e.item === i.id));
  assertCarry(w);
});
test("old receipt eviction cannot replay an installation or bypass launch prerequisites", () => {
  const w = world();
  const first = {
    id: crypto.randomUUID(),
    seq: 1,
    type: "PING" as const,
    x: 0,
    z: 0,
  };
  commandCarry(w, "p", first);
  for (let n = 2; n < 140; n++)
    commandCarry(w, "p", {
      id: crypto.randomUUID(),
      seq: n,
      type: "PING",
      x: 0,
      z: 0,
    });
  assert.throws(() => commandCarry(w, "p", first), /순번/);
  assert.equal(cmd(w, "LAUNCH").ok, false);
  assert.equal(w.phase, "WORKING");
  assertCarry(w);
});
test("ore begins in veins, quick mining yields one item into a free carry slot and never passive floor loot", () => {
  const w = world(),
    p = w.players.p;
  assert.equal(Object.keys(w.items).length, 0);
  steps(w, 30);
  assert.equal(Object.keys(w.items).length, 0);
  p.pos = veinPort(SOURCES[0]);
  assert.equal(cmd(w, "INTERACT", { target: "vein:metal_scrap" }).ok, true);
  assert.equal(p.hand, null);
  steps(w, 0.9);
  assert.equal(hands(p).length, 1);
  assert.equal(w.items[p.hand!].kind, "metal_scrap");
  assert.equal(w.economy.xp, 1);
  assert.equal(cmd(w, "INTERACT", { target: "vein:metal_scrap" }).ok, false);
  assertCarry(w);
});
test("shared upgrades require XP, money and 1→2→3 sequence; duplicate buy charges once; disconnect drops every ID", () => {
  const w = world("campaign"),
    p = w.players.p;
  w.economy = { coins: 100, xp: 100, earned: 100, spent: 0, upgrades: [] };
  assert.equal(cmd(w, "UPGRADE", { upgrade: "carry3" }).ok, false);
  const c = {
    id: crypto.randomUUID(),
    seq: p.lastSeq + 1,
    type: "UPGRADE" as const,
    upgrade: "carry2" as const,
  };
  assert.equal(commandCarry(w, p.id, c).ok, true);
  commandCarry(w, p.id, c);
  assert.equal(w.economy.coins, 82);
  assert.equal(carryCapacity(w), 2);
  assert.equal(cmd(w, "UPGRADE", { upgrade: "carry3" }).ok, true);
  assert.equal(carryCapacity(w), 3);
  p.pos = veinPort(SOURCES[0]);
  for (let n = 0; n < 3; n++) {
    cmd(w, "INTERACT", { target: "vein:metal_scrap" });
    steps(w, 0.9);
  }
  const ids = hands(p);
  assert.equal(ids.length, 3);
  cmd(w, "SELECT_HAND", { target: ids[2] });
  assert.equal(p.hand, ids[2]);
  leaveCarry(w, p.id);
  leaveCarry(w, p.id);
  for (const id of ids) {
    assert.equal(w.items[id].state, "ground");
    assert.equal(w.items[id].recovered, 1);
  }
  assertCarry(w);
});
test("advanced crafting pays more, full output grants no duplicate rewards, and old carry saves migrate without deleting items", () => {
  const w = world(),
    m = w.machines["press-a"];
  const i = spawn(w, "metal_scrap", machinePort(m), "input", m.id);
  m.input.push(i.id);
  steps(w, 4.2);
  assert.equal(w.economy.coins, 0);
  assert.equal(w.economy.xp, 4);
  const earned = w.economy.earned;
  steps(w, 10);
  assert.equal(w.economy.earned, earned);
  const ids = Object.keys(w.items);
  w.rules = "carry-2.0.0";
  delete (w as any).economy;
  for (const p of Object.values(w.players)) {
    delete (p as any).extraHands;
    delete (p as any).mining;
  }
  migrateCarry(w);
  assert.equal(w.rules, RULES);
  assert.deepEqual(Object.keys(w.items), ids);
  assertCarry(w);
});
test("automated mining→belt→machine→crane→installer conserves actual item IDs end to end", () => {
  const w = world(),
    m = w.machines["press-a"];
  m.pos = { x: -12, y: 0, z: -7 };
  w.sockets[0].pos = { x: -6.7, y: 0, z: -7 };
  w.devices.mine = {
    id: "mine",
    type: "miner",
    pos: { x: -17, y: 0, z: -7 },
    rotation: 0,
    item: null,
    progress: 0,
    source: "metal_scrap",
  };
  w.devices.belt = {
    id: "belt",
    type: "straight",
    pos: { x: -15.2, y: 0, z: -7 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  w.devices.crane = {
    id: "crane",
    type: "crane",
    pos: { x: -9, y: 0, z: -7 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  w.devices.installer = {
    id: "installer",
    type: "installer",
    pos: { x: -7.6, y: 0, z: -7 },
    rotation: 0,
    item: null,
    progress: 0,
  };
  steps(w, 20);
  assert.ok(w.sockets[0].item);
  const installed = w.items[w.sockets[0].item!];
  assert.equal(installed.kind, "plate");
  assert.equal(installed.state, "installed");
  assert.equal(installed.owner, w.sockets[0].id);
  assert.ok(
    Object.values(w.items).some(
      (i) => i.kind === "metal_scrap" && i.state === "consumed",
    ),
  );
  assert.ok(w.economy.earned >= 4);
  assertCarry(w);
});

test("purchased-equipment layout fixture: ore→ingot→plate→ramp→installation runs hands-free with legal equipment placements", () => {
  const w = world("campaign"),
    p = w.players.p;
  w.machines = {}; // Explicit automation layout fixture.
  Object.assign(
    w.machines,
    createCarryWorld("fixture", "FIXTURE", 1, "lab").machines,
  );
  w.machines["press-a"].recipe = "smelt_ingot";
  w.economy.upgrades = ["belts", "mining", "crane", "installer"];
  const original = JSON.stringify({ machines: w.machines, sockets: w.sockets });
  const points: [string, number, number, number][] = [
    ["miner", -17, -7, 1],
    ["straight", -17, -5.6, 1],
    ["corner", -17, -4.2, 5],
    ...[-15.4875, -13.975, -12.4625].map(
      (x) => ["straight", x, -4.2, 0] as [string, number, number, number],
    ),
    ["corner", -10.95, -4.2, 4],
    ["straight", -10.95, -5.6, 3],
    ["corner", -10.95, -7, 3],
    ["crane", -5.2, -7, 0],
    ["straight", -3.8, -7, 0],
    ["crane", 1.8, -7, 0],
    ["corner", 3.2, -7, 0],
    ["straight", 3.2, -5.6, 1],
    ["corner", 3.2, -4.2, 5],
    ...[4.6, 6, 7.4].map(
      (x) => ["straight", x, -4.2, 0] as [string, number, number, number],
    ),
    ["corner", 8.8, -4.2, 0],
    ["straight", 8.8, -2.8, 1],
    ["corner", 8.8, -1.4, 5],
    ["straight", 10.2, -1.4, 0],
    ["straight", 11.6, -1.4, 0],
    ["corner", 13, -1.8, 4],
    ["corner", 13, -3.6, 3],
    ["installer", 14.4, -3.6, 0],
  ];
  // Only setup is accelerated: bought unlocks/kits and builder positions. Map, recipes,
  // ports, sockets and every production/transport tick remain the real campaign rules.
  for (const [type, x, z, rotation] of points) {
    p.pos = { x, y: floorHeight(x, z), z };
    const kind =
      type as import("../packages/carry-core/src/config.ts").DeviceKind;
    assert.equal(
      placementReason(w, p, kind, x, z, rotation),
      "",
      `${type} at ${x},${z}`,
    );
    const kit = spawn(w, `kit_${kind}`, p.pos, "hand", p.id);
    p.hand = kit.id;
    const receipt = cmd(w, "PLACE", { device: kind, x, z, rotation });
    assert.equal(receipt.ok, true, receipt.message);
  }
  assert.equal(
    JSON.stringify({ machines: w.machines, sockets: w.sockets }),
    original,
  );
  p.pos = { x: -14, y: 0, z: 10 };
  steps(w, 140);
  const socket = w.sockets[0];
  assert.ok(
    socket.item,
    JSON.stringify(
      Object.values(w.devices).map((d) => ({
        type: d.type,
        pos: d.pos,
        item: d.item && w.items[d.item].kind,
      })),
    ),
  );
  assert.equal(w.items[socket.item!].state, "installed");
  for (const kind of ["metal_scrap", "ingot"])
    assert.ok(
      Object.values(w.items).some(
        (i) => i.kind === kind && i.state === "consumed",
      ),
    );
  assert.ok(Object.values(w.devices).some((d) => d.pos.y > 0 && d.pos.y < 1.2));
  assertCarry(w);
});
