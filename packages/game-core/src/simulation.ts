import {
  B,
  M,
  R,
  FP,
  UNIT,
  ITEMS,
  type Item,
  type Counts,
} from "../../content/src/index.ts";
import type { World, Runtime, Machine, Link } from "./types.ts";
import { blocked, solids, near, distance2, fixedGeometry } from "./geometry.ts";
import {
  add,
  remove,
  count,
  room,
  stack,
  plus,
  total,
  fail,
  reserved,
} from "./inventory.ts";
import {
  nextId,
  unlocked,
  geometry,
  stopWork,
  connected,
  maintenance,
} from "./world.ts";
import { accepts, rocketFree, recipeOf } from "./actions.ts";
const sorted = <T extends { id: string }>(r: Record<string, T>) =>
  Object.values(r).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function batch(
  m: Machine,
): { input: Counts; output: Counts; ticks: number } | null {
  if (m.source) {
    const s = B.sources[m.source as keyof typeof B.sources];
    return {
      input: {},
      output: { [m.source]: s.extractor_yield },
      ticks: s.extractor_cycle_ticks,
    };
  }
  const r = recipeOf(m);
  if (!r) return null;
  const multi = B.machines.manual_workbench.manual_duration_multiplier;
  return {
    input: r.input,
    output: r.output,
    ticks:
      m.type === "channel"
        ? Math.ceil((r.duration_ticks * multi.numerator) / multi.denominator)
        : r.duration_ticks,
  };
}
export function canStart(w: World, m: Machine) {
  const b = batch(m);
  if (!b) return false;
  const input = w.inventories[m.id + ":in"],
    out = w.inventories[m.id + ":out"];
  return (
    Object.entries(b.input).every(([i, n]) => count(input, i as Item) >= n) &&
    Object.entries(b.output).every(([i, n]) => room(w, out, i as Item) >= n)
  );
}
function craft(w: World, m: Machine, delta: number) {
  if (!m.job) {
    if (!canStart(w, m)) return;
    const b = batch(m)!;
    for (const [i, n] of Object.entries(b.input))
      remove(w.inventories[m.id + ":in"], i as Item, n);
    m.job = {
      id: nextId(w, "job"),
      recipe: m.recipe ?? "extract:" + m.source,
      escrow: { ...b.input },
      output: { ...b.output },
      progress: 0,
      required: b.ticks * FP,
      contentVersion: w.contentVersion,
    };
  }
  m.job.progress += delta;
  if (m.job.progress >= m.job.required) {
    const job = m.job;
    m.job = null;
    for (const [i, n] of Object.entries(job.output))
      add(w.inventories[m.id + ":out"], i as Item, n);
    if (m.source) plus(w.ledger.generated, job.output);
    else {
      plus(w.ledger.recipeInput, job.escrow);
      plus(w.ledger.recipeOutput, job.output);
    }
    if (m.type === "channel") {
      const p = w.members[m.owner!];
      p.stats.produced =
        (p.stats.produced ?? 0) +
        Object.values(job.output).reduce((n, q) => n + q, 0);
      if (!p.tutorial.includes("craft")) p.tutorial.push("craft");
    } else
      w.stats.automaticProduced += Object.values(job.output).reduce(
        (n, q) => n + q,
        0,
      );
  }
}
export function eligible(w: World, l: Link) {
  return (
    !l.draining &&
    !!w.inventories[l.from] &&
    count(w.inventories[l.from], l.item) > 0 &&
    accepts(w, l.to, l.item) &&
    (l.to === "rocket"
      ? rocketFree(w, l.item) > 0
      : room(w, w.inventories[l.to], l.item) > 0) &&
    Object.values(w.cargo).filter((c) => c.link === l.id).length <
      B.delivery.max_in_transit_per_link
  );
}
function rotate<T extends { id: string }>(
  xs: T[],
  cursor: string | undefined,
): T[] {
  const i = Math.max(
    0,
    xs.findIndex((x) => x.id === cursor),
  );
  return [...xs.slice(i), ...xs.slice(0, i)];
}
function after(xs: Link[], id: string) {
  return xs[(xs.findIndex((x) => x.id === id) + 1) % xs.length].id;
}
export function logistics(w: World) {
  const links = sorted(w.links),
    sourceGroups = new Map<string, Link[]>(),
    destGroups = new Map<string, Link[]>();
  for (const l of links) {
    const sk = l.from + "|" + l.item,
      dk = l.to + "|" + l.item;
    sourceGroups.set(sk, [...(sourceGroups.get(sk) ?? []), l]);
    destGroups.set(dk, [...(destGroups.get(dk) ?? []), l]);
    if (eligible(w, l))
      l.credit = Math.min(
        B.delivery.base_dispatch_interval_ticks * FP,
        l.credit + w.power.ratio,
      );
  }
  const sent = new Set<string>();
  for (let round = 0; round < B.delivery.max_links; round++) {
    const proposals: Link[] = [];
    for (const [key, ls] of sourceGroups) {
      const l = rotate(ls, w.sourceCursors[key]).find(
        (l) =>
          !sent.has(l.id) &&
          l.credit >= B.delivery.base_dispatch_interval_ticks * FP &&
          eligible(w, l),
      );
      if (l) proposals.push(l);
    }
    if (!proposals.length) break;
    let granted = 0;
    for (const [dk, ls] of destGroups) {
      for (const l of rotate(ls, w.destCursors[dk]))
        if (proposals.includes(l) && eligible(w, l)) {
          remove(w.inventories[l.from], l.item, B.delivery.payload_units);
          const a = geometry(w, l.from).delivery_distance_anchor,
            b = geometry(w, l.to).delivery_distance_anchor;
          const length = Math.ceil(
            Math.sqrt(
              distance2(
                { x: a.x * UNIT, z: a.z * UNIT },
                { x: b.x * UNIT, z: b.z * UNIT },
              ),
            ),
          );
          const speed =
            (B.delivery.travel_speed_tiles_per_second *
              UNIT *
              R.timers_ms.simulation_tick) /
            1000;
          const travel = Math.max(
            B.delivery.min_travel_ticks,
            Math.ceil(length / speed),
          );
          const id = nextId(w, "cargo");
          w.cargo[id] = {
            id,
            link: l.id,
            from: l.from,
            to: l.to,
            item: l.item,
            departed: w.tick,
            arrival: (BigInt(w.tick) + BigInt(travel)).toString(),
          };
          l.credit -= B.delivery.base_dispatch_interval_ticks * FP;
          sent.add(l.id);
          const sk = l.from + "|" + l.item;
          w.sourceCursors[sk] = after(sourceGroups.get(sk)!, l.id);
          w.destCursors[dk] = after(ls, l.id);
          granted++;
        }
    }
    if (!granted) break;
  }
}
export function tick(w: World, rt: Runtime) {
  maintenance(w, rt.wallNow);
  if (
    !B.launch.automatic_economy_phases.includes(w.phase) ||
    w.pauses.length ||
    !connected(w).length
  )
    return;
  const gs = solids(w);
  for (const m of sorted(w.members)) {
    const input = rt.inputs[m.id];
    if (!m.connected) continue;
    if (
      input &&
      rt.now - input.at <= R.timers_ms.movement_input_expiry &&
      w.phase !== "COUNTDOWN" &&
      (input.dx || input.dz)
    ) {
      stopWork(w, m);
      const len = Math.max(1000, Math.hypot(input.dx, input.dz));
      const speed =
        ((m.upgrades.includes("move_tier_1")
          ? B.upgrades.move_tier_1.result_move_tiles_per_second
          : B.player.base_move_tiles_per_second) *
          UNIT *
          R.timers_ms.simulation_tick) /
        1000;
      for (const axis of ["x", "z"] as const) {
        const p = {
          ...m.position,
          [axis]:
            m.position[axis] +
            Math.round(((axis === "x" ? input.dx : input.dz) / len) * speed),
        };
        if (!blocked(p, gs)) m.position = p;
      }
      if (!m.tutorial.includes("move")) m.tutorial.push("move");
    }
    if (
      m.work &&
      (!input ||
        input.hold !== m.work.id ||
        rt.now - input.holdAt > R.timers_ms.manual_work_hold_expiry)
    )
      stopWork(w, m);
    if (m.work) {
      let g;
      if (m.work.kind === "GATHER") {
        const s = M.source_zones.find((x) => x.item_id === m.work!.target)!;
        g = {
          ...fixedGeometry[0],
          id: s.id,
          service_points: s.manual_service_points,
        };
      } else
        g = geometry(
          w,
          m.work.kind === "MANUAL_CRAFT" ? m.work.target : "rocket",
        );
      if (near(w, m.position, g) < 0) stopWork(w, m);
    }
  }
  for (const c of sorted(w.cargo))
    if (BigInt(c.arrival) <= BigInt(w.tick)) {
      if (c.to === "rocket") {
        const s = w.stages[w.stage];
        if (!s || !s.required[c.item]) fail("INVARIANT_FAILED");
        plus(s.delivered, { [c.item]: 1 });
        plus(w.ledger.rocket, { [c.item]: 1 });
      } else {
        const inv = w.inventories[c.to];
        if (!inv) fail("INVARIANT_FAILED");
        add(inv, c.item, 1);
      }
      delete w.cargo[c.id];
      w.stats.delivered++;
    }
  const active = sorted(w.machines).filter(
    (m) => m.type !== "channel" && m.enabled && (m.job || canStart(w, m)),
  );
  let supply = B.power.starter_supply_deci_units,
    demand = 0;
  for (const m of sorted(w.machines)) {
    if (m.type === "solar_array" && m.enabled)
      supply += B.machines.solar_array.supply_deci_units;
  }
  for (const m of active) {
    const type = m.type as keyof typeof B.machines;
    const rate =
      m.tier === 2
        ? m.type === "extractor"
          ? B.upgrades.extractor_mk2.power_multiplier
          : B.upgrades.machine_mk2.power_multiplier
        : { numerator: 1, denominator: 1 };
    demand +=
      (B.machines[type].power_deci_units * rate.numerator) / rate.denominator;
  }
  const hub = Object.values(w.machines).find(
    (m) => m.type === "logistics_hub" && m.enabled,
  );
  if (hub && Object.values(w.links).some((l) => eligible(w, l)))
    demand += B.machines.logistics_hub.power_deci_units;
  w.power = {
    supply,
    demand,
    ratio: demand ? Math.min(FP, Math.floor((supply * FP) / demand)) : FP,
  };
  for (const m of sorted(w.members))
    if (m.connected && m.work && w.phase !== "COUNTDOWN") {
      const job = m.work;
      if (job.kind === "GATHER") {
        const src = B.sources[job.target as keyof typeof B.sources],
          item = job.target as Item;
        job.progress = Math.min(src.manual_action_ticks, job.progress + 1);
        if (
          job.progress === src.manual_action_ticks &&
          room(w, w.inventories["bag:" + m.id], item) >= src.manual_yield
        ) {
          add(
            w.inventories["bag:" + m.id],
            item,
            src.manual_yield,
            stack(w, m.id),
          );
          plus(w.ledger.generated, { [item]: src.manual_yield });
          m.stats.gathered = (m.stats.gathered ?? 0) + src.manual_yield;
          job.progress = 0;
          if (!m.tutorial.includes("gather")) m.tutorial.push("gather");
        }
      }
      if (job.kind === "MANUAL_CRAFT") craft(w, w.machines[job.target], FP);
      if (job.kind === "INSPECTION") {
        job.progress++;
        if (job.progress >= B.construction.inspection_ticks_per_check) {
          w.checks[job.target] = true;
          stopWork(w, m);
        }
      }
    }
  for (const m of active) {
    const rate =
      m.tier === 2
        ? m.type === "extractor"
          ? B.upgrades.extractor_mk2.work_rate_multiplier
          : B.upgrades.machine_mk2.work_rate_multiplier
        : { numerator: 1, denominator: 1 };
    craft(
      w,
      m,
      Math.floor(
        (((FP * rate.numerator) / rate.denominator) * w.power.ratio) / FP,
      ),
    );
  }
  if (hub) logistics(w);
  const stage = w.stages[w.stage];
  if (stage) {
    const workers = Object.values(w.members).filter(
      (m) =>
        m.connected &&
        m.work?.kind === "ASSEMBLY" &&
        m.work.target === stage.id,
    ).length;
    if (workers) {
      const r =
        B.construction.assembly_rate_by_contributors[
          String(
            workers,
          ) as keyof typeof B.construction.assembly_rate_by_contributors
        ];
      stage.progress += (FP * r.numerator) / r.denominator;
      if (
        stage.progress >=
        B.construction.assembly_base_ticks[
          stage.id as keyof typeof B.construction.assembly_base_ticks
        ] *
          FP
      ) {
        stage.completed = true;
        stage.completedTick = w.tick;
        w.stage++;
        for (const m of Object.values(w.members))
          if (m.work?.kind === "ASSEMBLY") stopWork(w, m);
      }
    }
  }
  if (w.phase === "COUNTDOWN") {
    w.countdown--;
    if (w.countdown <= 0) {
      if (
        w.stage !== B.milestones.length ||
        !Object.values(w.checks).every(Boolean) ||
        !w.attempt
      )
        fail("INVARIANT_FAILED");
      w.phase = "LAUNCHED";
      w.result = {
        attempt: w.attempt,
        tick: w.tick,
        planned: w.planned,
        members: Object.values(w.members).map((x) => x.name),
        maxPlayers: w.stats.maxPlayers,
        automaticProduced: w.stats.automaticProduced,
        delivered: w.stats.delivered,
        stageTicks: w.stages.map((x) => x.completedTick),
      };
    }
  }
  w.tick = (BigInt(w.tick) + 1n).toString();
  assertInvariants(w);
}
export function assertInvariants(w: World) {
  const actual: Counts = {};
  for (const inv of Object.values(w.inventories))
    for (const item of ITEMS) {
      const n = count(inv, item);
      if (!Number.isInteger(n) || n < 0 || n > B.limits.integer_quantity_max)
        fail("INVARIANT_FAILED");
      plus(actual, { [item]: n });
      if (inv.kind === "BUFFER" && n + reserved(w, inv.id, item) > inv.capacity)
        fail("INVARIANT_FAILED");
    }
  for (const inv of Object.values(w.inventories))
    if (
      inv.kind === "PLAYER" &&
      (inv.slots.length !== B.player.inventory_slots ||
        inv.slots.some(
          (s) =>
            s &&
            (!Number.isInteger(s.quantity) ||
              s.quantity < 1 ||
              s.quantity > stack(w, inv.owner)),
        ))
    )
      fail("INVARIANT_FAILED");
  for (const m of Object.values(w.machines))
    if (m.job) {
      plus(actual, m.job.escrow);
      if (m.job.progress < 0 || !Number.isInteger(m.job.progress))
        fail("INVARIANT_FAILED");
    }
  for (const c of Object.values(w.cargo)) {
    plus(actual, { [c.item]: 1 });
    if (!w.links[c.link] || !(c.to === "rocket" || w.inventories[c.to]))
      fail("INVARIANT_FAILED");
  }
  for (const item of ITEMS) {
    const l = w.ledger;
    const a =
      (l.generated[item] ?? 0) +
      (l.recipeOutput[item] ?? 0) +
      (l.refunded[item] ?? 0);
    const b =
      (actual[item] ?? 0) +
      (l.recipeInput[item] ?? 0) +
      (l.spent[item] ?? 0) +
      (l.rocket[item] ?? 0);
    if (a !== b) throw Error("CONSERVATION_" + item + ":" + a + "!=" + b);
  }
  for (const s of w.stages)
    for (const [i, n] of Object.entries(s.required))
      if ((s.delivered[i as Item] ?? 0) > n) fail("INVARIANT_FAILED");
  if (w.stage < w.stages.length)
    for (const i of ITEMS) if (rocketFree(w, i) < 0) fail("INVARIANT_FAILED");
}
export function reasons(w: World, m: Machine): string[] {
  const out: string[] = [];
  if (w.pauses.length) out.push(...w.pauses);
  if (!m.enabled) out.push("MANUAL_PAUSE");
  if (
    Object.values(w.links).some(
      (l) =>
        l.draining &&
        (l.from.startsWith(m.id + ":") || l.to.startsWith(m.id + ":")),
    )
  )
    out.push("DRAINING");
  if (m.type === "solar_array") return out.length ? out : ["SUPPLYING"];
  if (m.type === "logistics_hub")
    return out.length
      ? out
      : [Object.keys(w.cargo).length ? "DELIVERING" : "DELIVERY_READY"];
  const b = batch(m);
  if (!b) out.push("SELECT_RECIPE");
  else if (!m.job) {
    if (
      Object.entries(b.output).some(
        ([i, n]) => room(w, w.inventories[m.id + ":out"], i as Item) < n,
      )
    )
      out.push("OUTPUT_FULL");
    if (
      Object.entries(b.input).some(
        ([i, n]) => count(w.inventories[m.id + ":in"], i as Item) < n,
      )
    )
      out.push("INPUT_MISSING");
  }
  if (w.power.ratio < FP) out.push("POWER_LIMITED");
  return out.length ? out : ["WORKING"];
}
