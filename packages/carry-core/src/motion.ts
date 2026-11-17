import { CFG } from "./config.ts";
import { movementSpeed } from "./progression.ts";
import { validFloor, floorHeight } from "./map.ts";
import type { World, Player, V3 } from "./types.ts";
/** Same collision/movement integrator for authoritative simulation and visual prediction. */
export function movePosition(
  w: World,
  p: Player,
  from: V3,
  input: { x: number; z: number },
  dt: number,
): V3 {
  const pos = { ...from },
    length = Math.max(1, Math.hypot(input.x, input.z)),
    speed = movementSpeed(w, p),
    steps = Math.max(1, Math.ceil(dt / 0.016));
  for (let n = 0; n < steps; n++) {
    let next = { ...pos, x: pos.x + ((input.x / length) * speed * dt) / steps };
    if (validFloor(w, next, CFG.radius, pos)) {
      pos.x = next.x;
      pos.y = floorHeight(pos.x, pos.z);
    }
    next = { ...pos, z: pos.z + ((input.z / length) * speed * dt) / steps };
    if (validFloor(w, next, CFG.radius, pos)) {
      pos.z = next.z;
      pos.y = floorHeight(pos.x, pos.z);
    }
  }
  return pos;
}
