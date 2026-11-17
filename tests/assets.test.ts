import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import * as T from "three";
import { createVisual, playClip } from "../apps/web/src/visuals/assets.ts";
const dir = "apps/web/public",
  manifest = JSON.parse(
    await fs.readFile(dir + "/assets/visuals/1.1.0/manifest.json", "utf8"),
  );
test("all 26 catalog models have real GLBs within both LOD budgets", async () => {
  const catalog = JSON.parse(
    await fs.readFile("design/asset_catalog_v1_1.json", "utf8"),
  );
  assert.equal(manifest.assets.length, 26);
  assert.deepEqual(
    manifest.assets.map((a: any) => a.id).sort(),
    catalog.assets.map((a: any) => a.id).sort(),
  );
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const a of manifest.assets)
    for (const l of a.lods) {
      const data = await fs.readFile(dir + l.url);
      assert.equal(
        crypto.createHash("sha256").update(data).digest("hex"),
        l.sha256,
      );
      assert.equal(data.length, l.bytes);
      const d = await io.read(dir + l.url);
      let tris = 0;
      for (const m of d.getRoot().listMeshes())
        for (const p of m.listPrimitives())
          tris +=
            (p.getIndices()?.getCount() ??
              p.getAttribute("POSITION")!.getCount()) / 3;
      assert.equal(tris, l.triangles);
      const spec = catalog.assets.find((s: any) => s.id === a.id);
      assert.ok(
        tris <= spec[l.level === 0 ? "lod0_triangle_cap" : "lod1_triangle_cap"],
        `${a.id} LOD${l.level} triangle budget`,
      );
      assert.equal(d.getRoot().listMaterials().length, 1);
      for (const t of d.getRoot().listTextures())
        assert.ok(
          t.getSize()!.every((n) => n <= (a.id === "worker" ? 1024 : 512)),
        );
      if (a.id === "worker") {
        assert.ok(d.getRoot().listSkins().length > 0);
        assert.deepEqual(
          d
            .getRoot()
            .listAnimations()
            .map((x) => x.getName())
            .sort(),
          ["carry_locomotion", "celebrate", "idle", "locomotion", "work_loop"],
        );
        for (const name of ["root", "hips", "hand_left", "hand_right"])
          assert.ok(
            d
              .getRoot()
              .listNodes()
              .some((n) => n.getName() === name),
          );
        for (const anim of d.getRoot().listAnimations())
          for (const ch of anim.listChannels()) {
            const arr = ch.getSampler()!.getOutput()!.getArray()!;
            assert.ok(Array.from(arr).every(Number.isFinite));
            if (
              ch.getTargetPath() === "translation" &&
              ["root", "hips"].includes(ch.getTargetNode()!.getName())
            )
              for (let i = 3; i < arr.length; i += 3) {
                assert.equal(arr[i], arr[0]);
                assert.equal(arr[i + 2], arr[2]);
              }
          }
      }
    }
});
test("all five shipped worker clips move the actual rig and releasing one clone preserves another", async () => {
  const asset = manifest.assets.find((a: any) => a.id === "worker");
  const measurements: any[] = [];
  for (const lod of asset.lods) {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(dir + lod.url);
    for (const texture of doc.getRoot().listTextures()) texture.dispose();
    const bytes = await io.writeBinary(doc);
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
      "",
    );
    for (const clip of gltf.animations) {
      const visual = createVisual(asset, gltf);
      const bones: T.Bone[] = [];
      visual.root.traverse((o) => {
        if (o instanceof T.Bone) bones.push(o);
      });
      playClip(visual, clip.name);
      visual.mixer!.setTime(0);
      const start = bones.map((b) => [
        ...b.position.toArray(),
        ...b.quaternion.toArray(),
      ]);
      visual.mixer!.setTime(clip.duration * 0.37);
      const changed = bones.filter((b, i) =>
        [...b.position.toArray(), ...b.quaternion.toArray()].some(
          (v, j) => Math.abs(v - start[i][j]) > 1e-6,
        ),
      ).length;
      assert.ok(
        changed > 0,
        `${clip.name} LOD${lod.level} must animate real bones`,
      );
      assert.deepEqual(visual.root.position.toArray(), [0, 0, 0]);
      measurements.push({
        lod: lod.level,
        clip: clip.name,
        duration: clip.duration,
        movingBones: changed,
      });
      visual.release();
    }
    const a = createVisual(asset, gltf),
      b = createVisual(asset, gltf);
    const geometry = new Set<T.BufferGeometry>();
    b.root.traverse((o) => {
      if (o instanceof T.Mesh) geometry.add(o.geometry);
    });
    let disposed = 0;
    geometry.forEach((g) => g.addEventListener("dispose", () => disposed++));
    a.release();
    assert.equal(
      disposed,
      0,
      "shared geometry is still owned by the source and live clones",
    );
    playClip(b, "work_loop");
    b.mixer!.update(0.3);
    assert.ok(b.root.children.length);
    b.release();
  }
  await fs.writeFile(
    "docs/qa/evidence/worker-motion-cpu.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        mode: "CPU_SKIN_AND_ANIMATION_ONLY",
        status: "PASS",
        visualReview: "BLOCKED_WEBGL",
        measurements,
      },
      null,
      2,
    ) + "\n",
  );
});
test("six worker clones have independent bones and mixers (CPU, not GPU rendering)", async () => {
  const a = manifest.assets.find((a: any) => a.id === "worker"),
    d = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .read(dir + a.lods[0].url);
  // Texture decode is a browser responsibility; retain the original geometry, skin and motion.
  for (const t of d.getRoot().listTextures()) t.dispose();
  const data = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .writeBinary(d);
  const gltf = await new GLTFLoader().parseAsync(
    data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer,
    "",
  );
  const copies = Array.from({ length: 6 }, () => clone(gltf.scene)),
    mixers = copies.map((c) => new T.AnimationMixer(c));
  const first = copies.map((c) => {
    let skin: T.SkinnedMesh | undefined;
    c.traverse((o) => {
      if (o instanceof T.SkinnedMesh) skin = o;
    });
    assert.ok(skin);
    return skin!;
  });
  assert.equal(new Set(first.map((s) => s.skeleton.bones[0])).size, 6);
  assert.equal(new Set(mixers).size, 6);
  mixers.forEach((m, i) =>
    m.clipAction(gltf.animations[i % gltf.animations.length]).play(),
  );
  const before = first[1].skeleton.bones.map((b) => b.quaternion.toArray());
  mixers[0].update(0.4);
  assert.deepEqual(
    first[1].skeleton.bones.map((b) => b.quaternion.toArray()),
    before,
  );
  const bounds = new T.Box3().setFromObject(copies[0]),
    size = bounds.getSize(new T.Vector3());
  assert.ok(size.x > 0 && size.y > 0 && size.z > 0);
  const scale = 1.8 / size.y;
  assert.ok(size.x * scale <= 1.4 + 0.01);
  assert.ok(size.z * scale <= 0.9 + 0.01);
});
