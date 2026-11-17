import React, { useEffect, useRef, useState } from "react";
import * as T from "three";
import { B, M, UNIT } from "../../../packages/content/src/index.ts";
import {
  fixedGeometry,
  geometry,
  placement,
  machineGeometry,
  blocked,
  solids,
  type World,
  type Geometry,
  type Point,
} from "../../../packages/game-core/src/index.ts";
import catalog from "../../../design/asset_catalog_v1_1.json";
import {
  OcclusionFade,
  occlusionRay,
  createSilhouette,
} from "./visuals/occlusion";
import { rocketPresentation } from "./visuals/rocket";
import { moveInPlayground } from "./visuals/playground";
import {
  assetInstance,
  preloadAssets,
  manifest,
  playClip,
  type Visual,
} from "./visuals/assets";
import {
  FixedCamera,
  viewControl,
  drawingSize,
  spanHeight,
  Q,
  S,
  C,
} from "./visuals/camera";
export const colors = [
  "#ed8050",
  "#50a6c0",
  "#9d82c6",
  "#82ab64",
  "#d0a048",
  "#e27898",
];
export type Ghost = {
  type: string;
  x: number;
  z: number;
  rotation: number;
  moveId?: string;
};
type Props = {
  world: World | null;
  member: string;
  selected: string | null;
  ghost: Ghost | null;
  low: boolean;
  overview: boolean;
  onSelect: (id: string) => void;
  onGround: (p: Point) => void;
  onError: (s: string) => void;
  pilot?: boolean;
  review?: {
    clip: string;
    count: number;
    rotation: number;
    assetId?: string;
    interactive?: boolean;
  };
};
type Entity = {
  node: T.Group;
  visual: Visual | null;
  key: string;
  silhouette?: ReturnType<typeof createSilhouette>;
  dispose: () => void;
};
export function WorldView(props: Props) {
  const [attempt, retry] = useState(0);
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const element = host.current!;
    element.replaceChildren();
    viewControl.graphicsReady = false;
    element.dataset.metrics = JSON.stringify({
      webgl: false,
      loaded: false,
      reason: "STARTING",
    });
    const recovery = (message: string) => {
      element.querySelector(".world-recovery")?.remove();
      const card = document.createElement("div");
      card.className = "world-recovery";
      card.setAttribute("role", "alert");
      const text = document.createElement("p");
      text.textContent = message;
      const button = document.createElement("button");
      button.textContent = "3D 화면 다시 시도";
      button.onclick = () => {
        latest.current.onError("");
        retry((n) => n + 1);
      };
      card.append(text, button);
      element.append(card);
    };
    let renderer: T.WebGLRenderer;
    const canvas = document.createElement("canvas");
    let contextReason = "";
    canvas.addEventListener("webglcontextcreationerror", (event) => {
      contextReason = (event as WebGLContextEvent).statusMessage;
    });
    try {
      renderer = new T.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (e) {
      element.dataset.metrics = JSON.stringify({
        webgl: false,
        loaded: false,
        reason: "WEBGL_UNAVAILABLE",
        detail: contextReason || (e instanceof Error ? e.message : String(e)),
      });
      recovery(
        "3D 화면을 시작할 수 없습니다. 브라우저의 그래픽 가속을 확인한 뒤 다시 시도해 주세요. 저장된 작업장은 유지됩니다.",
      );
      latest.current.onError("WebGL 2 시작 실패");
      return () => element.replaceChildren();
    }
    renderer.setClearColor("#dce4da");
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "고철로 우주까지 3D 작업장");
    renderer.domElement.tabIndex = 0;
    element.append(renderer.domElement);
    const scene = new T.Scene(),
      camera = new T.OrthographicCamera(-22, 22, 11, -11, 0.1, 200),
      controller = new FixedCamera();
    const sun = new T.DirectionalLight("#fff3d6", 2.5);
    sun.position.set(-20, 40, 15);
    scene.add(sun, new T.HemisphereLight("#efffff", "#84977a", 2.1));
    const clickables: T.Object3D[] = [],
      entities = new Map<string, Entity>(),
      players = new Map<string, Entity>(),
      cargo = new Map<string, Entity>(),
      links = new Map<string, T.Line>();
    const ownGeo = new Set<T.BufferGeometry>(),
      ownMat = new Set<T.Material>(),
      ownTex = new Set<T.Texture>();
    const fades = new OcclusionFade();
    function mat(color: string) {
      const m = new T.MeshStandardMaterial({ color, roughness: 0.85 });
      ownMat.add(m);
      return m;
    }
    function box(
      parent: T.Object3D,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: string,
    ) {
      const g = new T.BoxGeometry(w, h, d);
      ownGeo.add(g);
      const n = new T.Mesh(g, mat(color));
      n.position.set(x, y, z);
      parent.add(n);
      return n;
    }
    function label(
      parent: T.Object3D,
      text: string,
      y: number,
      color = "#365651",
      width = 2.2,
    ) {
      const c = document.createElement("canvas");
      c.width = 384;
      c.height = 64;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#f9f7e9e8";
      ctx.beginPath();
      ctx.roundRect(0, 0, 384, 64, 14);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "600 27px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 192, 33, 368);
      const tex = new T.CanvasTexture(c);
      ownTex.add(tex);
      const m = new T.SpriteMaterial({ map: tex, depthTest: false });
      ownMat.add(m);
      const n = new T.Sprite(m);
      n.position.y = y;
      n.scale.set(width, width / 6, 1);
      parent.add(n);
      return n;
    }
    function ring(
      parent: T.Object3D,
      x: number,
      z: number,
      r: number,
      color: string,
    ) {
      const g = new T.RingGeometry(r, r + 0.045, 24);
      ownGeo.add(g);
      const m = new T.MeshBasicMaterial({
        color,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      ownMat.add(m);
      const n = new T.Mesh(g, m);
      n.rotation.x = -Math.PI / 2;
      n.position.set(x, 0.035, z);
      parent.add(n);
      return n;
    }
    function entity(
      id: string,
      asset: string,
      x: number,
      z: number,
      rotation = 0,
      y = 0,
    ): Entity {
      const node = new T.Group();
      node.name = id;
      node.userData.id = id;
      node.position.set(x, y, z);
      const visual = assetInstance(asset, latest.current.low);
      if (visual) {
        visual.root.rotation.y += (-rotation * Math.PI) / 2;
        node.add(visual.root);
      } else {
        const marker = box(node, 0, 0.07, 0, 0.8, 0.14, 0.8, "#aab8b0");
        marker.userData.unavailable = asset;
        label(node, "제작 대기", 0.35, "#64756e", 1.2);
      }
      scene.add(node);
      clickables.push(node);
      const result: Entity = {
        node,
        visual,
        key: asset + ":" + rotation + ":" + latest.current.low,
        dispose() {
          result.silhouette?.dispose();
          visual?.root.traverse((o) => {
            if (o instanceof T.Mesh)
              for (const m of Array.isArray(o.material)
                ? o.material
                : [o.material])
                fades.forget(m);
          });
          visual?.release();
          node.traverse((o) => {
            if (o instanceof T.Mesh && ownGeo.has(o.geometry)) {
              o.geometry.dispose();
              ownGeo.delete(o.geometry);
            }
            if (o instanceof T.Sprite) {
              o.material.map?.dispose();
              if (o.material.map) ownTex.delete(o.material.map);
            }
            if (o instanceof T.Mesh || o instanceof T.Sprite)
              for (const m of Array.isArray(o.material)
                ? o.material
                : [o.material])
                if (ownMat.has(m)) {
                  m.dispose();
                  ownMat.delete(m);
                }
          });
          node.removeFromParent();
          const i = clickables.indexOf(node);
          if (i >= 0) clickables.splice(i, 1);
        },
      };
      return result;
    }
    function facility(id: string, g: Geometry, asset: string) {
      const cx = g.top_left.x + g.footprint.width / 2,
        cz = g.top_left.z + g.footprint.depth / 2;
      const e = entity(id, asset, cx, cz, g.rotation_degrees / 90);
      for (const s of g.service_points)
        ring(
          e.node,
          s.interaction_anchor.x - cx,
          s.interaction_anchor.z - cz,
          0.32,
          "#e0a758",
        );
      return e;
    }
    box(scene, 24, -0.2, 16, 64, 0.4, 48, "#99aa90");
    box(scene, 24, -0.02, 16, 48, 0.06, 32, "#c9cbb4");
    for (const road of M.protected_walkways)
      box(
        scene,
        (road.x_min + road.x_max + 1) / 2,
        0.021,
        (road.z_min + road.z_max + 1) / 2,
        road.x_max - road.x_min + 1,
        0.01,
        road.z_max - road.z_min + 1,
        "#e1deca",
      );
    for (const r of M.factory_regions)
      box(
        scene,
        (r.x_min + r.x_max + 1) / 2,
        0.021,
        (r.z_min + r.z_max + 1) / 2,
        r.x_max - r.x_min + 1,
        0.01,
        r.z_max - r.z_min + 1,
        "#b2bfb1",
      );
    const grid = new T.GridHelper(48, 48, "#b0b99f", "#c1c8b3");
    grid.position.set(24, 0.03, 16);
    grid.scale.z = 32 / 48;
    scene.add(grid);
    ownGeo.add(grid.geometry);
    (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(
      (m) => ownMat.add(m),
    );
    const rocketProxy = box(scene, 24.5, 0.015, 26, 4.6, 0.03, 5.6, "#b8baa4");
    rocketProxy.userData.id = "rocket";
    clickables.push(rocketProxy);
    const rocketGround = new T.Group(),
      rocketFlight = new T.Group();
    rocketGround.position.set(24.5, 0, 26);
    rocketFlight.position.set(24.5, 0, 26);
    scene.add(rocketGround, rocketFlight);
    const rocketVisuals: Visual[] = [];
    let rocketKey = "",
      launchedAt = 0;
    function rocketPart(
      id: string,
      parent: T.Group,
      y: number,
      x = 0,
      z = 0,
      rotation = 0,
      assembled = true,
    ) {
      const v = assetInstance(id, latest.current.low);
      if (!v) return;
      v.root.position.set(x, y, z);
      v.root.rotation.y = rotation;
      v.root.userData.id = "rocket";
      if (!assembled)
        v.root.traverse((o) => {
          if (o instanceof T.Mesh)
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material]) {
              m.transparent = true;
              m.opacity = 0.38;
              m.depthWrite = false;
            }
        });
      parent.add(v.root);
      rocketVisuals.push(v);
      clickables.push(v.root);
    }
    // Four fixed markers show each quarter, even for stages with a single model.
    // These are construction UI, never substitutes for missing Meshy models.
    const buildMarkers = Array.from({ length: 4 }, (_, i) =>
      box(rocketGround, -1.5 + i, 0.06, -2.6, 0.65, 0.08, 0.18, "#acb6aa"),
    );
    const selection = ring(scene, 0, 0, 0.9, "#e39b47");
    selection.visible = false;
    let loaded = false,
      disposed = false,
      frame = 0,
      previous = performance.now(),
      lastRender = 0,
      oldQuality = props.low,
      oldOverview = false,
      overviewSave: {
        x: number;
        z: number;
        step: number;
        detached: boolean;
      } | null = null,
      oldPanel = false,
      heldAfterPanel = false,
      oldRecenter = 0;
    let cssW = 1,
      cssH = 1,
      span = 22,
      drag: { x: number; y: number; pan: boolean } | null = null,
      lastWheel = 0,
      ghost: Entity | null = null,
      ghostKey = "",
      initialized = false;
    let pilotPosition = { x: 22, z: 20 };
    let oldPilotReset = viewControl.pilotReset;
    let pilotMoving = false;
    let contextLost = false;
    const status = document.createElement("div");
    status.className = "world-status";
    status.textContent = "3D 모델을 불러오는 중";
    element.append(status);
    const offscreen = document.createElement("button");
    offscreen.className = "player-offscreen";
    offscreen.textContent = "내 작업자 찾기 · F";
    offscreen.onclick = () => viewControl.recenter++;
    offscreen.hidden = true;
    element.append(offscreen);
    function resize() {
      cssW = Math.max(1, element.clientWidth);
      cssH = Math.max(1, element.clientHeight);
      const r = drawingSize(cssW, cssH, devicePixelRatio, latest.current.low);
      renderer.setPixelRatio(1);
      renderer.setSize(r.width, r.height, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const ray = new T.Raycaster(),
      pointer = new T.Vector2();
    function pointerdown(e: PointerEvent) {
      if (contextLost) return;
      if (latest.current.pilot)
        renderer.domElement.focus({ preventScroll: true });
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 1 };
      if (drag.pan) {
        e.preventDefault();
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
    function pointermove(e: PointerEvent) {
      if (drag?.pan) {
        controller.pan(
          (-(e.clientX - drag.x) * span) / cssH,
          ((e.clientY - drag.y) * span) / cssH,
        );
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    }
    function pointerup(e: PointerEvent) {
      if (!drag) return;
      const was = drag;
      drag = null;
      if (
        was.pan ||
        Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8 ||
        latest.current.overview
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      if (latest.current.ghost) {
        const p = new T.Vector3();
        if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p))
          latest.current.onGround({ x: Math.floor(p.x), z: Math.floor(p.z) });
        return;
      }
      const hit = ray.intersectObjects(clickables, true)[0];
      if (hit) {
        let n: T.Object3D | null = hit.object;
        while (n && !n.userData.id) n = n.parent;
        if (n) latest.current.onSelect(n.userData.id);
      }
    }
    function wheel(e: WheelEvent) {
      if (e.ctrlKey || latest.current.overview) return;
      e.preventDefault();
      if (e.timeStamp - lastWheel < 150) return;
      lastWheel = e.timeStamp;
      controller.step = Math.max(
        0,
        Math.min(2, controller.step + Math.sign(e.deltaY)),
      );
    }
    function hidden() {
      controller.vx = controller.vz = 0;
      viewControl.input = { x: 0, z: 0 };
      viewControl.pilotInput = { x: 0, z: 0 };
      viewControl.resync = true;
      previous = performance.now();
    }
    function lost(e: Event) {
      e.preventDefault();
      contextLost = true;
      viewControl.graphicsReady = false;
      cancelAnimationFrame(frame);
      hidden();
      element.dataset.metrics = JSON.stringify({
        webgl: false,
        loaded: false,
        reason: "WEBGL_CONTEXT_LOST",
      });
      recovery(
        "3D 그래픽 연결이 끊겼습니다. 작업장 저장은 유지됩니다. 화면을 다시 시도해 주세요.",
      );
      latest.current.onError("3D 그래픽 연결 끊김");
    }
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("pointerdown", pointerdown);
    renderer.domElement.addEventListener("pointermove", pointermove);
    renderer.domElement.addEventListener("pointerup", pointerup);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("visibilitychange", hidden);
    preloadAssets()
      .then(() => {
        if (!disposed) {
          loaded = true;
          viewControl.graphicsReady = !contextLost;
          status.textContent = "";
        }
      })
      .catch((e) => {
        if (disposed) return;
        status.textContent = e.message;
        recovery(e.message);
        latest.current.onError(e.message);
      });
    function animate(now: number) {
      if (disposed || contextLost) return;
      frame = requestAnimationFrame(animate);
      const rawdt = (now - previous) / 1000;
      previous = now;
      const dt = rawdt > 0.25 ? 0 : rawdt;
      const p = latest.current,
        w = p.world,
        me = w?.members[p.member];
      if (rawdt > 0.25 && initialized) {
        viewControl.resync = true;
        viewControl.input = { x: 0, z: 0 };
        controller.vx = controller.vz = 0;
      }
      if (p.low !== oldQuality) {
        oldQuality = p.low;
        resize();
        for (const e of entities.values()) e.dispose();
        entities.clear();
        for (const e of players.values()) e.dispose();
        players.clear();
        for (const e of cargo.values()) e.dispose();
        cargo.clear();
        rocketKey = "";
      }
      if (loaded) {
        if (p.pilot) {
          if (oldPilotReset !== viewControl.pilotReset) {
            oldPilotReset = viewControl.pilotReset;
            pilotPosition = { x: 22, z: 20 };
            controller.recenter(pilotPosition);
          }
          const beforePilot = pilotPosition;
          if (p.review?.interactive)
            pilotPosition = moveInPlayground(
              pilotPosition,
              viewControl.pilotInput,
              dt,
              catalog.assets.find(
                (a) => a.id === (p.review?.assetId ?? "processor"),
              )?.bounds_max_tiles,
            );
          pilotMoving =
            Math.hypot(
              pilotPosition.x - beforePilot.x,
              pilotPosition.z - beforePilot.z,
            ) > 0.00001;
          const selectedAsset = p.review?.assetId ?? "processor";
          for (const [key, old] of entities) {
            if (
              key.startsWith("pilot:asset:") &&
              key !== `pilot:asset:${selectedAsset}`
            ) {
              old.dispose();
              entities.delete(key);
            }
          }
          for (const [id, x, z] of [
            [selectedAsset, 23, 16],
            ["rocket_lower_hull", 27, 16],
          ] as const) {
            const key =
              id === selectedAsset && x === 23
                ? `pilot:asset:${id}`
                : `pilot:${id}`;
            const rotation = p.review?.rotation ?? 0;
            const old = entities.get(key);
            if (old && old.node.userData.reviewRotation !== rotation) {
              old.dispose();
              entities.delete(key);
            }
            if (!entities.has(key)) {
              const e = entity(key, id, x, z, rotation);
              e.node.userData.reviewRotation = rotation;
              entities.set(key, e);
            }
          }
          const count = p.review?.count ?? 1;
          for (let i = 0; i < 6; i++) {
            const key = `pilot:worker:${i}`;
            let e = entities.get(key);
            if (i >= count) {
              if (e) {
                e.dispose();
                entities.delete(key);
              }
              continue;
            }
            if (!e) {
              e = entity(
                key,
                "worker",
                22 + (i % 3) * 1.6,
                19 + Math.floor(i / 3) * 1.6,
                2,
              );
              ring(e.node, 0, 0, 0.38, colors[i]);
              label(e.node, `작업자 ${i + 1}`, 2.15, colors[i]);
              entities.set(key, e);
            }
            if (e.visual) {
              const names = [
                "idle",
                "locomotion",
                "work_loop",
                "carry_locomotion",
                "celebrate",
              ];
              let clip =
                p.review?.clip === "independent"
                  ? names[i % names.length]
                  : (p.review?.clip ?? "idle");
              if (i === 0 && p.review?.interactive) {
                e.node.position.set(pilotPosition.x, 0, pilotPosition.z);
                e.visual.root.rotation.y = Math.PI;
                if (pilotMoving) {
                  e.node.rotation.y = Math.atan2(
                    -(pilotPosition.x - beforePilot.x),
                    -(pilotPosition.z - beforePilot.z),
                  );
                  clip =
                    p.review.clip === "carry_locomotion"
                      ? "carry_locomotion"
                      : "locomotion";
                }
              }
              playClip(e.visual, clip);
              e.visual.mixer?.update(dt);
            }
          }
        } else {
          for (const g of fixedGeometry.filter((g) => g.id !== "rocket")) {
            const id =
              (catalog.machine_bindings as Record<string, string>)[g.id] ??
              (catalog.machine_bindings as Record<string, string>)[g.kind] ??
              g.id;
            if (!entities.has(g.id)) {
              const e = facility(g.id, g, id);
              entities.set(g.id, e);
            }
          }
          for (const src of M.source_zones) {
            const binding =
              (catalog.source_bindings as Record<string, string>)[src.id] ??
              (catalog.source_bindings as Record<string, string>)[src.item_id];
            for (const [i, s] of src.manual_service_points.entries()) {
              const id = src.id + ":" + i;
              if (!entities.has(id)) {
                const e = entity(
                  src.id,
                  binding,
                  s.interaction_anchor.x,
                  s.interaction_anchor.z,
                  0,
                  -0.12,
                );
                ring(e.node, 0, 0, 0.4, "#dbb76a");
                entities.set(id, e);
              }
            }
          }
        }
        if (w) {
          for (const m of Object.values(w.machines).filter(
            (m) => m.type !== "channel",
          )) {
            const key = JSON.stringify([m.geometry, p.low]),
              old = entities.get(m.id);
            if (old?.key !== key) {
              old?.dispose();
              const e = facility(
                m.id,
                m.geometry,
                (catalog.machine_bindings as Record<string, string>)[m.type] ??
                  m.type,
              );
              e.key = key;
              entities.set(m.id, e);
            }
          }
          for (const [id, e] of entities)
            if (
              !fixedGeometry.some((g) => g.id === id) &&
              !id.startsWith("source_") &&
              !id.startsWith("pilot:") &&
              !w.machines[id] &&
              !w.crates[id]
            ) {
              e.dispose();
              entities.delete(id);
            }
          for (const [id, pos] of Object.entries(w.crates))
            if (!entities.has(id))
              entities.set(
                id,
                entity(id, "recovery_crate", pos.x + 0.5, pos.z + 0.5),
              );
          for (const [index, m] of Object.values(w.members).entries()) {
            let e = players.get(m.id);
            if (!m.connected) {
              if (e) e.node.visible = false;
              continue;
            }
            if (!e) {
              e = entity(
                "bag:" + m.id,
                "worker",
                m.position.x / UNIT,
                m.position.z / UNIT,
              );
              ring(e.node, 0, 0, 0.38, colors[index % 6]);
              label(e.node, `${index + 1} ${m.name}`, 2.15, colors[index % 6]);
              players.set(m.id, e);
            }
            if (m.id === p.member && e.visual && !e.silhouette)
              e.silhouette = createSilhouette(e.visual.root, colors[index % 6]);
            e.silhouette?.setVisible(false);
            e.node.visible = true;
            const dest = new T.Vector3(
                m.position.x / UNIT,
                0,
                m.position.z / UNIT,
              ),
              old = e.node.position.clone();
            if (
              m.id === p.member &&
              w.phase === "RUNNING" &&
              !w.pauses.length &&
              !viewControl.panel &&
              !p.overview &&
              !viewControl.resync &&
              performance.now() - viewControl.inputAt < 150
            ) {
              const input = viewControl.input,
                proposed = {
                  x: Math.round(
                    (e.node.position.x +
                      input.x *
                        (m.upgrades.includes("move_tier_1")
                          ? B.upgrades.move_tier_1.result_move_tiles_per_second
                          : B.player.base_move_tiles_per_second) *
                        dt) *
                      UNIT,
                  ),
                  z: Math.round(
                    (e.node.position.z +
                      input.z *
                        (m.upgrades.includes("move_tier_1")
                          ? B.upgrades.move_tier_1.result_move_tiles_per_second
                          : B.player.base_move_tiles_per_second) *
                        dt) *
                      UNIT,
                  ),
                };
              if (!blocked(proposed, solids(w)))
                e.node.position.set(proposed.x / UNIT, 0, proposed.z / UNIT);
              const delta = e.node.position.distanceTo(dest);
              if (delta > 1.5) e.node.position.copy(dest);
              else e.node.position.lerp(dest, Math.min(1, dt * 5));
            } else e.node.position.lerp(dest, Math.min(1, dt * 14));
            e.node.position.y = 0;
            const dx = e.node.position.x - old.x,
              dz = e.node.position.z - old.z,
              moving = Math.hypot(dx, dz) > 0.001;
            if (moving) e.node.rotation.y = Math.atan2(-dx, -dz);
            if (e.visual) {
              const bag = w.inventories["bag:" + m.id],
                carrying = bag?.kind === "PLAYER" && bag.slots.some(Boolean);
              playClip(
                e.visual,
                w.phase === "LAUNCHED"
                  ? "celebrate"
                  : m.work
                    ? "work_loop"
                    : moving
                      ? carrying
                        ? "carry_locomotion"
                        : "locomotion"
                      : "idle",
              );
              e.visual.mixer?.update(dt);
            }
          }
          for (const l of Object.values(w.links))
            if (!links.has(l.id)) {
              const a = geometry(w, l.from).delivery_distance_anchor,
                b = geometry(w, l.to).delivery_distance_anchor;
              const g = new T.BufferGeometry().setFromPoints([
                  new T.Vector3(a.x, 0.12, a.z),
                  new T.Vector3(b.x, 0.12, b.z),
                ]),
                m = new T.LineBasicMaterial({
                  color: "#519b97",
                  transparent: true,
                  opacity: 0.65,
                });
              ownGeo.add(g);
              ownMat.add(m);
              const line = new T.Line(g, m);
              scene.add(line);
              links.set(l.id, line);
            }
          for (const [id, l] of links)
            if (!w.links[id]) {
              l.removeFromParent();
              l.geometry.dispose();
              ownGeo.delete(l.geometry);
              for (const m of Array.isArray(l.material)
                ? l.material
                : [l.material]) {
                m.dispose();
                ownMat.delete(m);
              }
              links.delete(id);
            }
          for (const c of Object.values(w.cargo)) {
            let e = cargo.get(c.id);
            if (!e) {
              e = entity("cargo:" + c.id, "cargo_pod", 0, 0);
              cargo.set(c.id, e);
            }
            const a = geometry(w, c.from).delivery_distance_anchor,
              b = geometry(w, c.to).delivery_distance_anchor,
              t = Math.min(
                1,
                Math.max(
                  0,
                  (Number(w.tick) - Number(c.departed)) /
                    (Number(c.arrival) - Number(c.departed)),
                ),
              );
            e.node.position.set(
              a.x + (b.x - a.x) * t,
              0.18,
              a.z + (b.z - a.z) * t,
            );
          }
          for (const [id, e] of cargo)
            if (!w.cargo[id]) {
              e.dispose();
              cargo.delete(id);
            }
          const construction = rocketPresentation(w);
          const key = `${construction.key}:${p.low}`;
          if (key !== rocketKey) {
            rocketKey = key;
            for (const v of rocketVisuals) {
              const i = clickables.indexOf(v.root);
              if (i >= 0) clickables.splice(i, 1);
              v.root.traverse((o) => {
                if (o instanceof T.Mesh)
                  for (const m of Array.isArray(o.material)
                    ? o.material
                    : [o.material])
                    fades.forget(m);
              });
              v.release();
            }
            rocketVisuals.length = 0;
            for (const part of construction.parts) {
              const [x, y, z] = part.position;
              rocketPart(
                part.asset,
                part.parent === "ground" ? rocketGround : rocketFlight,
                y,
                x,
                z,
                part.rotation,
                part.assembled,
              );
            }
            buildMarkers.forEach((marker, i) => {
              (marker.material as T.MeshStandardMaterial).color.set(
                i < construction.assembly
                  ? "#2f8878"
                  : i < construction.delivery
                    ? "#e1a24f"
                    : "#acb6aa",
              );
            });
          }
          if (w.phase === "LAUNCHED") {
            if (!launchedAt) launchedAt = now;
            rocketFlight.position.y = viewControl.reduced
              ? 0
              : Math.min(45, ((now - launchedAt) / 1000) * 3);
          } else {
            rocketFlight.position.y = 0;
            launchedAt = 0;
          }
        }
      }
      const player = players.get(p.member)?.node,
        anchor = player
          ? { x: player.position.x, z: player.position.z }
          : p.pilot
            ? p.review?.interactive
              ? pilotPosition
              : { x: 24, z: 18 }
            : { x: 24, z: 16 };
      if (!initialized && loaded) {
        controller.recenter(anchor);
        initialized = true;
      }
      if (viewControl.recenter !== oldRecenter) {
        oldRecenter = viewControl.recenter;
        controller.recenter(anchor);
        heldAfterPanel = false;
        viewControl.resync = false;
      }
      if (viewControl.zoom) {
        controller.step = Math.max(
          0,
          Math.min(2, controller.step + viewControl.zoom),
        );
        viewControl.zoom = 0;
      }
      if (viewControl.panel && !oldPanel) {
        heldAfterPanel = true;
        controller.vx = controller.vz = 0;
      }
      oldPanel = viewControl.panel;
      if (!viewControl.panel && (viewControl.input.x || viewControl.input.z))
        heldAfterPanel = false;
      controller.follow = viewControl.follow;
      controller.held =
        viewControl.panel || heldAfterPanel || viewControl.resync;
      if (p.overview && !oldOverview) {
        overviewSave = {
          x: controller.x,
          z: controller.z,
          step: controller.step,
          detached: controller.detached,
        };
      }
      if (!p.overview && oldOverview && overviewSave)
        Object.assign(controller, overviewSave);
      oldOverview = p.overview;
      span = spanHeight(
        cssH,
        matchMedia("(pointer:coarse)").matches,
        controller.step,
      );
      let tx = controller.x,
        tz = controller.z,
        ty = 0;
      if (p.overview && !p.pilot) {
        tx = 24;
        tz = 16;
        span =
          Math.max((48 + 32) * S * Q + 8 * C, ((48 + 32) * Q) / (cssW / cssH)) *
          1.12;
      } else if (viewControl.launchView) {
        tx = 24.5;
        tz = 26;
        ty = 4;
        span = 16;
      } else {
        controller.advance(anchor, dt, (span * cssW) / cssH, span);
        tx = controller.x;
        tz = controller.z;
      }
      camera.left = (-span * cssW) / cssH / 2;
      camera.right = -camera.left;
      camera.top = span / 2;
      camera.bottom = -span / 2;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      camera.position.set(tx + C * Q * 80, ty + S * 80, tz + C * Q * 80);
      camera.lookAt(tx, ty, tz);
      camera.updateMatrixWorld();
      if (player && !p.overview) {
        const ndc = player.position.clone().project(camera);
        offscreen.hidden = Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.85;
      } else offscreen.hidden = true;
      // Match the orthographic projection and fade complete visual instances only.
      // Labels, service rings, click targets and server geometry remain independent.
      const hitMats = new Set<T.Material>();
      const blockers = [...entities.values()]
        .flatMap((e) => (e.visual ? [e.visual.root] : []))
        .concat(rocketVisuals.map((v) => v.root));
      function findOccluders(target: T.Vector3) {
        let blocked = false;
        for (const hit of occlusionRay(camera, target).intersectObjects(
          blockers,
          true,
        )) {
          let root: T.Object3D | null = hit.object;
          while (root && !blockers.includes(root as T.Group))
            root = root.parent;
          if (!root) continue;
          blocked = true;
          root.traverse((o) => {
            if (o instanceof T.Mesh)
              for (const m of Array.isArray(o.material)
                ? o.material
                : [o.material])
                hitMats.add(m);
          });
        }
        return blocked;
      }
      if (player && !p.overview) {
        const hiddenPlayer = findOccluders(
          player.position.clone().add(new T.Vector3(0, 0.9, 0)),
        );
        players.get(p.member)?.silhouette?.setVisible(hiddenPlayer);
        if (w && p.selected) {
          try {
            const g = geometry(w, p.selected);
            const nearest = g.service_points.reduce<
              Geometry["service_points"][number] | null
            >((best, service) => {
              const a = service.interaction_anchor;
              const b = best?.interaction_anchor;
              return !b ||
                Math.hypot(a.x - player.position.x, a.z - player.position.z) <
                  Math.hypot(b.x - player.position.x, b.z - player.position.z)
                ? service
                : best;
            }, null);
            if (nearest)
              findOccluders(
                new T.Vector3(
                  nearest.interaction_anchor.x,
                  0.1,
                  nearest.interaction_anchor.z,
                ),
              );
          } catch {
            /* Selection may be removed in the same snapshot. */
          }
        }
      }
      fades.update(hitMats, now, dt, viewControl.reduced);
      const gh = p.ghost,
        key = JSON.stringify([gh, p.low]);
      if (key !== ghostKey) {
        ghostKey = key;
        ghost?.dispose();
        ghost = null;
        if (gh) {
          const g = machineGeometry("ghost", gh.type, gh.x, gh.z, gh.rotation);
          ghost = facility(
            "ghost",
            g,
            (catalog.machine_bindings as Record<string, string>)[gh.type] ??
              gh.type,
          );
          const valid = w && !placement(w, g, gh.moveId);
          ghost.node.traverse((o) => {
            if (o instanceof T.Mesh) {
              for (const m of Array.isArray(o.material)
                ? o.material
                : [o.material]) {
                m.transparent = true;
                m.opacity = 0.5;
                if (m instanceof T.MeshStandardMaterial)
                  m.color.set(valid ? "#72bb91" : "#df6868");
              }
            }
          });
        }
      }
      selection.visible = false;
      if (p.selected && w) {
        try {
          const g = geometry(w, p.selected);
          selection.position.set(
            g.delivery_distance_anchor.x,
            0.08,
            g.delivery_distance_anchor.z,
          );
          selection.visible = true;
        } catch {}
      }
      if (loaded)
        status.textContent = viewControl.resync
          ? "화면을 동기화했습니다. 이동하거나 F를 눌러 계속하세요."
          : p.overview
            ? "둘러보기 · 작업은 계속됩니다 · F로 돌아가기"
            : "";
      if (!p.low || now - lastRender >= 1000 / 30) {
        renderer.render(scene, camera);
        lastRender = now;
      }
      const metrics = {
        webgl: true,
        quality: p.low ? "low" : "standard",
        loaded,
        assets: manifest?.assets.map((a) => a.id),
        css: [cssW, cssH],
        drawing: [renderer.domElement.width, renderer.domElement.height],
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        camera: { elevation: 55, azimuth: 45, span, target: [tx, ty, tz] },
        pilot: p.pilot ?? false,
        review: p.review
          ? {
              ...p.review,
              clip: pilotMoving
                ? p.review.clip === "carry_locomotion"
                  ? "carry_locomotion"
                  : "locomotion"
                : p.review.clip,
            }
          : undefined,
        pilotPosition: p.pilot ? pilotPosition : undefined,
        context: {
          version: renderer
            .getContext()
            .getParameter(renderer.getContext().VERSION),
        },
      };
      element.dataset.metrics = JSON.stringify(metrics);
    }
    frame = requestAnimationFrame(animate);
    return () => {
      disposed = true;
      viewControl.graphicsReady = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      for (const e of [
        ...entities.values(),
        ...players.values(),
        ...cargo.values(),
      ])
        e.dispose();
      for (const v of rocketVisuals) v.release();
      ghost?.dispose();
      ownGeo.forEach((g) => g.dispose());
      ownMat.forEach((m) => m.dispose());
      ownTex.forEach((t) => t.dispose());
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      fades.clear();
      renderer.dispose();
      element.replaceChildren();
    };
  }, [attempt]);
  return <div ref={host} className="world-canvas" />;
}
