import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  OcclusionFade,
  occlusionRay,
  createSilhouette,
} from "../apps/web/src/visuals/occlusion.ts";
import {
  rocketPresentation,
  ROCKET_PARTS,
} from "../apps/web/src/visuals/rocket.ts";
import {
  reviewReady,
  restoreReview,
} from "../apps/web/src/visuals/review-state.ts";
import { createWorld } from "../packages/game-core/src/index.ts";
import { B, FP } from "../packages/content/src/index.ts";

test("brief separated obstructions never inherit the previous entry timer", () => {
  const fades = new OcclusionFade(),
    m = new T.MeshStandardMaterial();
  fades.update(new Set([m]), 0, 0.05, false);
  fades.update(new Set(), 80, 0.05, false);
  fades.update(new Set([m]), 120, 0.05, false);
  fades.update(new Set([m]), 200, 0.05, false);
  assert.equal(m.opacity, 1);
  fades.update(new Set([m]), 221, 0.05, false);
  assert.ok(m.opacity < 1);
});

test("occlusion respects hold times, reduced motion and an instance's original transparency", () => {
  const fades = new OcclusionFade();
  const a = new T.MeshBasicMaterial({
    opacity: 0.38,
    transparent: true,
    depthWrite: false,
  });
  const b = a.clone();
  fades.update(new Set([a]), 0, 0.01, true);
  assert.equal(a.opacity, 0.38);
  fades.update(new Set([a]), 100, 0.01, true);
  assert.ok(Math.abs(a.opacity - 0.38 * 0.22) < 1e-9);
  assert.equal(b.opacity, 0.38);
  fades.update(new Set(), 101, 0.01, true);
  fades.update(new Set(), 400, 0.01, true);
  assert.ok(a.opacity < 0.38);
  fades.update(new Set(), 401, 0.01, true);
  assert.deepEqual(
    [a.opacity, a.transparent, a.depthWrite],
    [0.38, true, false],
  );
});

test("fade is monotonic and disposing an occluded instance restores its material", () => {
  const fades = new OcclusionFade(),
    m = new T.MeshBasicMaterial();
  fades.update(new Set([m]), 0, 0, false);
  const opacities: number[] = [];
  for (let time = 100; time <= 250; time += 50) {
    fades.update(new Set([m]), time, 0.05, false);
    opacities.push(m.opacity);
  }
  assert.ok(opacities.every((n, i) => i === 0 || n <= opacities[i - 1]));
  assert.ok(Math.abs(m.opacity - 0.22) < 1e-9);
  fades.forget(m);
  assert.deepEqual([m.opacity, m.transparent, m.depthWrite], [1, false, true]);
});

test("off-center orthographic occlusion rays hit the screen-aligned blocker", () => {
  const camera = new T.OrthographicCamera(-20, 20, 10, -10, 0.1, 200);
  camera.position.set(50, 65, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new T.Vector3(10, 0.9, -8);
  const ray = occlusionRay(camera, target);
  const centerRay = occlusionRay(camera, new T.Vector3(0, 0.9, 0));
  assert.ok(ray.ray.direction.distanceTo(centerRay.ray.direction) < 1e-10);
  const wall = new T.Mesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshBasicMaterial(),
  );
  wall.position.copy(target).addScaledVector(ray.ray.direction, -10);
  wall.updateMatrixWorld();
  assert.ok(ray.intersectObject(wall).length > 0);
  wall.position.copy(target).addScaledVector(ray.ray.direction, 10);
  wall.updateMatrixWorld();
  assert.equal(
    ray.intersectObject(wall).length,
    0,
    "objects behind the player are not occluders",
  );
});

test("silhouette uses the animated skeleton without stealing geometry ownership or ray hits", () => {
  const root = new T.Group(),
    geometry = new T.BoxGeometry();
  const source = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  const bone = new T.Bone();
  source.add(bone);
  source.bind(new T.Skeleton([bone]));
  root.add(source);
  const silhouette = createSilhouette(root, "#ff0000");
  const overlay = source.children.find(
    (child) => child.name === "local-player-silhouette",
  ) as T.SkinnedMesh;
  assert.equal(overlay.skeleton, source.skeleton);
  assert.equal(overlay.geometry, source.geometry);
  assert.equal(overlay.parent, source);
  assert.equal(overlay.visible, false);
  silhouette.setVisible(true);
  assert.equal(overlay.visible, true);
  const intersections: T.Intersection[] = [];
  overlay.raycast(new T.Raycaster(), intersections);
  assert.equal(intersections.length, 0);
  let disposed = false;
  geometry.addEventListener("dispose", () => {
    disposed = true;
  });
  silhouette.dispose();
  assert.equal(disposed, false);
  assert.equal(overlay.parent, null);
});

