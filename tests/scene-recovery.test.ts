import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { releaseTree } from "../apps/web/src/visuals/lifecycle.ts";
import { ROCKET_PARTS } from "../apps/web/src/visuals/rocket.ts";
import { createVisual } from "../apps/web/src/visuals/assets.ts";

const asset = {
  id: "rocket_lower_hull",
  boundsMax: { x: 2, y: 3, z: 2 },
} as any;
function rocket() {
  const group = new T.Group();
  const source = new T.Group();
  source.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  for (const _ of ROCKET_PARTS) {
    const visual = createVisual(asset, {
      scene: source,
      animations: [],
    } as any);
    visual.root.userData.release = visual.release;
    group.add(visual.root);
  }
  return group;
}
test("reproduces plate installation and restart failure: release detaches children during traversal", () => {
  const r = rocket();
  assert.throws(() => r.traverse((n) => n.userData.release?.()), /traverse/);
  releaseTree(r);
});
test("every rocket rebuild and repeated renderer cleanup releases each part once", () => {
  for (let install = 0; install < 80; install++) {
    const r = rocket();
    const roots = [...r.children];
    let disposed = 0;
    for (const node of roots)
      node.traverse((n) => {
        if (n instanceof T.Mesh)
          (n.material as T.Material).addEventListener(
            "dispose",
            () => disposed++,
          );
      });
    releaseTree(r);
    assert.equal(r.children.length, 0);
    assert.equal(disposed, ROCKET_PARTS.length);
    releaseTree(r);
    for (const node of roots) releaseTree(node);
    assert.equal(disposed, ROCKET_PARTS.length);
  }
});

import { updateCarryRocket } from "../apps/web/src/carry/rocket-view.ts";
import { createCarryWorld, spawn } from "../packages/carry-core/src/index.ts";
test("installing every campaign component reuses rocket meshes; LOD changes and restart rebuild cleanly", () => {
  const w = createCarryWorld("projection", "PROJ", 6),
    root = new T.Group(),
    source = new T.Group();
  source.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
  let made = 0;
  const make = (id: string) => {
    made++;
    return createVisual({ ...asset, id }, {
      scene: source,
      animations: [],
    } as any);
  };
  updateCarryRocket(root, w, false, make);
  const original = [...root.children];
  for (const socket of w.sockets) {
    socket.item = spawn(w, socket.kind, socket.pos, "installed", socket.id).id;
    updateCarryRocket(root, w, false, make);
    assert.deepEqual(root.children, original);
  }
  assert.equal(made, ROCKET_PARTS.length);
  root.traverse((n) => {
    if (n instanceof T.Mesh)
      assert.equal((n.material as T.Material).opacity, 1);
  });
  updateCarryRocket(root, w, true, make);
  assert.equal(made, ROCKET_PARTS.length * 2);
  releaseTree(root);
  updateCarryRocket(root, w, true, make);
  assert.equal(root.children.length, ROCKET_PARTS.length);
  releaseTree(root);
});
