import { B, M, R, UNIT } from "../../content/src/index.ts";
import type { Geometry, Point, World } from "./types.ts";
export const center = (p: Point) => ({
  x: Math.round((p.x + 0.5) * UNIT),
  z: Math.round((p.z + 0.5) * UNIT),
});
export const distance2 = (a: Point, b: Point) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const fixedGeometry = [
  ...M.starter_entities,
  M.rocket_envelope,
] as Geometry[];
export function solids(w: World, ignore?: string): Geometry[] {
  return [
    ...fixedGeometry,
    ...Object.values(w.machines)
      .filter((m) => m.type !== "channel" && m.id !== ignore)
      .map((m) => m.geometry),
  ];
}
export function blocked(
  p: Point,
  gs: Geometry[],
  radius = R.world.player_radius_millitiles,
): boolean {
  if (
    p.x < UNIT + radius ||
    p.z < UNIT + radius ||
    p.x > (M.dimensions.width - 1) * UNIT - radius ||
    p.z > (M.dimensions.depth - 1) * UNIT - radius
  )
    return true;
  return gs.some((g) => {
    const x = g.top_left.x * UNIT,
      z = g.top_left.z * UNIT;
    const q = {
      x: Math.max(x, Math.min(p.x, x + g.footprint.width * UNIT)),
      z: Math.max(z, Math.min(p.z, z + g.footprint.depth * UNIT)),
    };
    return distance2(p, q) < radius ** 2;
  });
}
function crosses(a: Point, b: Point, g: Geometry): boolean {
  let lo = 0,
    hi = 1;
  for (const axis of ["x", "z"] as const) {
    const min = g.top_left[axis] * UNIT + 0.01,
      max =
        min +
        (axis === "x" ? g.footprint.width : g.footprint.depth) * UNIT -
        0.02;
    const d = b[axis] - a[axis];
    if (d === 0) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      let l = (min - a[axis]) / d,
        h = (max - a[axis]) / d;
      if (l > h) [l, h] = [h, l];
      lo = Math.max(lo, l);
      hi = Math.min(hi, h);
      if (lo > hi) return false;
    }
  }
  return hi > 0 && lo < 1;
}
export function near(w: World, p: Point, g: Geometry): number {
  const all = solids(w);
  let best = -1,
    dist = Infinity;
  g.service_points.forEach((s, i) => {
    const a = {
      x: s.interaction_anchor.x * UNIT,
      z: s.interaction_anchor.z * UNIT,
    };
    const d = distance2(p, a);
    if (
      d <= (B.player.base_interaction_range_tiles * UNIT) ** 2 &&
      d < dist &&
      !all.some((o) => o.id !== g.id && crosses(p, a, o))
    ) {
      best = i;
      dist = d;
    }
  });
  return best;
}
export function machineGeometry(
  id: string,
  kind: string,
  x: number,
  z: number,
  rotation: number,
): Geometry {
  const s = [
    { cell: { x: x, z: z - 1 }, interaction_anchor: { x: x + 0.5, z } },
    { cell: { x: x + 2, z }, interaction_anchor: { x: x + 2, z: z + 0.5 } },
    {
      cell: { x: x + 1, z: z + 2 },
      interaction_anchor: { x: x + 1.5, z: z + 2 },
    },
    { cell: { x: x - 1, z: z + 1 }, interaction_anchor: { x, z: z + 1.5 } },
  ][rotation];
  return {
    id,
    kind,
    top_left: { x, z },
    footprint: {
      width: B.limits.normal_machine_footprint_tiles[0],
      depth: B.limits.normal_machine_footprint_tiles[1],
    },
    rotation_degrees: rotation * 90,
    service_points: [s],
    delivery_distance_anchor: { x: x + 1, z: z + 1 },
    solid: true,
  };
}
export function placement(
  w: World,
  g: Geometry,
  ignore?: string,
): string | null {
  const x = g.top_left.x,
    z = g.top_left.z,
    wi = g.footprint.width,
    de = g.footprint.depth;
  if (!Number.isInteger(x) || !Number.isInteger(z)) return "INVALID_PLACEMENT";
  if (g.kind === "extractor") {
    if (
      !M.source_zones.some((s) =>
        s.extractor_pads.some((p) => p.top_left.x === x && p.top_left.z === z),
      )
    )
      return "DESIGNATED_PAD_REQUIRED";
  } else if (
    !M.factory_regions.some(
      (r) =>
        x >= r.x_min &&
        x + wi - 1 <= r.x_max &&
        z >= r.z_min &&
        z + de - 1 <= r.z_max,
    )
  )
    return "PROTECTED_REGION";
  const base = solids(w, ignore);
  if (
    base.some(
      (a) =>
        x < a.top_left.x + a.footprint.width &&
        x + wi > a.top_left.x &&
        z < a.top_left.z + a.footprint.depth &&
        z + de > a.top_left.z,
    )
  )
    return "OCCUPIED";
  if (
    Object.values(w.members).some(
      (p) => p.connected && blocked(p.position, [g]),
    )
  )
    return "PLAYER_OVERLAP";
  if (
    Object.values(w.crates).some(
      (p) => p.x >= x && p.x < x + wi && p.z >= z && p.z < z + de,
    )
  )
    return "RECOVERY_CRATE_OCCUPIED";
  const gs = [...base, g],
    occupied = new Set<string>();
  for (const a of gs)
    for (let xx = a.top_left.x; xx < a.top_left.x + a.footprint.width; xx++)
      for (let zz = a.top_left.z; zz < a.top_left.z + a.footprint.depth; zz++)
        occupied.add(xx + "," + zz);
  const queue = [M.spawn_points[0]],
    visited = new Set<string>();
  for (let h = 0; h < queue.length; h++) {
    const p = queue[h],
      k = p.x + "," + p.z;
    if (
      visited.has(k) ||
      occupied.has(k) ||
      p.x <= 0 ||
      p.z <= 0 ||
      p.x >= M.dimensions.width - 1 ||
      p.z >= M.dimensions.depth - 1
    )
      continue;
    visited.add(k);
    queue.push(
      { x: p.x + 1, z: p.z },
      { x: p.x - 1, z: p.z },
      { x: p.x, z: p.z + 1 },
      { x: p.x, z: p.z - 1 },
    );
  }
  const reachable = (p: Point) => visited.has(p.x + "," + p.z);
  if (
    !M.spawn_points.every(reachable) ||
    !M.source_zones.every((s) =>
      s.manual_service_points.every((p) => reachable(p.cell)),
    )
  )
    return "PATH_BLOCKED";
  if (!gs.every((a) => a.service_points.some((s) => reachable(s.cell))))
    return "SERVICE_BLOCKED";
  if (
    !Object.values(w.members)
      .filter((m) => m.connected)
      .every((m) =>
        reachable({
          x: Math.floor(m.position.x / UNIT),
          z: Math.floor(m.position.z / UNIT),
        }),
      )
  )
    return "PLAYER_TRAPPED";
  return null;
}
export function path(w: World, start: Point, goal: Point): Point[] {
  const gs = solids(w),
    s = { x: Math.floor(start.x / UNIT), z: Math.floor(start.z / UNIT) },
    q = [s],
    prev = new Map<string, Point | null>([[s.x + "," + s.z, null]]);
  let found: Point | undefined;
  for (let h = 0; h < q.length; h++) {
    const p = q[h];
    if (p.x === goal.x && p.z === goal.z) {
      found = p;
      break;
    }
    for (const n of [
      { x: p.x + 1, z: p.z },
      { x: p.x - 1, z: p.z },
      { x: p.x, z: p.z + 1 },
      { x: p.x, z: p.z - 1 },
    ]) {
      const k = n.x + "," + n.z;
      if (!prev.has(k) && !blocked(center(n), gs)) {
        prev.set(k, p);
        q.push(n);
      }
    }
  }
  if (!found) return [];
  const out: Point[] = [];
  let p: Point | null = found;
  while (p) {
    out.push(center(p));
    p = prev.get(p.x + "," + p.z) ?? null;
  }
  return out.reverse().slice(1);
}
