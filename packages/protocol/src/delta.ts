import { canonical } from "../../content/src/index.ts";
export type Delta = {
  set: Record<string, unknown>;
  maps: Record<string, { upsert: Record<string, unknown>; remove: string[] }>;
};
const maps = new Set([
  "members",
  "inventories",
  "machines",
  "links",
  "cargo",
  "crates",
  "sourceCursors",
  "destCursors",
]);
export function diff(before: any, after: any): Delta {
  const d: Delta = { set: {}, maps: {} };
  for (const key of Object.keys(after)) {
    if (canonical(before[key]) === canonical(after[key])) continue;
    if (maps.has(key)) {
      const a = before[key] ?? {},
        b = after[key] ?? {},
        upsert: Record<string, unknown> = {};
      for (const k of Object.keys(b))
        if (canonical(a[k]) !== canonical(b[k])) upsert[k] = b[k];
      d.maps[key] = { upsert, remove: Object.keys(a).filter((k) => !(k in b)) };
    } else d.set[key] = after[key];
  }
  return d;
}
export function applyDelta<T>(state: T, delta: Delta): T {
  const s = structuredClone(state) as any;
  Object.assign(s, delta.set);
  for (const [k, v] of Object.entries(delta.maps)) {
    s[k] ??= {};
    Object.assign(s[k], v.upsert);
    for (const id of v.remove) delete s[k][id];
  }
  return s;
}
