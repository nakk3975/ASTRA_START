import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  weld,
  simplify,
  join,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs/promises";
import crypto from "node:crypto";
const [id, source, taskId, imageTaskId] = process.argv.slice(2);
const catalog = JSON.parse(await fs.readFile("design/asset_catalog_v1_1.json"));
const spec = catalog.assets.find((x) => x.id === id);
if (!spec || !source || !taskId)
  throw Error(
    "Usage: node scripts/prepare-asset.mjs ID SOURCE TASK_ID IMAGE_TASK_ID",
  );
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.read(source);
await doc.transform(
  dedup(),
  weld(),
  join(),
  prune(),
  textureCompress({
    encoder: sharp,
    resize: [spec.final_basecolor_max_px, spec.final_basecolor_max_px],
    targetFormat: "webp",
  }),
);
const triangles = (d) =>
  d
    .getRoot()
    .listMeshes()
    .reduce(
      (s, m) =>
        s +
        m
          .listPrimitives()
          .reduce(
            (s, p) =>
              s +
              (p.getIndices()?.getCount() ??
                p.getAttribute("POSITION").getCount()) /
                3,
            0,
          ),
      0,
    );
const result = {
  id,
  sourceTaskId: taskId,
  sourceImageTaskId: imageTaskId,
  geometryModel: spec.geometry_model,
  textureModel: spec.texture_model,
  license: "PENDING_PROVIDER_CONFIRMATION",
  review: "PENDING_GAME_REVIEW",
  boundsMax: spec.bounds_max_tiles,
  clips: doc
    .getRoot()
    .listAnimations()
    .map((x) => x.getName()),
  lods: [],
};
for (const [level, cap] of [
  [0, spec.lod0_triangle_cap],
  [1, spec.lod1_triangle_cap],
]) {
  let n = triangles(doc);
  if (n > cap)
    await doc.transform(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: (cap / n) * 0.94,
        error: 0.15,
      }),
    );
  n = triangles(doc);
  if (n > cap)
    throw Error(`Triangle budget exceeded ${id} LOD${level}: ${n}>${cap}`);
  const data = await io.writeBinary(doc),
    sha = crypto.createHash("sha256").update(data).digest("hex");
  const file = `${id}-lod${level}.${sha.slice(0, 12)}.glb`,
    dir = "apps/web/public/assets/visuals/1.1.0";
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/${file}`, data);
  result.lods.push({
    level,
    url: `/assets/visuals/1.1.0/${file}`,
    sha256: sha,
    bytes: data.length,
    triangles: n,
    materials: doc.getRoot().listMaterials().length,
    textures: doc
      .getRoot()
      .listTextures()
      .map((t) => ({ size: t.getSize(), mime: t.getMimeType() })),
  });
}
const path = "apps/web/public/assets/visuals/1.1.0/manifest.json";
let manifest = { version: "1.1.0", status: "PILOT_IN_PROGRESS", assets: [] };
try {
  manifest = JSON.parse(await fs.readFile(path));
} catch {}
manifest.assets = manifest.assets.filter((a) => a.id !== id);
manifest.assets.push(result);
manifest.assets.sort((a, b) => a.id.localeCompare(b.id));
await fs.writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
