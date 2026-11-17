import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as T from "three";
import { createVisual } from "../apps/web/src/visuals/assets.ts";

test("all four human rigs and LODs hold at both hands, plant feet and return to neutral after release", async () => {
  const manifest = JSON.parse(
    await fs.readFile(
      "apps/web/public/assets/visuals/1.1.0/manifest.json",
      "utf8",
    ),
  );
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const asset of manifest.assets.filter((a: any) =>
    a.id.startsWith("worker"),
  ))
    for (const lod of asset.lods) {
      const doc = await io.read("apps/web/public" + lod.url);
      doc
        .getRoot()
        .listTextures()
        .forEach((t) => t.dispose());
      const data = await io.writeBinary(doc);
      const gltf = await new GLTFLoader().parseAsync(
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
        "",
      );
      const visual = createVisual(asset, gltf),
        model = visual.root.getObjectByName("visual_root")!;
      const entity = new T.Group();
      entity.position.set(8, 1.2, -4);
      entity.rotation.y = 1.3;
      entity.add(visual.root);
      const motion = visual.motion!;
      assert.ok(motion.supported, asset.id);
      for (let frame = 0; frame < 90; frame++)
        motion.update(1 / 60, 3.5 / 60, true);
      for (const side of ["left", "right"]) {
        const actual = model.worldToLocal(
          model
            .getObjectByName(`hand_${side}`)!
            .getWorldPosition(new T.Vector3()),
        );
        const desired = new T.Vector3(
          side === "left" ? 0.22 : -0.22,
          1.04,
          0.36,
        );
        assert.ok(
          actual.distanceTo(desired) < 0.006,
          `${asset.id} ${side} wrist ${actual.toArray()}`,
        );
      }
      const hands = ["hand_left", "hand_right"].map((n) =>
        model.getObjectByName(n)!.getWorldPosition(new T.Vector3()),
      );
      assert.ok(
        motion.grip()!.distanceTo(hands[0].add(hands[1]).multiplyScalar(0.5)) <
          1e-6,
      );
      for (let frame = 0; frame < 120; frame++) motion.update(1 / 60, 0, true);
      for (const side of ["left", "right"])
        assert.ok(
          model
            .getObjectByName(`thigh_${side}`)!
            .quaternion.angleTo(new T.Quaternion()) < 0.001,
          "stopped legs are neutral, not frozen mid-stride",
        );
      for (let frame = 0; frame < 120; frame++) motion.update(1 / 60, 0, false);
      for (const side of ["left", "right"])
        assert.ok(
          model
            .getObjectByName(`upperarm_${side}`)!
            .quaternion.angleTo(new T.Quaternion()) < 0.001,
          "arms relax after drop",
        );
      assert.ok(visual.root.position.toArray().every(Number.isFinite));
      visual.release();
      visual.release();
    }
});
