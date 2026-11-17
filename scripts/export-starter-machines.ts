import * as T from "three";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { starterMachine } from "../apps/web/src/carry/starter-machines.ts";
import {
  MACHINE_CATALOG,
  type MachineKind,
} from "../packages/carry-core/src/index.ts";
(globalThis as any).FileReader = class {
  result: ArrayBuffer | null = null;
  onloadend?: () => void;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
};
const scene = new T.Group(),
  report = [];
for (const [index, kind] of (
  Object.keys(MACHINE_CATALOG) as MachineKind[]
).entries()) {
  const model = starterMachine(kind);
  const bounds = new T.Box3().setFromObject(model),
    size = bounds.getSize(new T.Vector3());
  assert.ok(
    size.x <= 2.35 && size.z <= 2.1 && size.y <= 2.1,
    `${kind} exceeds its footprint`,
  );
  assert.ok(bounds.min.y >= -0.001, `${kind} intersects the floor`);
  let triangles = 0;
  model.traverse((o) => {
    if (o instanceof T.Mesh)
      triangles += o.geometry.attributes.position.count / 3;
  });
  assert.ok(triangles < 2200);
  report.push({
    kind,
    size: size.toArray(),
    materialBatches: model.children.length,
    triangles,
  });
  model.position.set(((index % 3) - 1) * 3.8, 0, Math.floor(index / 3) * 3.3);
  scene.add(model);
}
const data = await new GLTFExporter().parseAsync(scene, { binary: true });
await writeFile(
  "/tmp/scrap-starter-machines.glb",
  Buffer.from(data as ArrayBuffer),
);
await writeFile(
  "docs/carry/evidence/starter-machines-geometry.json",
  JSON.stringify({ pass: true, liveWebGL: false, models: report }, null, 2) +
    "\n",
);
scene.children.forEach((o) => o.userData.dispose());
console.log(JSON.stringify(report));
