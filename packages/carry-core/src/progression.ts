import {
  CFG,
  ITEM,
  RECIPES,
  UPGRADES,
  MACHINE_CATALOG,
  MACHINE_TIER_SPEED,
  INSTALL_VALUE,
  CHARACTERS,
  VEIN_UNLOCKS,
  type OreKind,
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
export const startingFunds = (_planned: number) => 0;
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
  (INSTALL_VALUE[i.kind] ?? 0) +
  (INSTALL_VALUE[i.kind] ? Math.max(0, Math.floor(i.quality ?? 0)) : 0);
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
      medium.includes(id) ||
      ["assemble_engine", "assemble_control"].includes(id) ||
      r.machine === "workbench"
    );
  return m.type === r.machine;
}
export const validAvatar = (id: unknown) => CHARACTERS.some((c) => c.id === id);
export const machineKind = (v: unknown): v is MachineKind =>
  typeof v === "string" && Object.hasOwn(MACHINE_CATALOG, v);
export const nextResearch = (w: World, key: string) =>
  Object.hasOwn(UPGRADES, key) && !w.economy.upgrades.includes(key);

export const veinUnlocked = (w: World, kind: Kind) =>
  w.veins[kind]?.unlocked === true;
export function veinUnlockReason(w: World, kind: Kind) {
  if (!Object.hasOwn(VEIN_UNLOCKS, kind)) return "알 수 없는 광맥입니다.";
  if (veinUnlocked(w, kind)) return "이미 열린 광맥입니다.";
  const spec = VEIN_UNLOCKS[kind as OreKind];
  if (spec.requires && !veinUnlocked(w, spec.requires))
    return `${ITEM[spec.requires].name}부터 해금하세요.`;
  if (w.economy.xp < spec.xp) return `${spec.xp} XP가 필요합니다.`;
  const cost = researchCost(w, spec.cost);
  if (w.economy.coins < cost) return `${cost} 코인이 필요합니다.`;
  return "";
}
/** Hide recipes whose raw materials have not yet been discovered. */
export function recipeAvailable(w: World, id: string): boolean {
  if (id === "lab_plate") return w.profile === "lab";
  const recipe = RECIPES[id];
  if (!recipe) return false;
  if (w.profile !== "lab" && w.economy.xp < recipeUnlockXp(id)) return false;
  const available = (kind: Kind, seen: Set<Kind>): boolean => {
    if (Object.hasOwn(VEIN_UNLOCKS, kind)) return veinUnlocked(w, kind);
    if (seen.has(kind)) return false;
    const producer = Object.values(RECIPES).find((r) => r.output === kind);
    return (
      !!producer &&
      Object.keys(producer.input).every((k) =>
        available(k as Kind, new Set([...seen, kind])),
      )
    );
  };
  return Object.keys(recipe.input).every((k) =>
    available(k as Kind, new Set()),
  );
}

/** Essential production never requires spending the finite installation income. */
export function recipeUnlockXp(id: string) {
  return ["assemble_engine", "assemble_control"].includes(id)
    ? 50
    : medium.includes(id) || RECIPES[id]?.machine === "workbench"
      ? 24
      : 0;
}
