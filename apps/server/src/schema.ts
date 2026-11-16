import { schema, t, type SchemaType, StateView } from "@colyseus/schema";
import type { World } from "../../../packages/game-core/src/index.ts";
import { canonical } from "../../../packages/content/src/index.ts";
export const Personal = schema(
  { memberId: t.string(), data: t.string() },
  "Personal",
);
export const GameState = schema(
  {
    version: t.string(),
    epoch: t.string(),
    publicData: t.map("string"),
    privateData: t.map(Personal).view(),
  },
  "GameState",
);
export type GameState = SchemaType<typeof GameState>;
export function publishSchema(s: GameState, w: World, epoch: string) {
  s.version = w.version;
  s.epoch = epoch;
  const pub = structuredClone(w);
  const chunks: Record<string, string> = {};
  for (const m of Object.values(pub.members)) {
    m.guestId = "";
    let p = s.privateData.get(m.id);
    if (!p) {
      p = new Personal();
      p.memberId = m.id;
      s.privateData.set(m.id, p);
    }
    p.data = canonical({
      inventories: Object.fromEntries(
        Object.entries(w.inventories).filter(([, i]) => i.owner === m.id),
      ),
      machines: Object.fromEntries(
        Object.entries(w.machines).filter(([, x]) => x.owner === m.id),
      ),
    });
  }
  pub.inventories = Object.fromEntries(
    Object.entries(pub.inventories).filter(([, i]) => !i.owner),
  );
  pub.machines = Object.fromEntries(
    Object.entries(pub.machines).filter(([, m]) => !m.owner),
  );
  for (const [key, value] of Object.entries(pub)) {
    if (
      [
        "members",
        "inventories",
        "machines",
        "links",
        "cargo",
        "crates",
      ].includes(key)
    ) {
      chunks[key] = "@map";
      for (const [id, data] of Object.entries(value as object))
        chunks[key + "|" + id] = canonical(data);
    } else chunks[key] = canonical(value);
  }
  for (const k of [...s.publicData.keys()])
    if (!(k in chunks)) s.publicData.delete(k);
  for (const [k, v] of Object.entries(chunks))
    if (s.publicData.get(k) !== v) s.publicData.set(k, v);
}
export { StateView };
