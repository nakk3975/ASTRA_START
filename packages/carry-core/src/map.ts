import { veinUnlocked } from "./progression.ts";
import { CFG } from "./config.ts";
import type { V3, World, Rect } from "./types.ts";
export const MAP = {
  minX: -24,
  maxX: 24,
  minZ: -13,
  maxZ: 13,
  pad: { x: 17, z: 0, w: 10, d: 12 },
  ramp: { x: 10, z: 0, w: 4, d: 4 },
  height: 1.2,
};
export const SOURCES = [
  { kind: "metal_scrap", x: -19, z: -7 },
  { kind: "cable_scrap", x: -19, z: -2 },
  { kind: "plastic_scrap", x: -19, z: 3 },
  { kind: "energy_shard", x: -19, z: 8 },
] as const;
export const veinPort = (s: { x: number; z: number }): V3 => ({
  x: s.x + 1.3,
  y: 0,
  z: s.z,
});
export function floorHeight(x: number, z: number) {
  if (x >= 12 && x <= 22 && Math.abs(z) <= 6 + 1e-7) return MAP.height;
  if (x >= 8 && x < 12 && Math.abs(z) <= 2 + 1e-7)
    return ((x - 8) / 4) * MAP.height;
  return 0;
}
export const machinePort = (
  m: { pos: V3; rotation?: number },
  output = false,
): V3 => {
  const a = ((m.rotation ?? 0) * Math.PI) / 2,
    k = output ? 1.6 : -1.6;
  return {
    x: m.pos.x + Math.round(Math.cos(a)) * k,
    y: m.pos.y,
    z: m.pos.z + Math.round(Math.sin(a)) * k,
  };
};
export function walls(w: World): Rect[] {
  return [
    ...SOURCES.filter((s) => veinUnlocked(w, s.kind)).map((s) => ({
      x: s.x,
      z: s.z,
      w: 1.8,
      d: 1.8,
    })),
    ...Object.values(w.machines).map((m) => ({
      x: m.pos.x,
      z: m.pos.z,
      w: (m.rotation ?? 0) % 2 ? 2.1 : 2.35,
      d: (m.rotation ?? 0) % 2 ? 2.35 : 2.1,
    })),
    { x: -22.6, z: 0, w: 0.3, d: 23 },
    { x: 18, z: 0, w: 2.8, d: 2.8 },
    ...Object.values(w.devices)
      .filter((d) => d.type === "crane")
      .map((d) => ({ x: d.pos.x, z: d.pos.z, w: 0.7, d: 0.7 })),
  ];
}
export function rectHit(x: number, z: number, r: Rect, pad: number) {
  return Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(z - r.z) < r.d / 2 + pad;
}
export function validFloor(w: World, p: V3, radius = CFG.radius, from?: V3) {
  if (
    p.x < MAP.minX + radius ||
    p.x > MAP.maxX - radius ||
    p.z < MAP.minZ + radius ||
    p.z > MAP.maxZ - radius
  )
    return false;
  if (walls(w).some((r) => rectHit(p.x, p.z, r, radius))) return false;
  return (
    !from ||
    Math.abs(floorHeight(p.x, p.z) - floorHeight(from.x, from.z)) < 0.22
  );
}
export function clearLine(w: World, a: V3, b: V3, radius = 0.02) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    if (walls(w).some((r) => rectHit(p.x, p.z, r, radius))) return false;
    if (floorHeight(p.x, p.z) > p.y + 0.6) return false;
  }
  return true;
}
export function reachable(w: World, a: V3, b: V3) {
  return (
    Math.hypot(a.x - b.x, a.z - b.z) <= CFG.reach &&
    Math.abs(a.y - b.y) < 0.8 &&
    clearLine(w, a, b)
  );
}
export function safeFloor(w: World, near: V3, ignore?: string): V3 {
  for (let radius = 0; radius <= 5; radius += 0.5)
    for (let k = 0; k < 16; k++) {
      const x = Math.max(
          -21,
          Math.min(23, near.x + Math.cos((k * Math.PI) / 8) * radius),
        ),
        z = Math.max(
          -12,
          Math.min(12, near.z + Math.sin((k * Math.PI) / 8) * radius),
        );
      const p = { x, y: floorHeight(x, z), z };
      if (
        validFloor(w, p, 0.25) &&
        !Object.values(w.items).some(
          (i) =>
            i.id !== ignore &&
            i.state === "ground" &&
            Math.hypot(i.pos.x - x, i.pos.z - z) < 0.55,
        )
      )
        return p;
    }
  // Tracked overflow recovery apron, independent of raw spawning quotas.
  const n = Object.values(w.items).filter(
    (i) => i.state === "ground" && i.pos.z > 11,
  ).length;
  return { x: -17 + (n % 34), y: 0, z: 11.5 + Math.floor(n / 34) * 0.08 };
}