test("rocket delivery quarters restore deterministically without completing a stage or mutating economy", () => {
  const world = createWorld("review", "test", "CODE1234", 6, "owner");
  world.stage = 2;
  world.stages[2].required = { ingot: 8 };
  world.stages[2].delivered = { ingot: 2 };
  const before = JSON.stringify(world),
    view = rocketPresentation(world);
  assert.equal(view.delivery, 1);
  assert.equal(view.assembly, 0);
  assert.equal(view.parts.filter((p) => p.stage === 2).length, 1);
  assert.equal(
    view.parts.find((p) => p.asset === "rocket_lower_hull")?.assembled,
    false,
  );
  assert.equal(JSON.stringify(world), before);
  assert.deepEqual(rocketPresentation(JSON.parse(before)), view);
  world.stages[2].delivered = { ingot: 8 };
  assert.equal(
    rocketPresentation(world).parts.filter((p) => p.stage === 2).length,
    2,
  );
  assert.equal(world.stage, 2);
  assert.equal(world.stages[2].completed, false);
  world.stages[2].progress = (B.construction.assembly_base_ticks.M3 * FP) / 2;
  const half = rocketPresentation(world);
  assert.equal(half.assembly, 2);
  assert.equal(
    half.parts.filter((p) => p.stage === 2 && p.assembled).length,
    1,
  );
});

test("completed rocket has unique modules, exactly four fins and eight panels, with ground parts separated", () => {
  const world = createWorld("review", "test", "CODE1234", 1, "owner");
  world.stage = 6;
  const { parts } = rocketPresentation(world);
  assert.equal(new Set(parts.map((p) => p.key)).size, parts.length);
  assert.equal(parts.filter((p) => p.asset === "rocket_fin").length, 4);
  assert.equal(parts.filter((p) => p.asset === "rocket_panel").length, 8);
  assert.deepEqual(
    parts.filter((p) => p.parent === "ground").map((p) => p.asset),
    ["rocket_pad", "rocket_gantry"],
  );
  assert.equal(parts.length, ROCKET_PARTS.length);
  assert.ok(parts.every((p) => p.assembled));
});

const settings = {
  size: [1366, 768],
  low: false,
  clip: "idle",
  count: 1,
  rotation: 0,
};
const metrics = {
  webgl: true,
  loaded: true,
  css: [1366, 768],
  quality: "standard",
  review: { clip: "idle", count: 1, rotation: 0 },
};
test("review cannot record a stale frame after animation, count, orientation or quality changes", () => {
  assert.equal(reviewReady(metrics, settings), true);
  for (const change of [
    { clip: "work_loop" },
    { count: 6 },
    { rotation: 1 },
    { low: true },
    { size: [800, 360] },
  ])
    assert.equal(reviewReady(metrics, { ...settings, ...change }), false);
  assert.equal(reviewReady({ ...metrics, webgl: false }, settings), false);
});

test("saved review restores records and notes while rejecting corrupt or unsupported records", () => {
  const record = {
    capturedAt: "2026-11-17T00:00:00Z",
    result: "VISUALLY_REVIEWED",
    notes: "발 접지 확인",
    requestedCanvas: settings.size,
    quality: "standard",
    ...metrics.review,
    measurements: metrics,
    manifestHash: "a".repeat(64),
  };
  const restored = restoreReview(
    JSON.stringify({
      version: 2,
      notes: "다음 검수",
      records: [record, { ...record, manifestHash: "wrong" }, null],
    }),
  );
  assert.deepEqual(restored, { notes: "다음 검수", records: [record] });
  assert.deepEqual(restoreReview("broken"), { records: [], notes: "" });
});
