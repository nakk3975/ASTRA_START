import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { starterMachine } from "../apps/web/src/carry/starter-machines.ts";
import {
  occlusionMaterials,
  occlusionRay,
} from "../apps/web/src/visuals/occlusion.ts";
import {
  MACHINE_CATALOG,
  type MachineKind,
} from "../packages/carry-core/src/index.ts";

test("reproduces the 3.1.2 installation freeze: a name sprite cannot be raycast without a camera", (t) => {
  t.mock.method(console, "error", () => {});
  const bench = starterMachine("bench");
  bench.add(new T.Sprite(new T.SpriteMaterial()));
  bench.updateMatrixWorld(true);
  assert.throws(
    () => new T.Raycaster().intersectObject(bench, true),
    /matrixWorld/,
  );
  bench.userData.dispose();
});
for (const kind of Object.keys(MACHINE_CATALOG) as MachineKind[]) {
  test(`install, rotate and remove ${kind}: name labels cannot stop scene occlusion`, () => {
    const camera = new T.OrthographicCamera(-20, 20, 12, -12, 0.1, 100);
    camera.position.set(16, 22, 16);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const target = new T.Vector3(0, 0, 0);
    const machine = starterMachine(kind);
    const labelMaterial = new T.SpriteMaterial();
    const label = new T.Sprite(labelMaterial);
    label.position.y = 2.35;
    label.raycast = () => {
      throw Error("Label must never be an occluder");
    };
    machine.add(label);
    const scene = new T.Scene();
    scene.add(machine);
    let hadHit = false;
    for (let frame = 0; frame < 120; frame++) {
      machine.rotation.y = (Math.floor(frame / 30) * Math.PI) / 2;
      const hit = occlusionMaterials(occlusionRay(camera, target), [machine]);
      assert.ok(!hit.has(labelMaterial));
      hadHit ||= hit.size > 0;
    }
    assert.ok(hadHit, "the machine geometry still participates in occlusion");
    machine.removeFromParent();
    machine.userData.dispose();
    labelMaterial.dispose();
    assert.equal(
      occlusionMaterials(occlusionRay(camera, target), scene.children).size,
      0,
    );
  });
}
