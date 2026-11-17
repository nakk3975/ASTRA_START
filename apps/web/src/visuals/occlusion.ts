import * as T from "three";
import { P } from "./camera";

/** One entry per instance material. Never mutate the cached GLTF materials. */
export class OcclusionFade {
  private entries = new Map<
    T.Material,
    {
      base: { opacity: number; transparent: boolean; depthWrite: boolean };
      entered: number | null;
      cleared: number | null;
      amount: number;
    }
  >();

  update(
    hit: ReadonlySet<T.Material>,
    now: number,
    dt: number,
    reduced: boolean,
  ) {
    const config = P.occlusion;
    for (const material of hit) {
      if (!this.entries.has(material)) {
        this.entries.set(material, {
          base: {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          },
          entered: now,
          cleared: null,
          amount: 0,
        });
      }
    }
    for (const [material, state] of this.entries) {
      let target = state.amount;
      if (hit.has(material)) {
        if (state.entered === null) state.entered = now;
        state.cleared = null;
        if (now - state.entered >= config.enter_hold_ms) target = 1;
      } else {
        state.entered = null;
        if (state.cleared === null) state.cleared = now;
        if (now - state.cleared >= config.release_hold_ms) target = 0;
      }
      const step = reduced ? 1 : (Math.max(0, dt) * 1000) / config.fade_ms;
      state.amount +=
        Math.sign(target - state.amount) *
        Math.min(Math.abs(target - state.amount), step);
      material.opacity =
        state.base.opacity * (1 - state.amount * (1 - config.fade_opacity));
      material.transparent = state.base.transparent || state.amount > 0;
      material.depthWrite = state.amount > 0 ? false : state.base.depthWrite;
      if (!hit.has(material) && state.amount === 0) this.forget(material);
    }
  }

  forget(material: T.Material) {
    const state = this.entries.get(material);
    if (state) Object.assign(material, state.base);
    this.entries.delete(material);
  }

  clear() {
    for (const material of this.entries.keys()) this.forget(material);
  }
}

/** Orthographic rays are parallel, including away from the screen center. */
export function occlusionRay(
  camera: T.Camera,
  target: T.Vector3,
  distance = 80,
) {
  const direction = camera.getWorldDirection(new T.Vector3());
  return new T.Raycaster(
    target.clone().addScaledVector(direction, -distance),
    direction,
    0,
    distance - 0.05,
  );
}

/** A depth-independent silhouette driven by the SAME live skeleton, not a second mixer. */
export function createSilhouette(root: T.Object3D, color: string) {
  const originals: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh) originals.push(o);
  });
  const material = new T.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.65,
    depthTest: false,
    depthWrite: false,
  });
  const meshes = originals.map((source) => {
    const mesh =
      source instanceof T.SkinnedMesh
        ? new T.SkinnedMesh(source.geometry, material)
        : new T.Mesh(source.geometry, material);
    if (mesh instanceof T.SkinnedMesh && source instanceof T.SkinnedMesh) {
      mesh.skeleton = source.skeleton;
      mesh.bindMode = source.bindMode;
      mesh.bindMatrix.copy(source.bindMatrix);
      mesh.bindMatrixInverse.copy(source.bindMatrixInverse);
    }
    mesh.morphTargetDictionary = source.morphTargetDictionary;
    mesh.morphTargetInfluences = source.morphTargetInfluences;
    mesh.name = "local-player-silhouette";
    mesh.renderOrder = 100;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    source.add(mesh);
    return mesh;
  });
  return {
    setVisible(visible: boolean) {
      meshes.forEach((mesh) => {
        mesh.visible = visible;
      });
    },
    dispose() {
      meshes.forEach((mesh) => mesh.removeFromParent());
      material.dispose();
    },
  };
}
