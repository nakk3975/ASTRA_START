import balance from '../../../design/balance_v1.json';
import map from '../../../design/map_v1.json';
import runtime from '../../../design/runtime_v1.json';
export const B = balance;
export const M = map;
export const R = runtime;
export type Item = keyof typeof B.items;
export type Recipe = keyof typeof B.recipes;
export type MachineType = keyof typeof B.machines;
export type Upgrade = keyof typeof B.upgrades;
export type Counts = Partial<Record<Item, number>>;
export const ITEMS = Object.keys(B.items) as Item[];
export const RECIPES = Object.keys(B.recipes) as Recipe[];
export const FP = B.power.progress_fixed_point_scale;
export const UNIT = R.world.millitiles_per_tile;
export const step = R.timers_ms.simulation_tick;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function goals(n: number): Counts[] {
 const scale = B.planned_players.scales[String(n) as keyof typeof B.planned_players.scales];
 if (!scale) throw Error('BAD_PAYLOAD');
 return B.milestones.map(m => Object.fromEntries(Object.entries(m.base_targets).filter(([,q])=>q!==undefined).map(([i,q])=>[i,Math.ceil(q!*scale.numerator/scale.denominator)])));
}
export function validateContent() {
 if (B.tick_ms!==step || B.timing.commit_batch_ticks*step!==R.timers_ms.economic_commit_batch_max) throw Error('CONTENT_TIMING_CONFLICT');
 if(B.planned_players.maximum!==R.world.max_players) throw Error('CONTENT_PLAYERS_CONFLICT');
 for(const r of Object.values(B.recipes)) for(const i of [...Object.keys(r.input),...Object.keys(r.output)]) if(!ITEMS.includes(i as Item))throw Error('UNKNOWN_ITEM');
 return {contentVersion:R.content_version,mapVersion:M.map_version,runtimeVersion:R.runtime_version,schemaVersion:B.schema_version};
}
export const versions = validateContent();
