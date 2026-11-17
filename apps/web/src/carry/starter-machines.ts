import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MachineKind } from "../../../../packages/carry-core/src/index.ts";

/** Deliberately handmade starter tools. Upgraded tiers use the existing GLB assets. */
export function starterMachine(kind: MachineKind) {
  const root = new T.Group();
  root.name = `starter-${kind}`;
  const batches = new Map<string, T.BufferGeometry[]>();
  const wood = "#a77c4e",
    darkWood = "#6e5136",
    iron = "#596267";
  const copper = "#ae7650",
    stone = "#a09076",
    dark = "#343934";
  const add = (
    g: T.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) => {
    g.rotateX(rx);
    g.rotateY(ry);
    g.rotateZ(rz);
    g.translate(x, y, z);
    const flat = g.index ? g.toNonIndexed() : g.clone();
    flat.deleteAttribute("uv");
    const list = batches.get(color) ?? [];
    list.push(flat);
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
    c = wood,
    rz = 0,
  ) => add(new T.BoxGeometry(w, h, d), c, x, y, z, 0, 0, rz);
  const cylinder = (
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    c = iron,
    rx = 0,
  ) => add(new T.CylinderGeometry(r, r, h, 12), c, x, y, z, rx);
  const wheel = (x: number, y: number, z: number, r: number) => {
    add(new T.TorusGeometry(r, 0.045, 6, 16), iron, x, y, z);
    box(x, y, z, r * 1.8, 0.05, 0.05, iron);
    box(x, y, z, 0.05, r * 1.8, 0.05, iron);
    cylinder(x, y, z + 0.06, 0.08, 0.2, copper, Math.PI / 2);
  };
  const table = (height = 0.8) => {
    for (const x of [-0.8, 0.8])
      for (const z of [-0.58, 0.58])
        box(x, height / 2, z, 0.18, height, 0.18, darkWood);
    for (const z of [-0.53, -0.18, 0.18, 0.53])
      box(0, height, z, 2.1, 0.16, 0.33);
    box(0, 0.28, 0.58, 1.7, 0.14, 0.12, darkWood);
    box(0, 0.28, -0.58, 1.7, 0.14, 0.12, darkWood);
    // Straps and uneven boards make the first-tier equipment visibly repaired.
    for (const x of [-0.78, 0.78])
      box(x, height + 0.085, 0, 0.09, 0.035, 1.42, iron);
  };
  if (kind === "bench") {
    table();
    box(-0.12, 0.96, 0, 0.65, 0.12, 0.48, iron);
    box(-0.12, 1.1, 0, 0.3, 0.24, 0.3, iron);
    box(-0.12, 1.25, 0, 0.83, 0.12, 0.4, iron);
    add(
      new T.ConeGeometry(0.18, 0.42, 4),
      iron,
      0.46,
      1.25,
      0,
      0,
      0,
      -Math.PI / 2,
    );
    box(0.57, 0.92, 0.37, 0.45, 0.06, 0.06, darkWood, -0.2);
    box(0.76, 0.95, 0.33, 0.13, 0.15, 0.24, iron);
    for (const z of [-0.48, -0.38])
      box(-0.58, 0.91, z, 0.35, 0.045, 0.035, iron);
  } else if (kind === "processor") {
    box(0, 0.12, 0, 1.85, 0.24, 1.45, stone);
    cylinder(0, 0.77, 0, 0.68, 1.3, "#9b7458");
    cylinder(0, 1.44, 0, 0.72, 0.12, stone);
    cylinder(0.31, 1.74, -0.28, 0.18, 0.65, iron);
    box(0, 0.64, 0.68, 0.72, 0.68, 0.06, dark);
    for (const x of [-0.24, 0, 0.24])
      box(x, 0.59, 0.73, 0.045, 0.48, 0.04, iron);
    box(-0.87, 0.38, -0.15, 0.38, 0.3, 0.75, darkWood);
    box(-0.87, 0.57, -0.15, 0.4, 0.05, 0.8, wood);
  } else if (kind === "fabricator") {
    table(0.65);
    for (const x of [-0.65, 0.65]) box(x, 1.14, 0, 0.18, 0.92, 0.4, iron);
    box(0, 1.65, 0, 1.5, 0.19, 0.48, darkWood);
    cylinder(0, 1.35, 0, 0.07, 0.73);
    box(0, 1.03, 0, 0.85, 0.17, 0.58, iron);
    box(0, 0.79, 0, 0.95, 0.1, 0.68, copper);
    wheel(0, 1.65, 0.43, 0.32);
  } else if (kind === "refinery") {
    for (const x of [-0.65, 0.65]) box(x, 0.25, 0, 0.16, 0.5, 1.15, darkWood);
    cylinder(0, 0.82, 0, 0.66, 1.12, copper);
    for (const y of [0.39, 1.2]) cylinder(0, y, 0, 0.68, 0.09, iron);
    cylinder(0, 1.41, 0, 0.7, 0.08, darkWood);
    cylinder(0, 1.64, 0, 0.055, 0.45, iron);
    box(0.26, 1.87, 0, 0.56, 0.07, 0.08, iron);
    cylinder(0.5, 1.82, 0, 0.06, 0.2, wood);
    cylinder(0.4, 0.52, 0.63, 0.08, 0.22, iron, Math.PI / 2);
  } else if (kind === "assembler") {
    table(0.72);
    cylinder(0, 0.88, 0, 0.57, 0.16, iron);
    for (const x of [-0.45, 0.45]) box(x, 1.08, 0, 0.13, 0.25, 0.5, copper);
    box(0, 1.24, -0.53, 1.6, 0.15, 0.15, darkWood);
    for (const x of [-0.7, 0.7]) box(x, 0.98, -0.53, 0.12, 0.5, 0.12, iron);
    wheel(0, 0.6, 0.8, 0.2);
  } else {
    table();
    box(0, 1.35, -0.58, 1.75, 0.9, 0.08, darkWood);
    for (const x of [-0.57, -0.19, 0.19, 0.57]) {
      box(x, 1.32, -0.47, 0.045, 0.38, 0.045, iron);
      box(x, 1.52, -0.47, 0.18, 0.07, 0.07, iron);
    }
    box(-0.48, 0.97, 0.12, 0.35, 0.2, 0.28, iron);
    box(0.44, 0.96, 0.14, 0.56, 0.14, 0.48, wood);
    box(0.44, 1.04, 0.14, 0.12, 0.03, 0.48, iron);
  }
  const resources: {
    geometry: T.BufferGeometry;
    material: T.MeshStandardMaterial;
  }[] = [];
  for (const [color, parts] of batches) {
    const geometry = mergeGeometries(parts)!;
    const material = new T.MeshStandardMaterial({ color, roughness: 0.92 });
    parts.forEach((g) => g.dispose());
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    resources.push({ geometry, material });
  }
  let disposed = false;
  root.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const r of resources) {
      r.geometry.dispose();
      r.material.dispose();
    }
  };
  return root;
}
