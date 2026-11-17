import {
  RECIPES,
  DEVICE_UNLOCK,
  type Kind,
  type DeviceKind,
} from "./config.ts";
import { machineCanRecipe, recipeAvailable } from "./progression.ts";
import type { World, Machine } from "./types.ts";

/** Remaining launch demand, net of real inventory and already-running jobs. */
export function productionDemand(w: World) {
  const stock: Partial<Record<Kind, number>> = {},
    demand: Partial<Record<Kind, number>> = {};
  for (const item of Object.values(w.items))
    if (["ground", "hand", "output", "device", "input"].includes(item.state))
      stock[item.kind] = (stock[item.kind] ?? 0) + 1;
  for (const m of Object.values(w.machines)) {
    const output = m.job && RECIPES[m.job.recipe]?.output;
    if (output) stock[output] = (stock[output] ?? 0) + 1;
  }
  const stage = w.sockets.find((s) => !s.item)?.stage;
  const needed: Partial<Record<Kind, number>> = {};
  for (const s of w.sockets)
    if (s.stage === stage && !s.item)
      needed[s.kind] = (needed[s.kind] ?? 0) + 1;
  const visit = (kind: Kind, amount: number) => {
    const available = Math.min(amount, stock[kind] ?? 0);
    stock[kind] = (stock[kind] ?? 0) - available;
    const count = amount - available;
    if (!count) return;
    demand[kind] = (demand[kind] ?? 0) + count;
    const producer = Object.values(RECIPES).find((r) => r.output === kind);
    if (producer)
      for (const [input, n] of Object.entries(producer.input))
        visit(input as Kind, count * n);
  };
  for (const [kind, n] of Object.entries(needed)) visit(kind as Kind, n);
  return demand;
}

/** The first inserted material selects a job; partial inputs keep that choice. */
export function automaticRecipe(
  w: World,
  m: Machine,
  incoming: Kind,
): string | null {
  if (w.profile === "lab") return m.recipe;
  const counts: Partial<Record<Kind, number>> = {};
  for (const id of m.input) {
    const kind = w.items[id]?.kind;
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
  }
  counts[incoming] = (counts[incoming] ?? 0) + 1;
  if (m.input.length) {
    const pending = RECIPES[m.recipe];
    return pending &&
      Object.entries(counts).every(
        ([kind, n]) => (pending.input[kind as Kind] ?? 0) >= n,
      )
      ? m.recipe
      : null;
  }
  const candidates = Object.entries(RECIPES).filter(([id, r]) => {
    if (!machineCanRecipe(m, id) || !recipeAvailable(w, id)) return false;
    // Automation kits have their own workbench/store, never swallow rocket parts.
    if (r.output.startsWith("kit_")) {
      if (m.type !== "workbench") return false;
      const key = DEVICE_UNLOCK[r.output.slice(4) as DeviceKind];
      if (key && !w.economy.upgrades.includes(key)) return false;
    }
    return Object.entries(counts).every(
      ([kind, n]) => (r.input[kind as Kind] ?? 0) >= n,
    );
  });
  if (m.type === "workbench") {
    const count = (output: Kind) =>
      Object.values(w.devices).filter((d) => `kit_${d.type}` === output)
        .length +
      Object.values(w.items).filter(
        (i) =>
          i.kind === output && !["consumed", "installed"].includes(i.state),
      ).length +
      Object.values(w.machines).filter(
        (m) => m.job && RECIPES[m.job.recipe]?.output === output,
      ).length;
    candidates.sort((a, b) => count(a[1].output) - count(b[1].output));
    return candidates[0]?.[0] ?? null;
  }
  const demand = productionDemand(w);
  // Stable recipe order makes ties predictable: ingot → plate before gear.
  return (
    candidates.find(([, r]) => (demand[r.output] ?? 0) > 0)?.[0] ??
    candidates[0]?.[0] ??
    null
  );
}
