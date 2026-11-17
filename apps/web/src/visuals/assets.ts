import { WorkerMotion } from "./worker-motion";
import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { AssetCache, type Manifest } from "./asset-cache";
export type { AssetRecord, Manifest } from "./asset-cache";
function disposeSource(gltf: GLTF) {
  const resources = new Set<
    T.BufferGeometry | T.Material | T.Texture | T.Skeleton
  >();
  gltf.scene.traverse((o) => {
    if (o instanceof T.Mesh) {
      resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        resources.add(m);
        for (const value of Object.values(m))
          if (value instanceof T.Texture) resources.add(value);
      }
      if (o instanceof T.SkinnedMesh) resources.add(o.skeleton);
    }
  });
  resources.forEach((r) => r.dispose());
}
const loader = new GLTFLoader();
const cache = new AssetCache<GLTF>(
  (data) => loader.parseAsync(data, ""),
  disposeSource,
);
export let manifest: Manifest | null = null;
export let manifestHash = "";
export let assetError = "";
export async function preloadAssets() {
  assetError = "";
  try {
    manifest = await cache.load();
    manifestHash = cache.manifestHash;
    return manifest;
  } catch (e) {
    assetError = cache.error;
    throw e;
  }
}
export type Visual = {
  root: T.Group;
  mixer: T.AnimationMixer | null;
  clips: T.AnimationClip[];
  release: () => void;
  motion?: WorkerMotion;
};
export function assetInstance(id: string, low = false): Visual | null {
  const a = manifest?.assets.find((a) => a.id === id),
    src = cache.values.get(`${id}:${low ? 1 : 0}`);
  if (!a || !src) return null;
  return createVisual(a, src);
}
export function createVisual(
  a: import("./asset-cache").AssetRecord,
  src: GLTF,
): Visual {
  const id = a.id;
  const root = new T.Group();
  root.name = `EntityVisual:${id}`;
  const model = clone(src.scene);
  model.name = "visual_root";
  root.add(model);
  // Keep the gameplay entity ground origin independent of animated bones.
  model.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(model),
    size = box.getSize(new T.Vector3()),
    center = box.getCenter(new T.Vector3());
  const scale =
    id === "worker" || id.startsWith("worker-")
      ? 1.8 / size.y
      : Math.min(
          a.boundsMax.x / size.x,
          a.boundsMax.y / size.y,
          a.boundsMax.z / size.z,
        );
  model.scale.multiplyScalar(scale);
  model.position.add(
    new T.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale),
  );
  if (
    id.startsWith("rocket_") &&
    id !== "rocket_fin" &&
    id !== "rocket_panel"
  ) {
    // Modules use their specified attachment height; hull diameter remains bounded.
    model.scale.y *= a.boundsMax.y / (size.y * scale);
    model.position.y = -box.min.y * model.scale.y;
  }
  // Meshy rigs face +Z. Rotate the complete skin/skeleton hierarchy together once.
  if (id === "worker" || id.startsWith("worker-")) root.rotation.y = Math.PI;
  const own: T.Material[] = [];
  const skeletons = new Set<T.Skeleton>();
  model.traverse((o) => {
    if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
    if (o instanceof T.Mesh) {
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
      own.push(...(Array.isArray(o.material) ? o.material : [o.material]));
      o.castShadow = false;
      o.receiveShadow = true;
      o.frustumCulled = !(id === "worker" || id.startsWith("worker-"));
      o.userData.assetId = id;
    }
  });
  const mixer = src.animations.length ? new T.AnimationMixer(model) : null;
  let released = false;
  return {
    root,
    mixer,
    clips: src.animations,
    motion:
      id === "worker" || id.startsWith("worker-")
        ? new WorkerMotion(model)
        : undefined,
    release() {
      if (released) return;
      released = true;
      mixer?.stopAllAction();
      mixer?.uncacheRoot(model);
      own.forEach((m) => m.dispose());
      skeletons.forEach((s) => s.dispose());
      root.removeFromParent();
    },
  };
}
export function playClip(v: Visual, name: string) {
  if (!v.mixer || v.root.userData.clip === name) return;
  const clip = v.clips.find((c) => c.name === name);
  if (!clip) return;
  const previous = v.clips.find((c) => c.name === v.root.userData.clip);
  if (previous) v.mixer.clipAction(previous).fadeOut(0.12);
  v.mixer
    .clipAction(clip)
    .reset()
    .fadeIn(previous ? 0.12 : 0)
    .play();
  v.root.userData.clip = name;
}
