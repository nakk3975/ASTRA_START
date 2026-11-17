import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import * as T from "three";

test("three selectable human designs ship distinct textures and independent animated skeletons at both LODs", async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      "apps/web/public/assets/visuals/1.1.0/manifest.json",
      "utf8",
    ),
  );
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const rows: any[] = [];
  const textureHashes = new Set<string>();
  for (const id of ["worker-engineer", "worker-mechanic", "worker-pilot"]) {
    const asset = manifest.assets.find((a: any) => a.id === id);
    assert.ok(asset, `${id} exists`);
    assert.equal(asset.sourceCreditCost, 15);
    assert.equal(asset.rigMethod, "local-anatomical-skin-v1");
    for (const lod of asset.lods) {
      const path = "apps/web/public" + lod.url;
      const bytes = await fs.readFile(path);
      assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        lod.sha256,
      );
      const doc = await io.read(path);
      assert.ok(doc.getRoot().listSkins().length);
      assert.deepEqual(
        doc
          .getRoot()
          .listAnimations()
          .map((a) => a.getName())
          .sort(),
        ["carry_locomotion", "celebrate", "idle", "locomotion", "work_loop"],
      );
      let vertices = 0;
      for (const mesh of doc.getRoot().listMeshes())
        for (const prim of mesh.listPrimitives()) {
          const weights = prim.getAttribute("WEIGHTS_0")!,
            joints = prim.getAttribute("JOINTS_0")!;
          assert.ok(weights && joints);
          vertices += weights.getCount();
          for (let n = 0; n < weights.getCount(); n++) {
            const w = weights.getElement(n, []);
            assert.ok(w.every(Number.isFinite));
            assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-5);
            assert.ok(joints.getElement(n, []).every((j) => j >= 0 && j < 18));
          }
        }
      for (const texture of doc.getRoot().listTextures()) {
        assert.ok(texture.getSize()!.every((n) => n <= 1024));
        if (lod.level === 0)
          textureHashes.add(
            crypto
              .createHash("sha256")
              .update(texture.getImage()!)
              .digest("hex"),
          );
        texture.dispose();
      }
      const data = await io.writeBinary(doc);
      const gltf = await new GLTFLoader().parseAsync(
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
        "",
      );
      const copies = [clone(gltf.scene), clone(gltf.scene)];
      const mixers = copies.map((c) => new T.AnimationMixer(c));
      const getBones = (c: T.Object3D) => {
        const bones: T.Bone[] = [];
        c.traverse((o) => {
          if (o instanceof T.Bone) bones.push(o);
        });
        return bones;
      };
      const bones = copies.map(getBones);
      assert.equal(bones[0].length, 18);
      assert.notEqual(bones[0][0], bones[1][0]);
      const bounds = new T.Box3().setFromObject(copies[0]),
        size = bounds.getSize(new T.Vector3());
      assert.ok(Math.abs(size.y - 1.8) < 0.01, `${id} height ${size.y}`);
      assert.ok(
        size.x <= 1.4 + 0.01 && size.z <= 0.9 + 0.01,
        `${id} footprint ${size.toArray()}`,
      );
      const movement = [];
      for (const clip of gltf.animations) {
        mixers[0].stopAllAction();
        mixers[0].clipAction(clip).reset().play();
        mixers[0].setTime(0);
        const before = bones[0].map((b) => b.quaternion.toArray());
        const untouched = bones[1].map((b) => b.quaternion.toArray());
        mixers[0].setTime(clip.duration * 0.37);
        const changed = bones[0].filter((b, i) =>
          b.quaternion
            .toArray()
            .some((q, j) => Math.abs(q - before[i][j]) > 1e-6),
        ).length;
        assert.ok(changed > 0, `${id} ${clip.name} moves real bones`);
        assert.deepEqual(
          bones[1].map((b) => b.quaternion.toArray()),
          untouched,
        );
        assert.deepEqual(copies[0].position.toArray(), [0, 0, 0]);
        movement.push({ clip: clip.name, movingBones: changed });
      }
      rows.push({
        id,
        lod: lod.level,
        triangles: lod.triangles,
        vertices,
        bones: bones[0].length,
        bounds: size.toArray(),
        movement,
      });
    }
  }
  assert.ok(textureHashes.size >= 3, "Designs have distinct source textures");
  await fs.writeFile(
    "docs/carry/evidence/character-variants-cpu.json",
    JSON.stringify(
      {
        status: "PASS",
        scope:
          "CPU GLB skin/clip/bounds/clone checks only; source thumbnails inspected separately",
        gpuReview: "PENDING",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
});
