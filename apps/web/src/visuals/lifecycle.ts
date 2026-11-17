import type { Object3D } from "three";

/** A release callback can detach its own root. Never mutate a live traversal. */
export function releaseTree(
  root: Object3D,
  kind: "release" | "dispose" = "release",
) {
  const callbacks: (() => void)[] = [];
  root.traverse((node) => {
    const callback = node.userData[kind];
    if (typeof callback === "function") {
      delete node.userData[kind];
      callbacks.push(callback);
    }
  });
  for (const callback of callbacks) callback();
}
