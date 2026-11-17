import * as T from "three";
import { ROCKET_PARTS } from "../visuals/rocket";
import { releaseTree } from "../visuals/lifecycle";
import type { Visual } from "../visuals/assets";
import type { World } from "../../../../packages/carry-core/src/index.ts";

/** Installation changes finish/opacity. Only a LOD change replaces geometry. */
export function updateCarryRocket(
  root: T.Group,
  w: World,
  low: boolean,
  make: (id: string, low: boolean) => Visual | null,
) {
  if (root.userData.low !== low) {
    releaseTree(root);
    root.clear();
    root.userData.low = low;
  }
  for (const part of ROCKET_PARTS) {
    let node = root.children.find((o) => o.userData.part === part.key);
    if (!node) {
      const visual = make(part.asset, low);
      if (!visual) continue;
      node = visual.root;
      node.position.set(
        18 + part.position[0] * 0.72,
        1.2 + part.position[1] * 0.72,
        part.position[2] * 0.72,
      );
      node.rotation.y = part.rotation;
      node.scale.setScalar(0.72);
      node.userData = {
        release: visual.release,
        part: part.key,
        baseY: node.position.y,
        flight: part.parent === "flight",
      };
      root.add(node);
    }
    const phase =
      part.asset === "rocket_pad"
        ? 0
        : part.asset === "rocket_gantry" || part.asset.endsWith("_hull")
          ? 1
          : part.asset === "rocket_engine"
            ? 2
            : part.asset === "rocket_panel"
              ? part.stage === 4
                ? 3
                : 4
              : 5;
    const slots = w.sockets.filter(
      (s) => s.stage === (w.profile === "lab" ? 0 : phase),
    );
    const ratio = slots.length
      ? slots.filter((s) => s.item).length / slots.length
      : 0;
    node.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = ratio === 1 && !low;
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material]) {
        if (material.transparent !== ratio < 1) {
          material.transparent = ratio < 1;
          material.needsUpdate = true;
        }
        material.opacity = 0.12 + 0.88 * ratio;
      }
    });
  }
}
