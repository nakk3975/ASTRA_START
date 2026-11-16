import { B, ITEMS, type Item, type Counts } from "../../content/src/index.ts";
import type { Inventory, World } from "./types.ts";
export function fail(code: string): never {
  throw new Error(code);
}
export const count = (i: Inventory, item: Item) =>
  i.kind === "PLAYER"
    ? i.slots.reduce((n, s) => n + (s?.item === item ? s.quantity : 0), 0)
    : (i.counts[item] ?? 0);
export const total = (i: Inventory) =>
  ITEMS.reduce((n, item) => n + count(i, item), 0);
export function stack(w: World, owner: string): number {
  const u = w.members[owner].upgrades;
  return u.includes("carry_tier_2")
    ? B.upgrades.carry_tier_2.result_stack_size
    : u.includes("carry_tier_1")
      ? B.upgrades.carry_tier_1.result_stack_size
      : B.player.base_stack_size;
}
export function reserved(w: World, id: string, item: Item): number {
  let n = 0;
  for (const m of Object.values(w.machines))
    if (m.id + ":out" === id && m.job) n += m.job.output[item] ?? 0;
  for (const c of Object.values(w.cargo)) if (c.to === id) n++;
  return n;
}
export function room(w: World, inv: Inventory, item: Item): number {
  if (inv.kind === "PLAYER") {
    const cap = stack(w, inv.owner);
    return inv.slots.reduce(
      (n, s) => n + (s === null ? cap : s.item === item ? cap - s.quantity : 0),
      0,
    );
  }
  return inv.capacity - count(inv, item) - reserved(w, inv.id, item);
}
export function add(
  inv: Inventory,
  item: Item,
  n: number,
  cap = B.player.base_stack_size,
) {
  if (!Number.isInteger(n) || n < 0) fail("INVARIANT_FAILED");
  if (inv.kind === "PLAYER") {
    for (const s of inv.slots)
      if (s?.item === item) {
        const take = Math.min(n, cap - s.quantity);
        s.quantity += take;
        n -= take;
      }
    for (let j = 0; j < inv.slots.length && n; j++)
      if (!inv.slots[j]) {
        const take = Math.min(n, cap);
        inv.slots[j] = { item, quantity: take };
        n -= take;
      }
    if (n) fail("INVENTORY_FULL");
  } else {
    const v = (inv.counts[item] ?? 0) + n;
    if (v > B.limits.integer_quantity_max) fail("RECOVERY_CAPACITY_REQUIRED");
    inv.counts[item] = v;
  }
  inv.version++;
}
export function remove(inv: Inventory, item: Item, n: number) {
  if (count(inv, item) < n) fail("NOT_ENOUGH_ITEMS");
  if (inv.kind === "PLAYER")
    for (let j = inv.slots.length - 1; j >= 0 && n; j--) {
      const s = inv.slots[j];
      if (s?.item !== item) continue;
      const t = Math.min(n, s.quantity);
      s.quantity -= t;
      n -= t;
      if (!s.quantity) inv.slots[j] = null;
    }
  else {
    inv.counts[item] = (inv.counts[item] ?? 0) - n;
    if (!inv.counts[item]) delete inv.counts[item];
  }
  inv.version++;
}
export function plus(dst: Counts, src: Counts) {
  for (const [i, n] of Object.entries(src))
    dst[i as Item] = (dst[i as Item] ?? 0) + n;
}
export function spend(w: World, member: string, cost: Counts) {
  const bag = w.inventories["bag:" + member];
  for (const [i, n] of Object.entries(cost))
    if (count(bag, i as Item) < n) fail("NOT_ENOUGH_ITEMS");
  for (const [i, n] of Object.entries(cost)) remove(bag, i as Item, n);
  plus(w.ledger.spent, cost);
}
export function buffer(
  id: string,
  capacity: number,
  owner: string | null = null,
): Inventory {
  return { id, kind: "BUFFER", owner, counts: {}, capacity, version: 0 };
}
