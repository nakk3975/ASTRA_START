import { B, FP } from "../../../../packages/content/src/index.ts";
import type { World } from "../../../../packages/game-core/src/index.ts";

export type RocketPart = {
  key: string;
  asset: string;
  parent: "ground" | "flight";
  position: [number, number, number];
  rotation: number;
  stage: number;
};
const part = (
  asset: string,
  stage: number,
  parent: RocketPart["parent"],
  y: number,
  x = 0,
  z = 0,
  rotation = 0,
  suffix = "",
): RocketPart => ({
  key: asset + suffix,
  asset,
  stage,
  parent,
  position: [x, y, z],
  rotation,
});
export const ROCKET_PARTS: readonly RocketPart[] = [
  part("rocket_pad", 0, "ground", 0),
  part("rocket_gantry", 1, "ground", 0.25),
  part("rocket_lower_hull", 2, "flight", 1.2),
  part("rocket_upper_hull", 2, "flight", 4.2),
  part("rocket_engine", 3, "flight", 0.25),
  ...Array.from({ length: 4 }, (_, i) => {
    const angle = (i * Math.PI) / 2;
    return part(
      "rocket_fin",
      3,
      "flight",
      1.2,
      Math.cos(angle) * 1.1,
      Math.sin(angle) * 1.1,
      -angle,
      `:${i}`,
    );
  }),
  part("rocket_nose", 4, "flight", 6.2),
  ...Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4;
    return part(
      "rocket_panel",
      i === 0 ? 4 : 5,
      "flight",
      3,
      Math.cos(angle) * 1.01,
      Math.sin(angle) * 1.01,
      -angle,
      `:${i}`,
    );
  }),
];
const quarter = (ratio: number) =>
  Math.max(0, Math.min(4, Math.floor(ratio * 4)));

/** Pure snapshot projection: never consumes stock or advances a server stage. */
export function rocketPresentation(world: Pick<World, "stage" | "stages">) {
  const current = world.stages[world.stage];
  const required = current
    ? Object.values(current.required).reduce((sum, n) => sum + n, 0)
    : 0;
  const supplied = current
    ? Object.entries(current.required).reduce(
        (sum, [item, n]) =>
          sum +
          Math.min(
            n,
            current.delivered[item as keyof typeof current.delivered] ?? 0,
          ),
        0,
      )
    : 0;
  const delivery = current ? quarter(supplied / Math.max(1, required)) : 4;
  const ticks = current
    ? B.construction.assembly_base_ticks[
        current.id as keyof typeof B.construction.assembly_base_ticks
      ]
    : 1;
  const assembly = current ? quarter(current.progress / (ticks * FP)) : 4;
  const stageParts = ROCKET_PARTS.filter((p) => p.stage === world.stage);
  const visibleCount = Math.ceil((stageParts.length * delivery) / 4);
  const assembledCount = Math.ceil((stageParts.length * assembly) / 4);
  const parts = ROCKET_PARTS.flatMap((p) => {
    if (p.stage < world.stage) return [{ ...p, assembled: true }];
    const index = stageParts.indexOf(p);
    if (p.stage !== world.stage || index >= visibleCount) return [];
    return [{ ...p, assembled: index < assembledCount }];
  });
  return {
    parts,
    delivery,
    assembly,
    key: `${world.stage}:${delivery}:${assembly}`,
  };
}
