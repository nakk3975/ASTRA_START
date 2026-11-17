/** Local, deterministic game rig for the downloaded human mesh. No paid API call. */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import * as T from "three";
import fs from "node:fs/promises";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS),
  doc = await io.read("assets/source/human-worker/textured.glb");
const scene = doc.getRoot().listScenes()[0],
  meshNodes = doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh()),
  buffer = doc.getRoot().listBuffers()[0];
const bounds = new T.Box3();
for (const n of meshNodes) {
  const matrix = new T.Matrix4().fromArray(n.getWorldMatrix());
  for (const p of n.getMesh().listPrimitives()) {
    const pos = p.getAttribute("POSITION");
    for (let i = 0; i < pos.getCount(); i++)
      bounds.expandByPoint(
        new T.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(matrix),
      );
  }
}
const scale = 1.8 / (bounds.max.y - bounds.min.y),
  cx = (bounds.min.x + bounds.max.x) / 2,
  cz = (bounds.min.z + bounds.max.z) / 2;
const defs = [
  ["root", null, 0, 0, 0],
  ["hips", "root", 0, 0.86, 0],
  ["spine", "hips", 0, 1.03, 0],
  ["chest", "spine", 0, 1.25, 0],
  ["neck", "chest", 0, 1.43, 0],
  ["head", "neck", 0, 1.55, 0],
];
for (const [side, sign] of [
  ["left", 1],
  ["right", -1],
])
  defs.push(
    [`upperarm_${side}`, "chest", sign * 0.235, 1.29, 0],
    [`forearm_${side}`, `upperarm_${side}`, sign * 0.285, 1.06, 0.005],
    [`hand_${side}`, `forearm_${side}`, sign * 0.26, 0.85, 0.04],
    [`thigh_${side}`, "hips", sign * 0.125, 0.84, 0],
    [`shin_${side}`, `thigh_${side}`, sign * 0.125, 0.46, 0.015],
    [`foot_${side}`, `shin_${side}`, sign * 0.125, 0.11, 0.07],
  );
const bones = new Map(),
  positions = new Map(),
  indices = new Map();
for (const [i, [name, parent, x, y, z]] of defs.entries()) {
  const point = new T.Vector3(x, y, z),
    origin = parent ? positions.get(parent) : new T.Vector3(),
    node = doc
      .createNode(name)
      .setTranslation(point.clone().sub(origin).toArray());
  positions.set(name, point);
  bones.set(name, node);
  indices.set(name, i);
  if (parent) bones.get(parent).addChild(node);
  else scene.addChild(node);
}
const inverse = [];
for (const [, , x, y, z] of defs)
  inverse.push(...new T.Matrix4().makeTranslation(-x, -y, -z).elements);
const skin = doc
  .createSkin("human_game_rig")
  .setSkeleton(bones.get("root"))
  .setInverseBindMatrices(
    doc
      .createAccessor("human_bind")
      .setType("MAT4")
      .setArray(new Float32Array(inverse))
      .setBuffer(buffer),
  );
for (const [name] of defs) skin.addJoint(bones.get(name));
const segments = {
  hips: ["hips", "spine"],
  spine: ["spine", "chest"],
  chest: ["chest", "neck"],
  neck: ["neck", "head"],
  head: ["head", "head"],
};
for (const side of ["left", "right"])
  Object.assign(segments, {
    [`upperarm_${side}`]: [`upperarm_${side}`, `forearm_${side}`],
    [`forearm_${side}`]: [`forearm_${side}`, `hand_${side}`],
    [`hand_${side}`]: [`hand_${side}`, `hand_${side}`],
    [`thigh_${side}`]: [`thigh_${side}`, `shin_${side}`],
    [`shin_${side}`]: [`shin_${side}`, `foot_${side}`],
    [`foot_${side}`]: [`foot_${side}`, `foot_${side}`],
  });
