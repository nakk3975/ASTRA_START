import {
  B,
  M,
  R,
  FP,
  UNIT,
  ITEMS,
  goals,
  type Item,
  type Counts,
  type Recipe,
  type MachineType,
  type Upgrade,
} from "../../content/src/index.ts";
import type { World, Member, Runtime, Machine, Outcome } from "./types.ts";
import type { Command } from "../../protocol/src/index.ts";
import {
  near,
  center,
  distance2,
  machineGeometry,
  placement,
  fixedGeometry,
} from "./geometry.ts";
import {
  add,
  remove,
  count,
  total,
  room,
  stack,
  plus,
  spend,
  buffer,
  fail,
} from "./inventory.ts";
import {
  nextId,
  unlocked,
  connected,
  assertNear,
  makeCrate,
  stopWork,
  cancelLaunch,
  geometry,
} from "./world.ts";
export const recipeOf = (m: Machine) => (m.recipe ? B.recipes[m.recipe] : null);
export function empty(w: World, m: Machine, links = true) {
  return (
    !m.job &&
    !total(w.inventories[m.id + ":in"]) &&
    !total(w.inventories[m.id + ":out"]) &&
    !Object.values(w.cargo).some(
      (c) => c.from.startsWith(m.id + ":") || c.to.startsWith(m.id + ":"),
    ) &&
    (!links ||
      !Object.values(w.links).some(
        (l) => l.from.startsWith(m.id + ":") || l.to.startsWith(m.id + ":"),
      ))
  );
}
export function accepts(
  w: World,
  id: string,
  item: Item,
  output = false,
): boolean {
  if (id === "shared_warehouse") return true;
  if (id === "rocket")
    return (
      !output &&
      w.stage < B.milestones.length &&
      !!w.stages[w.stage].required[item]
    );
  const m = w.machines[id.replace(/:(in|out)$/, "")];
  if (!m || m.type === "channel") return false;
  if (output && id === m.id + ":out")
    return (
      m.source === item || !!(recipeOf(m)?.output as Counts | undefined)?.[item]
    );
  return (
    !output &&
    id === m.id + ":in" &&
    !!(recipeOf(m)?.input as Counts | undefined)?.[item]
  );
}
export function rocketFree(w: World, item: Item) {
  const s = w.stages[w.stage];
  return s
    ? (s.required[item] ?? 0) -
        (s.delivered[item] ?? 0) -
        Object.values(w.cargo).filter(
          (c) => c.to === "rocket" && c.item === item,
        ).length
    : 0;
}
export function validateRoute(
  w: World,
  from: string,
  to: string,
  item: Item,
  ignore?: string,
) {
  if (
    from === to ||
    from.replace(/:(in|out)$/, "") === to.replace(/:(in|out)$/, "")
  )
    fail("SELF_LINK");
  if (!accepts(w, from, item, true) || !accepts(w, to, item))
    fail("INCOMPATIBLE_PORT");
  if (
    Object.values(w.links).some(
      (l) =>
        l.id !== ignore && l.from === from && l.to === to && l.item === item,
    )
  )
    fail("DUPLICATE_LINK");
  const a = geometry(w, from).delivery_distance_anchor,
    b = geometry(w, to).delivery_distance_anchor;
  if (
    distance2(
      { x: a.x * UNIT, z: a.z * UNIT },
      { x: b.x * UNIT, z: b.z * UNIT },
    ) >
    (B.delivery.max_distance_tiles * UNIT) ** 2
  )
    fail("LINK_TOO_LONG");
}
function machine(w: World, m: Member, p: any) {
  const entity = w.machines[p.entityId] ?? fail("TARGET_NOT_FOUND");
  if (entity.owner && entity.owner !== m.id) fail("NOT_OWNER");
  assertNear(w, m, entity.id);
  if (entity.version !== p.expectedEntityVersion)
    fail("ENTITY_VERSION_CONFLICT");
  return entity;
}
function requireLeader(w: World, m: Member) {
  if (w.leader !== m.id) fail("NOT_LEADER");
}
function invAccess(w: World, m: Member, id: string, write: boolean) {
  const inv = w.inventories[id] ?? fail("TARGET_NOT_FOUND");
  if (inv.owner && inv.owner !== m.id) {
    if (inv.kind !== "PLAYER" || !write || !w.members[inv.owner].connected)
      fail("NOT_OWNER");
  }
  assertNear(w, m, id);
  return inv;
}
export function applyCommand(
  w: World,
  member: string,
  c: Command,
  rt: Runtime,
): Outcome {
  const m = w.members[member] ?? fail("AUTH_REQUIRED"),
    p = c.payload;
  if (!m.connected || m.epoch !== c.controllerEpoch) fail("SESSION_REPLACED");
  if (BigInt(c.minDurableVersion) > BigInt(w.version)) fail("RESYNC_REQUIRED");
  const bag = w.inventories["bag:" + member];
  if (c.type === "SAVE_BARRIER") return {};
  if (c.type === "PING") return { targetId: p.targetId };
  if (c.type === "CLAIM_LEADER") {
    if (w.owner !== member) fail("NOT_OWNER");
    w.leader = member;
    return {};
  }
  if (c.type === "SET_ROOM_PAUSE") {
    requireLeader(w, m);
    if (w.phase !== "RUNNING") fail("INVALID_ROOM_PHASE");
    w.pauses = w.pauses.filter((x) => x !== "MANUAL");
    if (p.paused) w.pauses.push("MANUAL");
    for (const a of Object.values(w.members)) stopWork(w, a);
    return {};
  }
  if (c.type === "CANCEL_LAUNCH") {
    if (
      !["LAUNCH_VOTE", "COUNTDOWN"].includes(w.phase) ||
      (w.vote?.id ?? w.attempt) !== p.attemptId
    )
      fail("INVALID_ROOM_PHASE");
    cancelLaunch(w);
    rt.inputs = {};
    return {};
  }
  if (c.type === "TRANSFER_OWNERSHIP") {
    if (w.owner !== member) fail("NOT_OWNER");
    if (p.targetMemberId === member || !w.members[p.targetMemberId]?.connected)
      fail("TARGET_NOT_FOUND");
    w.offer = {
      id: nextId(w, "offer"),
      from: member,
      to: p.targetMemberId,
      expires: rt.wallNow + R.timers_ms.launch_vote_timeout,
    };
    return { offerId: w.offer.id };
  }
  if (c.type === "ACCEPT_OWNERSHIP") {
    if (
      !w.offer ||
      w.offer.id !== p.offerId ||
      w.offer.to !== member ||
      w.offer.expires <= rt.wallNow ||
      !w.members[w.offer.from].connected
    )
      fail("NOT_OWNER");
    w.owner = member;
    w.offer = null;
    return { rotateRecovery: true };
  }
  if (
    ["ROTATE_ROOM_CODE", "ROTATE_RECOVERY_KEY", "DELETE_SAVED_ROOM"].includes(
      c.type,
    )
  ) {
    if (w.owner !== member) fail("NOT_OWNER");
    if (c.type === "DELETE_SAVED_ROOM") {
      if (connected(w).length > 1) fail("ROOM_IN_USE");
      if (p.version !== w.version || p.code !== w.code)
        fail("ENTITY_VERSION_CONFLICT");
      w.phase = "DELETED";
    }
    return {};
  }
  if (["READY_SET", "START_SESSION", "SET_LOBBY_SETTINGS"].includes(c.type)) {
    if (w.phase !== "LOBBY") fail("INVALID_ROOM_PHASE");
    if (c.type === "READY_SET") m.ready = p.ready;
    if (c.type === "SET_LOBBY_SETTINGS") {
      requireLeader(w, m);
      w.planned = p.plannedPlayers;
      w.settingsRevision++;
      for (const a of Object.values(w.members)) a.ready = false;
    }
    if (c.type === "START_SESSION") {
      requireLeader(w, m);
      if (
        p.settingsRevision !== w.settingsRevision ||
        !connected(w).every((a) => a.ready)
      )
        fail("NOT_ALL_READY");
      w.locked = true;
      w.phase = "RUNNING";
      w.stages = goals(w.planned).map((required, i) => ({
        ...w.stages[i],
        required,
      }));
    }
    return {};
  }
  if (w.pauses.length)
    fail(
      w.pauses.includes("STORAGE_PENDING")
        ? "STORAGE_UNAVAILABLE"
        : "ROOM_PAUSED",
    );
  if (!B.launch.manual_actions_phases.includes(w.phase))
    fail("INVALID_ROOM_PHASE");
  if (c.type === "WORK_STOP") {
    if (m.work?.id === p.workId) stopWork(w, m);
    return {};
  }
  if (c.type === "WORK_START") {
    let target = "";
    if (p.kind === "GATHER") {
      const src =
        M.source_zones.find((s) => s.id === p.sourceId) ??
        fail("TARGET_NOT_FOUND");
      if (!unlocked(w, B.sources[src.item_id as keyof typeof B.sources].unlock))
        fail("LOCKED");
      const g = {
        ...fixedGeometry[0],
        id: src.id,
        service_points: src.manual_service_points,
      };
      if (near(w, m.position, g) < 0) fail("OUT_OF_RANGE");
      target = src.item_id;
    }
    if (p.kind === "MANUAL_CRAFT") {
      if (p.channelId !== "channel:" + member) fail("NOT_OWNER");
      assertNear(w, m, p.channelId);
      const mac = w.machines[p.channelId],
        rec = B.recipes[p.recipeId as Recipe];
      if (!rec || !unlocked(w, rec.unlock)) fail("LOCKED");
      if (mac.recipe !== p.recipeId) {
        if (!empty(w, mac, false) && mac.recipe !== null)
          fail("MACHINE_NOT_EMPTY");
        mac.recipe = p.recipeId;
        mac.version++;
      }
      target = p.channelId;
    }
    if (p.kind === "ASSEMBLY") {
      assertNear(w, m, "rocket");
      const s = w.stages[w.stage];
      if (
        !s ||
        s.id !== p.stageId ||
        !Object.entries(s.required).every(
          ([i, n]) => (s.delivered[i as Item] ?? 0) === n,
        )
      )
        fail("LAUNCH_REQUIREMENTS_MISSING");
      target = s.id;
    }
    if (p.kind === "INSPECTION") {
      assertNear(w, m, "rocket");
      if (w.stage < B.milestones.length) fail("INSPECTIONS_INCOMPLETE");
      if (w.checks[p.checkId]) fail("STAGE_ALREADY_COMPLETE");
      if (
        Object.values(w.members).some(
          (a) =>
            a.id !== member &&
            a.work?.kind === "INSPECTION" &&
            a.work.target === p.checkId,
        )
      )
        fail("TARGET_BUSY");
      target = p.checkId;
    }
    stopWork(w, m);
    const id = nextId(w, "work");
    m.work = { id, kind: p.kind, target, progress: 0 };
    const old = rt.inputs[member] ?? {
      dx: 0,
      dz: 0,
      seq: 0,
      at: 0,
      hold: null,
      holdAt: 0,
    };
    rt.inputs[member] = { ...old, dx: 0, dz: 0, hold: id, holdAt: rt.now };
    return { workId: id };
  }
  if (c.type === "TRANSFER_ITEM" || c.type === "TAKE_MAX") {
    if (p.from === p.to) fail("BAD_PAYLOAD");
    if (!p.from.startsWith("bag:") && !p.to.startsWith("bag:"))
      fail("NOT_OWNER");
    const from = invAccess(w, m, p.from, false),
      to = invAccess(w, m, p.to, true);
    if (
      to.id === "recovery_vault" ||
      to.id.startsWith("crate:") ||
      to.id.endsWith(":out")
    )
      fail("INCOMPATIBLE_PORT");
    if (to.id.endsWith(":in")) {
      const mac = w.machines[to.id.slice(0, -3)];
      if (mac.type === "channel") {
        if (!ITEMS.includes(p.itemId)) fail("BAD_PAYLOAD");
      } else if (!accepts(w, to.id, p.itemId)) fail("INCOMPATIBLE_PORT");
    }
    const max = Math.min(count(from, p.itemId), room(w, to, p.itemId));
    let q = p.quantity;
    if (c.type === "TAKE_MAX") q = Math.min(q, max);
    if (q <= 0) fail("INVENTORY_FULL");
    if (count(from, p.itemId) < q) fail("NOT_ENOUGH_ITEMS");
    if (room(w, to, p.itemId) < q) fail("INVENTORY_FULL");
    remove(from, p.itemId, q);
    add(to, p.itemId, q, to.kind === "PLAYER" ? stack(w, to.owner) : undefined);
    m.stats.transferred = (m.stats.transferred ?? 0) + q;
    if (w.crates[from.id] && !total(from)) {
      delete w.crates[from.id];
      delete w.inventories[from.id];
    }
    return { actualQuantity: q };
  }
  if (c.type === "STASH_OVERFLOW") {
    const g = fixedGeometry.find((g) => g.id === "shared_warehouse")!,
      i = near(w, m.position, g);
    if (i < 0) fail("OUT_OF_RANGE");
    if (count(bag, p.itemId) < p.quantity) fail("NOT_ENOUGH_ITEMS");
    const id = makeCrate(w, g.service_points[i].cell, {
      [p.itemId]: p.quantity,
    });
    remove(bag, p.itemId, p.quantity);
    return { entityId: id, actualQuantity: p.quantity };
  }
  if (c.type === "CONTRIBUTE_ROCKET") {
    assertNear(w, m, "rocket");
    const q = Math.min(
      p.quantity,
      count(bag, p.itemId),
      rocketFree(w, p.itemId),
    );
    if (q <= 0) fail("LAUNCH_REQUIREMENTS_MISSING");
    remove(bag, p.itemId, q);
    plus(w.stages[w.stage].delivered, { [p.itemId]: q });
    plus(w.ledger.rocket, { [p.itemId]: q });
    m.stats.contributed = (m.stats.contributed ?? 0) + q;
    return { actualQuantity: q };
  }
  if (c.type === "PROPOSE_LAUNCH") {
    requireLeader(w, m);
    if (
      w.phase !== "RUNNING" ||
      w.stage !== B.milestones.length ||
      !Object.values(w.checks).every(Boolean)
    )
      fail("INSPECTIONS_INCOMPLETE");
    w.vote = {
      id: nextId(w, "vote"),
      roster: w.rosterRevision,
      eligible: connected(w).map((x) => x.id),
      yes: [],
      expires: rt.wallNow + R.timers_ms.launch_vote_timeout,
    };
    w.phase = "LAUNCH_VOTE";
    return { voteId: w.vote.id };
  }
  if (c.type === "CAST_VOTE") {
    if (
      w.phase !== "LAUNCH_VOTE" ||
      !w.vote ||
      w.vote.id !== p.voteId ||
      !w.vote.eligible.includes(member)
    )
      fail("VOTE_EXPIRED");
    if (rt.wallNow >= w.vote.expires) fail("VOTE_EXPIRED");
    if (!p.yes) {
      cancelLaunch(w);
      return {};
    }
    if (!w.vote.yes.includes(member)) w.vote.yes.push(member);
    if (w.vote.yes.length === w.vote.eligible.length) {
      w.phase = "COUNTDOWN";
      w.attempt = nextId(w, "launch");
      w.vote = null;
      w.countdown = B.launch.countdown_ticks;
      for (const a of Object.values(w.members)) stopWork(w, a);
      rt.inputs = {};
    }
    return {};
  }
  if (c.type === "PLACE_MACHINE") {
    const type = p.machineType as MachineType,
      config = B.machines[type];
    if (type === "manual_workbench" || !unlocked(w, config.unlock))
      fail("LOCKED");
    const placed = Object.values(w.machines).filter(
      (x) => x.type !== "channel",
    );
    if (
      placed.length >= B.caps.total_placed_machine_entities_excluding_starter ||
      (type === "solar_array" &&
        placed.filter((x) => x.type === type).length >= B.caps.solar_arrays) ||
      (type === "logistics_hub" && placed.some((x) => x.type === type))
    )
      fail("BUILD_LIMIT_REACHED");
    const id = "machine-" + (w.seq + 1).toString().padStart(7, "0");
    let g = machineGeometry(id, type, p.x, p.z, p.rotation);
    let source: Item | null = null;
    if (type === "extractor") {
      const pad =
        M.source_zones
          .flatMap((x) => x.extractor_pads)
          .find((x) => x.top_left.x === p.x && x.top_left.z === p.z) ??
        fail("DESIGNATED_PAD_REQUIRED");
      source = pad.item_id as Item;
      if (!unlocked(w, B.sources[source as keyof typeof B.sources].unlock))
        fail("LOCKED");
      g = { ...pad, id, kind: type, solid: true };
    }
    if (
      distance2(m.position, {
        x: g.delivery_distance_anchor.x * UNIT,
        z: g.delivery_distance_anchor.z * UNIT,
      }) >
      (B.player.placement_center_range_tiles * UNIT) ** 2
    )
      fail("OUT_OF_RANGE");
    const err = placement(w, g);
    if (err) fail(err);
    spend(w, member, config.paid_cost);
    w.seq++;
    w.machines[id] = {
      id,
      type,
      owner: null,
      geometry: g,
      recipe: null,
      enabled: true,
      tier: 1,
      version: 0,
      paid: { ...config.paid_cost },
      source,
      job: null,
    };
    w.inventories[id + ":in"] = buffer(
      id + ":in",
      B.storage.machine_input_capacity_per_accepted_item,
    );
    w.inventories[id + ":out"] = buffer(
      id + ":out",
      B.storage.machine_output_capacity_per_produced_item,
    );
    m.stats.built = (m.stats.built ?? 0) + 1;
    return { entityId: id };
  }
  if (
    [
      "SET_MACHINE_RECIPE",
      "SET_MACHINE_ENABLED",
      "CANCEL_JOB",
      "MOVE_MACHINE",
      "DISMANTLE_MACHINE",
      "UPGRADE_MACHINE",
    ].includes(c.type)
  ) {
    const mac = machine(w, m, p);
    if (c.type === "SET_MACHINE_RECIPE") {
      const rec = B.recipes[p.recipeId as Recipe];
      if (
        !unlocked(w, rec.unlock) ||
        (mac.type !== "channel" && rec.machine !== mac.type)
      )
        fail("LOCKED");
      if (mac.recipe !== p.recipeId && !empty(w, mac, false))
        fail("MACHINE_NOT_EMPTY");
      mac.recipe = p.recipeId;
    }
    if (c.type === "SET_MACHINE_ENABLED") mac.enabled = p.enabled;
    if (c.type === "CANCEL_JOB") {
      if (!mac.job) fail("TARGET_NOT_FOUND");
      const input = w.inventories[mac.id + ":in"];
      for (const [i, n] of Object.entries(mac.job.escrow))
        if (room(w, input, i as Item) < n) fail("REFUND_CAPACITY_REQUIRED");
      for (const [i, n] of Object.entries(mac.job.escrow))
        add(input, i as Item, n);
      mac.job = null;
      if (mac.type === "channel") stopWork(w, m);
    }
    if (c.type === "UPGRADE_MACHINE") {
      const up = B.upgrades[p.upgradeId as "machine_mk2" | "extractor_mk2"];
      if (
        !unlocked(w, up.unlock) ||
        !(up.eligible_machine_types as string[]).includes(mac.type)
      )
        fail("LOCKED");
      if (mac.tier !== up.requires_tier) fail("ALREADY_UPGRADED");
      spend(w, member, up.cost);
      plus(mac.paid, up.cost);
      mac.tier = up.result_tier;
    }
    if (["MOVE_MACHINE", "DISMANTLE_MACHINE"].includes(c.type)) {
      if (mac.type === "channel") fail("PROTECTED_STRUCTURE");
      if (mac.enabled || !empty(w, mac)) fail("MACHINE_NOT_EMPTY");
      if (c.type === "MOVE_MACHINE") {
        let g = machineGeometry(mac.id, mac.type, p.x, p.z, p.rotation);
        if (mac.type === "extractor") {
          const pad =
            M.source_zones
              .flatMap((x) => x.extractor_pads)
              .find((x) => x.top_left.x === p.x && x.top_left.z === p.z) ??
            fail("DESIGNATED_PAD_REQUIRED");
          if (
            !unlocked(
              w,
              B.sources[pad.item_id as keyof typeof B.sources].unlock,
            )
          )
            fail("LOCKED");
          g = { ...pad, id: mac.id, kind: mac.type, solid: true };
          mac.source = pad.item_id as Item;
        }
        if (
          distance2(m.position, {
            x: g.delivery_distance_anchor.x * UNIT,
            z: g.delivery_distance_anchor.z * UNIT,
          }) >
          (B.player.placement_center_range_tiles * UNIT) ** 2
        )
          fail("OUT_OF_RANGE");
        const err = placement(w, g, mac.id);
        if (err) fail(err);
        mac.geometry = g;
      } else {
        const id = makeCrate(w, mac.geometry.service_points[0].cell, mac.paid);
        plus(w.ledger.refunded, mac.paid);
        delete w.inventories[mac.id + ":in"];
        delete w.inventories[mac.id + ":out"];
        delete w.machines[mac.id];
        return { entityId: id };
      }
    }
    mac.version++;
    return { entityId: mac.id, entityVersion: mac.version };
  }
  if (c.type === "UPGRADE_PLAYER") {
    const u =
      B.upgrades[
        p.upgradeId as "carry_tier_1" | "carry_tier_2" | "move_tier_1"
      ];
    assertNear(w, m, "starter_workbench");
    if (
      !unlocked(w, u.unlock) ||
      !u.requires.every((k) => m.upgrades.includes(k))
    )
      fail("LOCKED");
    if (m.upgrades.includes(p.upgradeId)) fail("ALREADY_UPGRADED");
    spend(w, member, u.cost);
    m.upgrades.push(p.upgradeId);
    return {};
  }
  if (c.type === "CREATE_LINK") {
    if (
      !unlocked(w, B.delivery.unlock) ||
      !Object.values(w.machines).some((m) => m.type === "logistics_hub")
    )
      fail("HUB_REQUIRED");
    if (Object.keys(w.links).length >= B.delivery.max_links)
      fail("BUILD_LIMIT_REACHED");
    assertNear(w, m, p.from);
    validateRoute(w, p.from, p.to, p.itemId);
    spend(w, member, B.delivery.paid_cost_per_link);
    const id = nextId(w, "link");
    w.links[id] = {
      id,
      from: p.from,
      to: p.to,
      item: p.itemId,
      version: 0,
      draining: false,
      credit: 0,
      paid: { ...B.delivery.paid_cost_per_link },
    };
    return { entityId: id };
  }
  if (["DRAIN_LINK", "EDIT_LINK", "REMOVE_LINK"].includes(c.type)) {
    const l = w.links[p.entityId] ?? fail("TARGET_NOT_FOUND");
    assertNear(w, m, l.from);
    if (l.version !== p.expectedEntityVersion) fail("ENTITY_VERSION_CONFLICT");
    if (c.type === "DRAIN_LINK") l.draining = true;
    else {
      if (!l.draining) fail("LINK_DRAINING");
      if (Object.values(w.cargo).some((x) => x.link === l.id))
        fail("CARGO_IN_FLIGHT");
      if (c.type === "EDIT_LINK") {
        assertNear(w, m, p.from);
        validateRoute(w, p.from, p.to, p.itemId, l.id);
        l.from = p.from;
        l.to = p.to;
        l.item = p.itemId;
        l.credit = 0;
        l.draining = false;
      } else {
        makeCrate(w, geometry(w, l.from).service_points[0].cell, l.paid);
        plus(w.ledger.refunded, l.paid);
        delete w.links[l.id];
      }
    }
    l.version++;
    return {};
  }
  fail("BAD_PAYLOAD");
}
// A business rejection cannot leave partial mutation, including ID counters or reservations.
export function command(
  w: World,
  member: string,
  c: Command,
  rt: Runtime,
): { world: World; result: Outcome; error?: string } {
  const copy = structuredClone(w),
    runtime = structuredClone(rt);
  try {
    const result = applyCommand(copy, member, c, runtime);
    rt.inputs = runtime.inputs;
    return { world: copy, result };
  } catch (e) {
    return {
      world: w,
      result: {},
      error: e instanceof Error ? e.message : "INVARIANT_FAILED",
    };
  }
}
