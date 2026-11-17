import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Original outdoor quarry scenery. Decorations stay outside the walkable boundary.
 * Static meshes share a material batch, keeping the scenery cheap on small GPUs. */
export function quarryEnvironment() {
  const root = new T.Group();
  root.name = "outdoor-quarry";
  const batches = new Map<string, T.BufferGeometry[]>();
  const add = (
    g: T.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    turn = 0,
  ) => {
    g.scale(sx, sy, sz);
    g.rotateY(turn);
    g.translate(x, y, z);
    const list = batches.get(color) ?? [];
    const flat = g.index ? g.toNonIndexed() : g.clone();
    list.push(flat.deleteAttribute("uv"));
    batches.set(color, list);
    g.dispose();
  };
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: string,
    turn = 0,
  ) => add(new T.BoxGeometry(w, h, d), c, x, y, z, 1, 1, 1, turn);
  const rock = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: string,
    turn = 0,
  ) => add(new T.DodecahedronGeometry(1, 0), c, x, y, z, w, h, d, turn);
  let groundLayer = 0;
  const patch = (
    x: number,
    z: number,
    w: number,
    d: number,
    c: string,
    turn = 0,
  ) =>
    add(
      new T.CylinderGeometry(1, 1, 0.018, 9),
      c,
      x,
      0.014 + ++groundLayer * 0.0006,
      z,
      w,
      1,
      d,
      turn,
    );
  // Broad warm terrain, with the actual movement boundary marked by wood fencing.
  box(0, -0.28, 0, 76, 0.56, 54, "#c5aa76");
  patch(-15, 0, 8, 12, "#d3ba88");
  patch(0, 0, 13, 11, "#d9c194");
  patch(-18, -7, 3.2, 2.1, "#ae946c");
  patch(-18, -2.5, 3.1, 2, "#ae946c");
  patch(-18, 2.5, 3.1, 2, "#ae946c");
  patch(-18, 7, 3.2, 2.1, "#ae946c");
  // Flat worn paths do not introduce decorative collision or catch the feet.
  for (let i = 0; i < 12; i++)
    patch(-17 + i * 3.1, 0, 2.6, 1.3, "#e3cca0", i * 0.21);
  for (let i = 0; i < 6; i++)
    patch(-14, -8 + i * 3.1, 1.2, 2.2, "#e3cca0", i * 0.1);
  for (let i = 0; i < 14; i++) {
    const x = -26 + i * 4.1,
      z = -16 - (i % 3) * 1.2;
    rock(
      x,
      0.7,
      z,
      3.1,
      1.8 + (i % 3) * 0.6,
      2.4,
      i % 2 ? "#b29b74" : "#ab926b",
      i * 0.7,
    );
    patch(x, z + 2, 3, 2.3, "#8f9d65", i);
  }
  for (const side of [-1, 1]) {
    for (let z = -11; z <= 11; z += 2)
      box(side < 0 ? -22.6 : 24, 0.55, z, 0.17, 1.1, 0.17, "#927047");
    box(side < 0 ? -22.6 : 24, 0.78, 0, 0.12, 0.14, 22, "#ae8754");
    box(side < 0 ? -22.6 : 24, 0.32, 0, 0.1, 0.12, 22, "#ae8754");
    for (let x = -22; x <= 22; x += 2)
      box(x, 0.55, side * 13, 0.17, 1.1, 0.17, "#927047");
    box(0, 0.78, side * 13, 44, 0.14, 0.12, "#ae8754");
    box(0, 0.32, side * 13, 44, 0.12, 0.1, "#ae8754");
  }
  // Small broad-leaf trees and low grass islands live beyond the fence.
  for (const [x, z, s] of [
    [-27, -9, 1.15],
    [-26, 5, 1],
    [-19, 15, 1.2],
    [-7, -17, 1.15],
    [7, -17, 1],
    [27, -9, 1.3],
    [27, 7, 1.1],
    [14, 16, 1.2],
  ]) {
    patch(x, z, 2.3 * s, 2 * s, "#8f9d65");
    add(
      new T.CylinderGeometry(0.13, 0.23, 2.3, 7),
      "#927047",
      x,
      1.15,
      z,
      s,
      s,
      s,
    );
    rock(x, 2.7 * s, z, 1.5 * s, 1.2 * s, 1.4 * s, "#829156", x);
    rock(
      x - 0.65 * s,
      2.2 * s,
      z + 0.3 * s,
      1.1 * s,
      0.9 * s,
      1.1 * s,
      "#a1aa65",
      z,
    );
  }
  // Rough stone launch foundation, with the exact original ramp surface.
  box(17, 0.6, 0, 10, 1.2, 12, "#b5a17d");
  box(17, 1.21, 0, 10, 0.035, 12, "#ded0ae");
  for (let z = -5; z <= 5; z += 2)
    box(21.95, 0.6, z, 0.12, 1.1, 1.85, "#c5b08b");
  const ramp = new T.BufferGeometry();
  ramp.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      [
        8, 0, -2, 12, 1.2, -2, 12, 1.2, 2, 8, 0, -2, 12, 1.2, 2, 8, 0, 2, 8, 0,
        -2, 12, 0, -2, 12, 1.2, -2, 8, 0, 2, 12, 1.2, 2, 12, 0, 2,
      ],
      3,
    ),
  );
  ramp.computeVertexNormals();
  add(ramp, "#c5b08b", 0, 0, 0);
  for (const [color, parts] of batches) {
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((g) => g.dispose());
    const mesh = new T.Mesh(
      merged,
      new T.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
    );
    mesh.castShadow = ![
      "#c5aa76",
      "#d3ba88",
      "#d9c194",
      "#ae946c",
      "#e3cca0",
      "#8f9d65",
    ].includes(color);
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return {
    root,
    dispose() {
      root.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.geometry.dispose();
          (o.material as T.Material).dispose();
        }
      });
    },
  };
}