for (const node of meshNodes) {
  const matrix = new T.Matrix4().fromArray(node.getWorldMatrix());
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute("POSITION"),
      normal = prim.getAttribute("NORMAL"),
      joints = new Uint16Array(pos.getCount() * 4),
      weights = new Float32Array(pos.getCount() * 4);
    for (let i = 0; i < pos.getCount(); i++) {
      const v = new T.Vector3()
        .fromArray(pos.getElement(i, []))
        .applyMatrix4(matrix);
      v.set(
        (v.x - cx) * scale,
        (v.y - bounds.min.y) * scale,
        (v.z - cz) * scale,
      );
      pos.setElement(i, v.toArray());
      if (normal)
        normal.setElement(
          i,
          new T.Vector3()
            .fromArray(normal.getElement(i, []))
            .transformDirection(matrix)
            .toArray(),
        );
      const side = v.x >= 0 ? "left" : "right";
      let names;
      if (v.y > 1.48) names = ["head", "neck"];
      else if (v.y < 0.13) names = [`foot_${side}`, `shin_${side}`];
      else if (v.y < 0.79) names = [`thigh_${side}`, `shin_${side}`, "hips"];
      else if (Math.abs(v.x) > 0.21 && v.y > 0.83 && v.y < 1.4)
        names = [
          `upperarm_${side}`,
          `forearm_${side}`,
          `hand_${side}`,
          "chest",
        ];
      else names = ["hips", "spine", "chest", "neck"];
      const scored = names
          .map((name) => {
            const [a, b] = segments[name];
            const line = new T.Line3(positions.get(a), positions.get(b));
            const dist = v.distanceTo(
              line.closestPointToPoint(v, true, new T.Vector3()),
            );
            return { name, w: 1 / (0.0025 + dist ** 4) };
          })
          .sort((a, b) => b.w - a.w)
          .slice(0, 4),
        sum = scored.reduce((n, s) => n + s.w, 0);
      scored.forEach((s, k) => {
        joints[i * 4 + k] = indices.get(s.name);
        weights[i * 4 + k] = s.w / sum;
      });
    }
    prim.setAttribute(
      "JOINTS_0",
      doc
        .createAccessor("human_joints")
        .setType("VEC4")
        .setArray(joints)
        .setBuffer(buffer),
    );
    prim.setAttribute(
      "WEIGHTS_0",
      doc
        .createAccessor("human_weights")
        .setType("VEC4")
        .setArray(weights)
        .setBuffer(buffer),
    );
  }
  node
    .setTranslation([0, 0, 0])
    .setRotation([0, 0, 0, 1])
    .setScale([1, 1, 1])
    .setSkin(skin);
}
for (const a of doc.getRoot().listAnimations()) a.dispose();
function clip(name, duration, pose) {
  const animation = doc.createAnimation(name),
    count = 41,
    times = Float32Array.from(
      { length: count },
      (_, i) => (duration * i) / (count - 1),
    ),
    input = doc
      .createAccessor(`${name}_time`)
      .setType("SCALAR")
      .setArray(times)
      .setBuffer(buffer);
  for (const [bone] of defs) {
    if (bone === "root") continue;
    const values = [];
    for (const t of times) {
      const [x, y, z] = pose(bone, t, duration);
      values.push(
        ...new T.Quaternion().setFromEuler(new T.Euler(x, y, z)).toArray(),
      );
    }
    const output = doc
        .createAccessor(`${name}_${bone}`)
        .setType("VEC4")
        .setArray(new Float32Array(values))
        .setBuffer(buffer),
      sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation("LINEAR");
    animation.addSampler(sampler);
    animation.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(bones.get(bone))
        .setTargetPath("rotation")
        .setSampler(sampler),
    );
  }
}
const sign = (b) => (b.endsWith("left") ? 1 : -1);
clip("idle", 3, (b, t, d) => {
  const a = Math.sin((t / d) * Math.PI * 2);
  return [b === "chest" ? 0.018 * a : 0, b === "head" ? 0.035 * a : 0, 0];
});
function walk(b, t, d, carry = false) {
  const s = Math.sin((t / d) * Math.PI * 2) * sign(b);
  if (b.startsWith("thigh")) return [0.42 * s, 0, 0];
  if (b.startsWith("shin")) return [Math.max(0, -s) * 0.38, 0, 0];
  if (b.startsWith("foot")) return [-0.12 * s, 0, 0];
  if (b.startsWith("upperarm"))
    return [carry ? -0.65 : -0.2 * s, 0, carry ? sign(b) * 0.08 : 0];
  if (b.startsWith("forearm")) return [carry ? -0.7 : -0.12, 0, 0];
  return [0, b === "hips" ? 0.025 * Math.sin((t / d) * Math.PI * 2) : 0, 0];
}
clip("locomotion", 0.9, (b, t, d) => walk(b, t, d));
clip("carry_locomotion", 1.05, (b, t, d) => walk(b, t, d, true));
clip("work_loop", 0.8, (b, t, d) => {
  const a = (Math.sin((t / d) * Math.PI * 2) + 1) / 2;
  if (b === "chest") return [0.1 * a, 0, 0];
  if (b.startsWith("upperarm")) return [-0.3 - 0.45 * a, 0, 0];
  if (b.startsWith("forearm")) return [-0.35 - 0.4 * a, 0, 0];
  return [0, 0, 0];
});
clip("celebrate", 1.5, (b, t, d) => {
  const a = Math.sin((t / d) * Math.PI * 2);
  if (b.startsWith("upperarm")) return [-0.5, 0, sign(b) * (0.35 + 0.15 * a)];
  if (b === "chest") return [0.035 * a, 0, 0];
  return [0, 0, 0];
});
await doc.transform(dedup(), prune());
await io.write("assets/source/human-worker/animated.glb", doc);
await fs.writeFile(
  "docs/carry/human-worker-rig.json",
  JSON.stringify(
    {
      method:
        "locally authored skeletal skin with anatomical region weights; not Meshy auto-rigging",
      source: "01a1e7de-f944-744d-b8e6-997c3f91418c",
      height: 1.8,
      bones: defs.length,
      clips: doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
      visualReview: "SOURCE_THUMBNAIL_INSPECTED; ANIMATION_GPU_REVIEW_BLOCKED",
    },
    null,
    2,
  ) + "\n",
);
console.log("Human mesh skinned:", defs.length, "bones / five game clips");
