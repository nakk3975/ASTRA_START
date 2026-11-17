import { B } from "../../../../packages/content/src/index.ts";
import { screenMovement, type XZ } from "./camera";

/** Presentation-only walking area. It never creates or edits an online room. */
export function moveInPlayground(
  position: XZ,
  input: XZ,
  dt: number,
  modelBounds: XZ = { x: 1.8, z: 1.8 },
) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) return { ...position };
  const direction = screenMovement(input.x, input.z);
  const step = B.player.base_move_tiles_per_second * dt;
  const result = { ...position };
  const blocked = (x: number, z: number) =>
    x < 17 ||
    x > 32 ||
    z < 11 ||
    z > 24 ||
    // Stand clear of the inspected model and the reference hull.
    (Math.abs(x - 23) < modelBounds.x / 2 + 0.35 &&
      Math.abs(z - 16) < modelBounds.z / 2 + 0.35) ||
    (x > 25.7 && x < 28.3 && z > 14.7 && z < 17.3);
  const x = position.x + direction.x * step;
  if (!blocked(x, result.z)) result.x = x;
  const z = position.z + direction.z * step;
  if (!blocked(result.x, z)) result.z = z;
  return result;
}
