import {
  CFG,
  ITEM,
  RECIPES,
  UPGRADES,
  MACHINE_CATALOG,
  MACHINE_TIER_SPEED,
  SALE_VALUE,
  CHARACTERS,
  type Kind,
  type MachineKind,
} from "./config.ts";
import type { World, Player, Item, Machine } from "./types.ts";
export const level = (w: World, prefix: string) =>
  Math.max(
    0,
    ...w.economy.upgrades
      .filter((k) => new RegExp(`^${prefix}[0-9]+$`).test(k))
      .map((k) => Number(k.slice(prefix.length))),
  );
export const hands = (p: Player) => [
  ...(p.hand ? [p.hand] : []),
  ...(p.extraHands ?? []),
];
export const carryCapacity = (w: World) =>
  Math.max(1, Math.min(8, level(w, "carry")));
export const movementSpeed = (w: World, p: Player) =>
  CFG.speed *
  (1 + 0.06 * Math.min(5, level(w, "speed"))) *
  (hands(p).some((id) => ITEM[w.items[id]?.kind]?.heavy)
    ? 0.8 + 0.04 * Math.min(3, level(w, "handling"))
    : 1);
export const researchCost = (w: World, base: number) =>
  Math.ceil(base * (1 + 0.15 * (w.planned - 1)));
export const startingFunds = (planned: number) => 80 + 24 * (planned - 1);
export const machineCapacity = (m: Machine) => 2 + (m.tier ?? 0);
export const machineSpeed = (w: World, m: Machine) =>
  MACHINE_TIER_SPEED[m.tier ?? 0] *
  (1 + 0.08 * Math.min(3, level(w, "processing")));
export const miningSeconds = (w: World, kind: Kind, automatic = false) =>
  (automatic ? 3.8 : 0.8) /
  (1 + (w.veins[kind]?.level ?? 0) * 0.12) /
  (automatic ? 1 : 1 + 0.18 * Math.min(4, level(w, "tool")));
export const railSeconds = (w: World) =>
  [1.8, 1.5, 1.25, 1.05, 0.9][Math.min(4, level(w, "rail"))];
export const itemValue = (i: Item) =>
  Math.floor((SALE_VALUE[i.kind] ?? 0) * (1 + 0.15 * (i.quality ?? 0)));
const basic = [
  "smelt_ingot",
  "draw_wire",
  "recycle_polymer",
  "press_plate",
  "cut_gear",
];
const medium = ["assemble_circuit", "assemble_hull", "blend_fuel"];
export function machineCanRecipe(m: Machine, id: string) {
  const r = RECIPES[id];
  if (id === "lab_plate") return m.type === "processor";
  if (!r) return false;
  if (m.type === "bench")
    return (
      basic.includes(id) ||
      (m.tier >= 1 && medium.includes(id)) ||
      (m.tier >= 2 && ["assemble_engine", "assemble_control"].includes(id)) ||
      (m.tier >= 1 && r.machine === "workbench")
    );
  return m.type === r.machine;
}
export const validAvatar = (id: unknown) => CHARACTERS.some((c) => c.id === id);
export const machineKind = (v: unknown): v is MachineKind =>
  typeof v === "string" && Object.hasOwn(MACHINE_CATALOG, v);
export const nextResearch = (w: World, key: string) =>
  Object.hasOwn(UPGRADES, key) && !w.economy.upgrades.includes(key);
