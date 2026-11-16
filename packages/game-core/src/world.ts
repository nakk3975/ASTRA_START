import {
  B,
  M,
  R,
  versions,
  goals,
  UNIT,
  ITEMS,
  type Item,
  type Counts,
} from "../../content/src/index.ts";
import type { World, Member, Runtime, Geometry } from "./types.ts";
import { center, near, fixedGeometry, solids, blocked } from "./geometry.ts";
import {
  buffer,
  add,
  remove,
  count,
  total,
  room,
  stack,
  plus,
  fail,
} from "./inventory.ts";
export const nextId = (w: World, prefix: string) =>
  prefix + "-" + (++w.seq).toString().padStart(7, "0");
export const unlocked = (w: World, key: string) =>
  key === "START" || w.stages.some((s) => s.completed && s.id === key);
export const connected = (w: World) =>
  Object.values(w.members)
    .filter((m) => m.connected)
    .sort((a, b) => a.joinedOrder - b.joinedOrder);
export function createWorld(
  id: string,
  name: string,
  code: string,
  planned: number,
  balanceHash: string,
): World {
  return {
    id,
    name,
    code,
    planned,
    owner: "",
    leader: null,
    phase: "LOBBY",
    settingsRevision: 0,
    rosterRevision: 0,
    locked: false,
    version: "0",
    tick: "0",
    seq: 0,
    ...versions,
    balanceHash,
    pauses: ["NO_CONNECTED_PLAYERS"],
    members: {},
    inventories: {
      shared_warehouse: buffer(
        "shared_warehouse",
        B.storage.starting_shared_storage_capacity_per_item,
      ),
      recovery_vault: buffer(
        "recovery_vault",
        B.storage.recovery_vault_capacity_per_item,
      ),
    },
    machines: {},
    links: {},
    cargo: {},
    crates: {},
    stages: goals(planned).map((required, i) => ({
      id: B.milestones[i].id,
      required,
      delivered: {},
      progress: 0,
      completed: false,
      completedTick: null,
    })),
    stage: 0,
    checks: Object.fromEntries(
      B.construction.inspection_ids.map((x) => [x, false]),
    ),
    vote: null,
    countdown: 0,
    attempt: null,
    result: null,
    sourceCursors: {},
    destCursors: {},
    ledger: {
      generated: {},
      recipeInput: {},
      recipeOutput: {},
      spent: {},
      refunded: {},
      rocket: {},
    },
    power: {
      supply: B.power.starter_supply_deci_units,
      demand: 0,
      ratio: B.power.progress_fixed_point_scale,
    },
    stats: { automaticProduced: 0, delivered: 0, maxPlayers: 0 },
    offer: null,
  };
}
export function makeCrate(
  w: World,
  p: { x: number; z: number },
  counts: Counts,
): string {
  const cell = {
    x: Math.max(1, Math.min(M.dimensions.width - 2, Math.floor(p.x))),
    z: Math.max(1, Math.min(M.dimensions.depth - 2, Math.floor(p.z))),
  };
  const id = "crate:" + cell.x + ":" + cell.z;
  const inv = w.inventories[id] ?? buffer(id, B.limits.integer_quantity_max);
  for (const [i, n] of Object.entries(counts))
    if (count(inv, i as Item) + n > B.limits.integer_quantity_max)
      fail("RECOVERY_CAPACITY_REQUIRED");
  w.inventories[id] = inv;
  w.crates[id] = cell;
  for (const [i, n] of Object.entries(counts)) add(inv, i as Item, n);
  return id;
}
export function stopWork(w: World, m: Member) {
  m.work = null;
}
function recoverBag(w: World, m: Member) {
  const inv = w.inventories["bag:" + m.id],
    counts = Object.fromEntries(
      ITEMS.map((i) => [i, count(inv, i)]).filter(([, n]) => n),
    ) as Counts;
  if (Object.keys(counts).length) {
    makeCrate(w, { x: m.position.x / UNIT, z: m.position.z / UNIT }, counts);
    for (const [i, n] of Object.entries(counts)) remove(inv, i as Item, n);
  }
  m.seatUntil = 0;
}
function recoverChannel(w: World, m: Member) {
  const id = "channel:" + m.id,
    mac = w.machines[id];
  if (!mac) return;
  const counts: Counts = {};
  for (const port of ["in", "out"]) {
    const inv = w.inventories[id + ":" + port];
    for (const i of ITEMS) counts[i] = (counts[i] ?? 0) + count(inv, i);
    delete w.inventories[id + ":" + port];
  }
  if (mac.job) plus(counts, mac.job.escrow);
  if (Object.values(counts).some((n) => n))
    makeCrate(w, M.starter_entities[0].service_points[0].cell, counts);
  delete w.machines[id];
  m.channelUntil = 0;
}
export function maintenance(w: World, wall: number) {
  for (const m of Object.values(w.members))
    if (!m.connected) {
      if (m.seatUntil && wall >= m.seatUntil) recoverBag(w, m);
      if (m.channelUntil && wall >= m.channelUntil) recoverChannel(w, m);
    }
  if (w.vote && wall >= w.vote.expires) cancelLaunch(w);
  if (w.offer && wall >= w.offer.expires) w.offer = null;
}
function channel(w: World, m: Member) {
  const id = "channel:" + m.id;
  if (w.machines[id]) return;
  if (
    Object.values(w.machines).filter((x) => x.type === "channel").length >=
    R.world.max_players
  ) {
    const old = Object.values(w.members)
      .filter(
        (x) => !x.connected && !x.seatUntil && w.machines["channel:" + x.id],
      )
      .sort((a, b) => a.channelUntil - b.channelUntil)[0];
    if (!old) fail("ROOM_FULL");
    recoverChannel(w, old);
  }
  w.machines[id] = {
    id,
    type: "channel",
    owner: m.id,
    geometry: fixedGeometry[0],
    recipe: null,
    enabled: true,
    tier: 1,
    version: 0,
    paid: {},
    source: null,
    job: null,
  };
  w.inventories[id + ":in"] = buffer(
    id + ":in",
    B.storage.manual_channel_input_capacity_per_item,
    m.id,
  );
  w.inventories[id + ":out"] = buffer(
    id + ":out",
    B.storage.manual_channel_output_capacity_per_item,
    m.id,
  );
}
export function join(
  w: World,
  guest: string,
  name: string,
  wall: number,
): Member {
  maintenance(w, wall);
  if (w.phase === "COUNTDOWN" || w.phase === "DELETED")
    fail("INVALID_ROOM_PHASE");
  let m = Object.values(w.members).find((x) => x.guestId === guest);
  const seats = Object.values(w.members).filter(
    (x) => x.connected || x.seatUntil > wall,
  );
  if (
    !m?.connected &&
    !(m && m.seatUntil > wall) &&
    seats.length >= R.world.max_players
  )
    fail("ROOM_FULL");
  if (!m) {
    const id = nextId(w, "member");
    m = {
      id,
      guestId: guest,
      name,
      epoch: 0,
      connected: false,
      joinedOrder: 0,
      seatUntil: 0,
      channelUntil: 0,
      position: center(M.spawn_points[seats.length % M.spawn_points.length]),
      ready: false,
      upgrades: [],
      work: null,
      stats: {},
      tutorial: [],
    };
    w.members[id] = m;
    w.inventories["bag:" + id] = {
      id: "bag:" + id,
      kind: "PLAYER",
      owner: id,
      slots: Array(B.player.inventory_slots).fill(null),
      version: 0,
    };
  }
  m.epoch++;
  m.connected = true;
  m.joinedOrder = ++w.seq;
  m.seatUntil = 0;
  m.channelUntil = 0;
  m.work = null;
  m.ready = false;
  m.name = name;
  channel(w, m);
  if (blocked(m.position, solids(w))) m.position = center(M.spawn_points[0]);
  if (!w.owner) w.owner = m.id;
  if (!w.leader) w.leader = m.id;
  w.rosterRevision++;
  if (w.phase === "LAUNCH_VOTE") cancelLaunch(w);
  if (w.phase === "LOBBY")
    for (const p of Object.values(w.members)) p.ready = false;
  w.pauses = w.pauses.filter((x) => x !== "NO_CONNECTED_PLAYERS");
  w.stats.maxPlayers = Math.max(w.stats.maxPlayers, connected(w).length);
  return m;
}
export function leave(w: World, id: string, wall: number, consented: boolean) {
  const m = w.members[id];
  if (!m || !m.connected) return;
  m.connected = false;
  m.work = null;
  m.ready = false;
  m.seatUntil = consented
    ? 0
    : wall + R.timers_ms.disconnected_seat_reservation;
  m.channelUntil = wall + R.timers_ms.manual_channel_retention_max;
  if (consented) recoverBag(w, m);
  if (w.offer && (w.offer.from === id || w.offer.to === id)) w.offer = null;
  w.rosterRevision++;
  if (["LAUNCH_VOTE", "COUNTDOWN"].includes(w.phase)) cancelLaunch(w);
  if (w.leader === id) w.leader = connected(w)[0]?.id ?? null;
  if (!connected(w).length && !w.pauses.includes("NO_CONNECTED_PLAYERS"))
    w.pauses.push("NO_CONNECTED_PLAYERS");
}
export function cancelLaunch(w: World) {
  w.phase = "RUNNING";
  w.vote = null;
  w.countdown = 0;
  w.attempt = null;
  for (const m of Object.values(w.members)) m.work = null;
}
export function recover(w: World, wall: number) {
  for (const m of Object.values(w.members))
    if (m.connected) leave(w, m.id, wall, false);
  if (["LAUNCH_VOTE", "COUNTDOWN"].includes(w.phase)) cancelLaunch(w);
  w.rosterRevision++;
  for (const m of Object.values(w.members)) {
    m.work = null;
    m.ready = false;
  }
  maintenance(w, wall);
}
export function geometry(w: World, id: string): Geometry {
  if (id.startsWith("bag:")) {
    const m = w.members[id.slice(4)] ?? fail("TARGET_NOT_FOUND");
    return {
      id,
      kind: "player",
      top_left: { x: 0, z: 0 },
      footprint: { width: 0, depth: 0 },
      rotation_degrees: 0,
      solid: false,
      delivery_distance_anchor: {
        x: m.position.x / UNIT,
        z: m.position.z / UNIT,
      },
      service_points: [
        {
          cell: {
            x: Math.floor(m.position.x / UNIT),
            z: Math.floor(m.position.z / UNIT),
          },
          interaction_anchor: {
            x: m.position.x / UNIT,
            z: m.position.z / UNIT,
          },
        },
      ],
    };
  }
  if (w.crates[id])
    return {
      id,
      kind: "crate",
      top_left: w.crates[id],
      footprint: { width: 0, depth: 0 },
      rotation_degrees: 0,
      solid: false,
      delivery_distance_anchor: {
        x: w.crates[id].x + 0.5,
        z: w.crates[id].z + 0.5,
      },
      service_points: [
        {
          cell: w.crates[id],
          interaction_anchor: {
            x: w.crates[id].x + 0.5,
            z: w.crates[id].z + 0.5,
          },
        },
      ],
    };
  const mid = id.replace(/:(in|out)$/, "");
  return (
    w.machines[mid]?.geometry ??
    fixedGeometry.find((g) => g.id === id) ??
    fail("TARGET_NOT_FOUND")
  );
}
export function assertNear(w: World, m: Member, id: string) {
  if (near(w, m.position, geometry(w, id)) < 0) fail("OUT_OF_RANGE");
}
export function visible(w: World, member: string): World {
  const view = structuredClone(w);
  for (const m of Object.values(view.members)) {
    m.guestId = "";
    if (m.id !== member) {
      delete view.inventories["bag:" + m.id];
      delete view.inventories["channel:" + m.id + ":in"];
      delete view.inventories["channel:" + m.id + ":out"];
      delete view.machines["channel:" + m.id];
    }
  }
  return view;
}
