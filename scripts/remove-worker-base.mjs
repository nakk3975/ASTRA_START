// Remove the generated display pedestal before rigging, not the character's feet.
import { NodeIO } from "@gltf-transform/core";
import { prune, weld, simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
const io = new NodeIO(),
  d = await io.read("assets/source/worker/model/model.glb");
let removed = 0;
for (const m of d.getRoot().listMeshes())
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute("POSITION"),
      old = p.getIndices(),
      keep = [];
    // Original model's pedestal occupies y <= -0.371; retain both shoe soles.
    for (let i = 0; i < old.getCount(); i += 3) {
      const t = [old.getScalar(i), old.getScalar(i + 1), old.getScalar(i + 2)];
      if (t.every((j) => pos.getElement(j, [])[1] < -0.371)) {
        removed++;
        continue;
      }
      keep.push(...t);
    }
    p.setIndices(
      d
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint32Array(keep))
        .setBuffer(d.getRoot().listBuffers()[0]),
    );
  }
await MeshoptSimplifier.ready;
await d.transform(
  prune(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.94, error: 0.01 }),
);
await io.write("assets/source/worker/cleaned.glb", d);
console.log({ removed });
