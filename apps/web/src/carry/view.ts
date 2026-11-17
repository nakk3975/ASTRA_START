import { MotionSmoother } from "./motion";
import * as T from "three";
import {
  assetInstance,
  preloadAssets,
  playClip,
  type Visual,
} from "../visuals/assets";
import { ROCKET_PARTS } from "../visuals/rocket";
import { OcclusionFade, createSilhouette } from "../visuals/occlusion";
import {
  ITEM,
  MACHINE_CATALOG,
  MACHINE_GRADES,
  MARKET,
  machinePlacementReason,
  type MachineKind,
  CFG,
  hands,
  COLORS,
  MAP,
  SOURCES,
  machinePort,
  floorHeight,
  currentStage,
  PROFILES,
  targets,
  placementReason,
  deviceEnds,
  type World,
  type Kind,
  type DeviceKind,
  type V3,
} from "../../../../packages/carry-core/src/index.ts";
export type Settings = {
  low: boolean;
  renderScale: number;
  lock: boolean;
  distance: number;
};
export type Mode =
  | {
      kind: "place";
      device: DeviceKind;
      rotation: number;
      x?: number;
      z?: number;
    }
  | {
      kind: "machine";
      machine: MachineKind;
      rotation: number;
      x?: number;
      z?: number;
    }
  | { kind: "ping" }
  | null;
export class CarryView {
  renderer!: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(35, 1, 0.1, 120);
  world: World | null = null;
  member = "";
  motion = new MotionSmoother();
  localInput = { x: 0, z: 0 };
  receive(w: World, member: string, rtt = 0) {
    this.world = w;
    this.member = member;
    this.motion.receive(w, member, performance.now(), rtt);
  }
  ready = false;
  error = "";
  mode: Mode = null;
  target = "";
  settings: Settings = {
    low: false,
    renderScale: 1,
    lock: false,
    distance: 32,
  };
  onError = (s: string) => {};
  onGround = (p: V3) => {};
  onMetrics = (m: any) => {};
  private disposed = false;
  private frame = 0;
  private last = 0;
  private metricsAt = 0;
  private anchor = new T.Vector3(-14, 0, -3);
  private v = new T.Vector3();
  private instances = new Map<
    string,
    {
      group: T.Group;
      visual?: Visual;
      silhouette?: ReturnType<typeof createSilhouette>;
    }
  >();
  private geometries = new Set<T.BufferGeometry>();
  private materials = new Set<T.Material>();
  private fades = new OcclusionFade();
  private loaded = false;
  private observer: ResizeObserver;
  private selection: T.Mesh;
  private ghost = new T.Group();
  private rocket = new T.Group();
  private rocketKey = "";
  private worldId = "";
  private width = 1;
  private height = 1;
  private canvas: HTMLCanvasElement;
  private sun = new T.DirectionalLight("#fff0cf", 3);
  private bg = new T.Color("#a6c5cf");
  private launchAt: number | null = null;
  constructor(private host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "고철에서 우주까지 3D 작업장");
    host.append(this.canvas);
    this.selection = new T.Mesh(
      this.geo(new T.RingGeometry(0.5, 0.55, 40)),
      this.mat("#f59e0b", true),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.scene.add(this.selection, this.ghost, this.rocket);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    let detail = "";
    this.canvas.addEventListener("webglcontextcreationerror", (e) => {
      detail = (e as WebGLContextEvent).statusMessage;
    });
    try {
      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: "default",
      });
    } catch (e) {
      this.fail("WEBGL_UNAVAILABLE", detail || (e as Error).message);
      return;
    }
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene.background = this.bg;
    this.scene.fog = new T.Fog("#a6c5cf", 55, 110);
    this.scene.add(new T.HemisphereLight("#eff9ff", "#585b64", 2.2));
    this.sun.position.set(-12, 26, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -29,
      right: 29,
      top: 26,
      bottom: -26,
      near: 1,
      far: 70,
    });
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
    this.map();
    this.resize();
    this.canvas.addEventListener("pointerdown", this.pointer);
    this.canvas.addEventListener("pointermove", this.hover);
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.ready = false;
      this.fail(
        "WEBGL_CONTEXT_LOST",
        "그래픽 연결이 끊어졌습니다. 다시 시작해 주세요.",
      );
      cancelAnimationFrame(this.frame);
    });
    void preloadAssets()
      .then(() => {
        if (this.disposed) return;
        this.loaded = true;
        this.ready = true;
        this.onError("");
      })
      .catch((e) => this.fail("MODEL_LOAD_FAILED", (e as Error).message));
    this.frame = requestAnimationFrame(this.animate);
  }
  private fail(reason: string, detail: string) {
    this.error = `${reason}: ${detail}`;
    this.host.dataset.metrics = JSON.stringify({
      webgl: false,
      loaded: false,
      reason,
      detail,
    });
    this.onError(`${reason}: ${detail}`);
  }
  private geo<G extends T.BufferGeometry>(g: G): G {
    this.geometries.add(g);
    return g;
  }
  private mat(color: string, basic = false) {
    const m = basic
      ? new T.MeshBasicMaterial({ color, side: T.DoubleSide })
      : new T.MeshStandardMaterial({ color, roughness: 0.87 });
    this.materials.add(m);
    return m;
  }
  private box(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) {
    const m = new T.Mesh(this.geo(new T.BoxGeometry(w, h, d)), this.mat(color));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  private cylinder(
    parent: T.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    color: string,
  ) {
    const m = new T.Mesh(
      this.geo(new T.CylinderGeometry(r, r, h, 16)),
      this.mat(color),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  private map() {
    this.box(this.scene, MARKET.x, 0.3, MARKET.z, 2, 0.6, 1.2, "#9f784b");
    this.label(this.scene, "판매소 · E 판매", MARKET.x, 1.8, MARKET.z, 3.5);
    this.box(this.scene, 0, -0.4, 0, 48, 0.8, 26, "#23272f");
    this.box(this.scene, -16, -0.02, 0, 15, 0.08, 24, "#58636a");
    this.box(this.scene, -2, 0.015, 0, 20, 0.05, 24, "#78858b");
    this.box(this.scene, 17, 0.6, 0, 10, 1.2, 12, "#7c919c");
    this.box(this.scene, 17, 1.21, 0, 10, 0.035, 12, "#b8c7c9");
    const ramp = new T.BufferGeometry();
    ramp.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        [
          8, 0, -2, 12, 1.2, -2, 12, 1.2, 2, 8, 0, -2, 12, 1.2, 2, 8, 0, 2, 8,
          0, -2, 12, 0, -2, 12, 1.2, -2, 8, 0, 2, 12, 1.2, 2, 12, 0, 2,
        ],
        3,
      ),
    );
    ramp.computeVertexNormals();
    const rm = new T.Mesh(this.geo(ramp), this.mat("#9aa8aa"));
    rm.receiveShadow = true;
    this.scene.add(rm);
    const stripe = new T.InstancedMesh(
      this.geo(new T.BoxGeometry(0.45, 0.025, 0.16)),
      this.mat("#f59e0b"),
      88,
    );
    const matrix = new T.Matrix4();
    for (let i = 0; i < 88; i++) {
      matrix.makeTranslation(-21 + (i % 44), 0.07, i < 44 ? -10 : 10);
      stripe.setMatrixAt(i, matrix);
    }
    this.scene.add(stripe);
    for (let z = -11; z <= 11; z += 2) {
      this.box(this.scene, -22.6, 0.6, z, 0.16, 1.2, 0.16, "#8b999f");
    }
    this.box(this.scene, -22.6, 0.9, 0, 0.12, 0.12, 23, "#a5b4b8");
    this.box(this.scene, -22.6, 0.35, 0, 0.12, 0.1, 23, "#829296");
    for (const src of SOURCES) {
      this.box(
        this.scene,
        src.x - 0.6,
        0.18,
        src.z + 0.35,
        0.4,
        0.35,
        2.1,
        "#394d54",
      );
      this.label(
        this.scene,
        ITEM[src.kind].name + " 광맥",
        src.x,
        1.5,
        src.z - 1.1,
        2.4,
      );
    }
    this.label(this.scene, "01  폐기장", -16, 0.8, -11.5, 4);
    this.label(this.scene, "02  가공 작업장", -2, 0.8, -11.5, 4.5);
    this.label(this.scene, "03  발사대", 17, 2, -7, 4);
    for (let x = -20; x < 22; x += 2)
      for (let z = -10; z <= 10; z += 2) {
        const h = floorHeight(x, z);
        const l = this.box(
          this.scene,
          x,
          h + 0.035,
          z,
          1.96,
          0.008,
          0.015,
          "#839ca2",
        );
        (l.material as T.Material).transparent = true;
        (l.material as T.Material).opacity = 0.16;
        l.castShadow = false;
      }
  }
  private label(
    parent: T.Object3D,
    text: string,
    x: number,
    y: number,
    z: number,
    width = 2.7,
  ) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#161920dd";
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 96, 18);
    ctx.fill();
    ctx.font = "600 38px sans-serif";
    ctx.fillStyle = "#f5f5e9";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 62);
    const tex = new T.CanvasTexture(c);
    const mat = new T.SpriteMaterial({ map: tex, depthWrite: false });
    const sprite = new T.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(width, (width * 96) / 512, 1);
    parent.add(sprite);
    sprite.userData.dispose = () => {
      tex.dispose();
      mat.dispose();
    };
    return sprite;
  }
  private addModel(key: string, asset: string, pos: V3) {
    const group = new T.Group();
    group.position.set(pos.x, pos.y, pos.z);
    const visual = assetInstance(asset, this.settings.low) ?? undefined;
    if (visual) {
      group.add(visual.root);
      visual.root.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = !this.settings.low;
          o.receiveShadow = true;
        }
      });
    } else {
      this.box(group, 0, 0.45, 0, 0.9, 0.9, 0.9, "#f59e0b");
      group.userData.placeholder = true;
    }
    this.scene.add(group);
    const e = { group, visual };
    this.instances.set(key, e);
    return e;
  }
  private loose(kind: Kind) {
    const g = new T.Group(),
      a = ITEM[kind];
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ) => this.box(g, x, y, z, w, h, d, a.color);
    if (a.shape === "scrap") {
      box(0, 0.16, 0, 0.65, 0.17, 0.25).rotation.y = 0.4;
      box(0.12, 0.25, 0, 0.18, 0.4, 0.32).rotation.z = 0.25;
    } else if (a.shape === "plate" || a.shape === "hull") {
      box(0, 0.12, 0, 0.8, 0.13, 0.55);
      if (a.shape === "hull") box(0, 0.22, 0, 0.12, 0.1, 0.55);
    } else if (a.shape === "tank") {
      this.cylinder(g, 0, 0.38, 0, 0.22, 0.7, a.color);
      this.cylinder(g, 0, 0.76, 0, 0.1, 0.1, "#f59e0b");
    } else if (a.shape === "coil" || a.shape === "gear") {
      const mesh = new T.Mesh(
        this.geo(
          new T.TorusGeometry(
            0.27,
            a.shape === "gear" ? 0.085 : 0.05,
            6,
            a.shape === "gear" ? 10 : 20,
          ),
        ),
        this.mat(a.color),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.18;
      g.add(mesh);
    } else if (a.shape === "crystal") {
      const mesh = new T.Mesh(
        this.geo(new T.OctahedronGeometry(0.31)),
        this.mat(a.color),
      );
      mesh.position.y = 0.33;
      g.add(mesh);
    } else if (a.shape === "engine") {
      const v = assetInstance("rocket_engine", this.settings.low);
      if (v) {
        v.root.scale.setScalar(0.24);
        g.add(v.root);
        g.userData.release = v.release;
      }
    } else if (a.shape === "control" || a.shape === "circuit") {
      box(0, 0.12, 0, 0.5, 0.15, 0.5);
      this.box(g, 0, 0.22, 0, 0.2, 0.12, 0.2, "#eeeece");
    } else if (a.shape === "kit") {
      box(0, 0.3, 0, 0.6, 0.6, 0.6);
      this.box(g, 0, 0.61, 0, 0.15, 0.04, 0.61, "#06b6d4");
    } else if (a.shape === "ingot") {
      box(0, 0.18, 0, 0.55, 0.3, 0.3);
    } else {
      box(0, 0.15, 0, 0.45, 0.2, 0.5).rotation.y = 0.3;
      box(0.1, 0.28, 0, 0.35, 0.15, 0.24);
    }
    return g;
  }
  private remove(key: string) {
    const e = this.instances.get(key);
    if (!e) return;
    e.visual?.release();
    e.silhouette?.dispose();
    e.group.traverse((o) => {
      o.userData.dispose?.();
      o.userData.release?.();
      if (o instanceof T.Mesh) {
        if (this.geometries.delete(o.geometry)) o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (this.materials.delete(m)) m.dispose();
      }
    });
    e.group.removeFromParent();
    this.instances.delete(key);
  }
  private hover = (event: PointerEvent) => {
    if (!this.mode || this.mode.kind === "ping") return;
    const p = this.groundPoint(event);
    this.mode.x = p.x;
    this.mode.z = p.z;
  };
  private pointer = (event: PointerEvent) => {
    this.canvas.focus();
    this.onGround(this.groundPoint(event));
  };
  private groundPoint(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        (-(event.clientY - r.top) / r.height) * 2 + 1,
      ),
      this.camera,
    );
    const p = new T.Vector3();
    ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), p);
    if (p.x >= 12 && p.x <= 22 && Math.abs(p.z) <= 6)
      ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -1.2), p);
    return {
      x: Math.round(p.x * 2) / 2,
      y: floorHeight(p.x, p.z),
      z: Math.round(p.z * 2) / 2,
    };
  }
  recenter() {
    const p = this.world?.players[this.member];
    if (p) this.anchor.set(p.pos.x, p.pos.y, p.pos.z);
  }
  private resize() {
    const b = this.host.getBoundingClientRect();
    this.width = Math.max(1, b.width);
    this.height = Math.max(1, b.height);
    if (!this.renderer) return;
    const ratio =
      Math.min(
        devicePixelRatio,
        this.settings.low ? 1 : 1.5,
        Math.sqrt((2560 * 1440) / (this.width * this.height)),
      ) * this.settings.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }
  applySettings(settings: Settings) {
    const lodChanged = this.settings.low !== settings.low;
    this.settings = settings;
    this.resize();
    if (this.renderer) this.renderer.shadowMap.enabled = !settings.low;
    if (lodChanged) {
      this.fades.clear();
      for (const key of [...this.instances.keys()]) this.remove(key);
      this.rocketKey = "";
    }
  }
  private animate = (now: number) => {
    if (this.disposed) return;
    const rawDt = (now - this.last) / 1000 || 0.016,
      dt = Math.min(0.05, rawDt);
    this.last = now;
    this.frame = requestAnimationFrame(this.animate);
    const w = this.world,
      p = w?.players[this.member];
    if (w && this.loaded) {
      if (this.worldId !== w.id) {
        this.fades.clear();
        for (const key of [...this.instances.keys()]) this.remove(key);
        this.worldId = w.id;
        this.rocketKey = "";
        this.recenter();
      }
      for (const src of SOURCES) {
        const key = `vein:${src.kind}`;
        if (!this.instances.has(key)) {
          const asset = {
              metal_scrap: "source_metal",
              cable_scrap: "source_cable",
              plastic_scrap: "source_plastic",
              energy_shard: "source_energy",
            }[src.kind],
            e = this.addModel(key, asset, { x: src.x, y: 0.45, z: src.z });
          e.visual?.root.scale.set(2.2, 3, 2.2);
          const stone = new T.Mesh(
            this.geo(new T.DodecahedronGeometry(0.9, 0)),
            this.mat("#5c6d77"),
          );
          stone.scale.set(1, 0.7, 1);
          stone.position.y = -0.1;
          e.group.add(stone);
        }
      }
      for (const key of [...this.instances.keys()])
        if (this.instances.get(key)?.group.userData.machine && !w.machines[key])
          this.remove(key);
      for (const m of Object.values(w.machines)) {
        let e = this.instances.get(m.id);
        if (e && e.group.userData.tier !== m.tier) {
          this.remove(m.id);
          e = undefined;
        }
        if (!e) {
          if (m.tier === 0) {
            const group = new T.Group();
            group.position.set(m.pos.x, 0, m.pos.z);
            this.scene.add(group);
            e = { group };
            this.instances.set(m.id, e);
            this.box(group, 0, 0.85, 0, 2.1, 0.18, 1.6, "#99754a");
            for (const x of [-0.8, 0.8])
              for (const z of [-0.6, 0.6])
                this.box(group, x, 0.4, z, 0.16, 0.8, 0.16, "#64513b");
            if (m.type !== "bench") {
              this.box(group, 0, 1.15, 0, 0.8, 0.5, 0.8, "#65727b");
              this.cylinder(group, 0.45, 1.4, 0, 0.15, 0.4, "#b19668");
            }
          } else
            e = this.addModel(
              m.id,
              m.type === "bench"
                ? m.tier === 1
                  ? "workbench"
                  : m.tier === 2
                    ? "fabricator"
                    : "assembler"
                : m.type,
              m.pos,
            );
          e.group.userData.machine = true;
          e.group.userData.tier = m.tier;
          for (const out of [false, true]) {
            this.box(
              e.group,
              out ? 1.6 : -1.6,
              0.1,
              0,
              1.05,
              0.2,
              1.5,
              out ? "#25858e" : "#a87825",
            );
          }
          const label = this.label(
            e.group,
            `${MACHINE_GRADES[m.tier]} · ${MACHINE_CATALOG[m.type as MachineKind]?.name.replace("낡은 ", "").replace("기초 ", "") ?? m.type}`,
            0,
            2.35,
            0,
          );
          label.userData.machineLabel = true;
          e.group.rotation.y = (-m.rotation * Math.PI) / 2;
        }
      }
      const alive = new Set<string>();
      for (const q of Object.values(w.players).filter((q) => q.connected)) {
        const key = `player:${q.id}`;
        alive.add(key);
        let e = this.instances.get(key);
        if (e && e.group.userData.avatar !== q.avatar) {
          this.remove(key);
          e = undefined;
        }
        if (!e) {
          e = this.addModel(key, q.avatar ?? "worker", q.pos);
          e.group.userData.avatar = q.avatar;
          const disc = new T.Mesh(
            this.geo(new T.RingGeometry(0.35, 0.41, 24)),
            this.mat(COLORS[q.seat], true),
          );
          disc.rotation.x = -Math.PI / 2;
          disc.position.y = 0.025;
          e.group.add(disc);
          this.label(e.group, `${q.seat + 1} ${q.name}`, 0, 2.05, 0, 2.1);
          if (q.id === this.member && e.visual)
            e.silhouette = createSilhouette(e.visual.root, COLORS[q.seat]);
        }
        const position =
          q.id === this.member
            ? this.motion.step(w, this.member, this.localInput, dt, now)
            : this.motion.remote(w, q.id, now);
        e.group.position.set(position.x, position.y, position.z);
        const input = q.id === this.member ? this.localInput : q.input;
        const facing = Math.hypot(input.x, input.z) > 0.01 ? input : q.facing,
          angle = Math.atan2(-facing.x, -facing.z);
        e.group.rotation.y +=
          Math.atan2(
            Math.sin(angle - e.group.rotation.y),
            Math.cos(angle - e.group.rotation.y),
          ) *
          (1 - Math.exp(-dt * 18));
        const moving =
          (q.id === this.member || w.time - q.input.at < CFG.inputExpiry) &&
          Math.hypot(input.x, input.z) > 0.01;
        if (e.visual) {
          const clip =
            w.phase === "LAUNCHED"
              ? "celebrate"
              : q.actionUntil > w.time
                ? "work_loop"
                : q.hand
                  ? "carry_locomotion"
                  : moving
                    ? "locomotion"
                    : "idle";
          playClip(e.visual, clip);
          const animation = e.visual.clips.find((c) => c.name === clip);
          if (animation)
            e.visual.mixer
              ?.clipAction(animation)
              .setEffectiveTimeScale(
                clip === "carry_locomotion" && !moving ? 0 : 1,
              );
          e.visual.mixer?.update(dt);
        }
      }
      for (const i of Object.values(w.items)) {
        if (["consumed", "installed", "processing"].includes(i.state)) continue;
        const key = `item:${i.id}`;
        alive.add(key);
        let e = this.instances.get(key);
        if (!e) {
          const group = this.loose(i.kind);
          this.scene.add(group);
          e = { group };
          e.group.position.set(i.pos.x, i.pos.y, i.pos.z);
          this.instances.set(key, e);
        }
        if (i.state === "hand") {
          const q = w.players[i.owner!],
            worker = this.instances.get(`player:${q.id}`);
          e.group.position.copy(
            worker?.group.position ?? this.v.set(q.pos.x, q.pos.y, q.pos.z),
          );
          const slot = hands(q).indexOf(i.id);
          e.group.position.add(
            new T.Vector3(
              q.facing.x * 0.62 + (slot >= 4 ? 0.22 : -0.08),
              0.92 + (slot % 4) * 0.19,
              q.facing.z * 0.62,
            ),
          );
          if (hands(q).length > 1) e.group.scale.setScalar(0.82);
          else e.group.scale.setScalar(1);
          e.group.rotation.y = Math.atan2(q.facing.x, q.facing.z);
        } else {
          e.group.position.lerp(
            this.v.set(i.pos.x, i.pos.y, i.pos.z),
            i.state === "ground" ? 1 : 1 - Math.exp(-dt * 18),
          );
          e.group.rotation.y = i.rotation;
        }
      }
      for (const d of Object.values(w.devices)) {
        const key = `device:${d.id}`;
        alive.add(key);
        let e = this.instances.get(key);
        if (!e) {
          const group = new T.Group();
          group.position.set(d.pos.x, d.pos.y, d.pos.z);
          this.scene.add(group);
          e = { group };
          this.instances.set(key, e);
          if (["crane", "miner", "installer"].includes(d.type)) {
            const v = assetInstance(
              d.type === "installer" ? "assembler" : "extractor",
              this.settings.low,
            );
            if (v) {
              e.visual = v;
              group.add(v.root);
            }
            if (d.type === "crane")
              this.box(group, 0, 2.6, 0, 3.2, 0.15, 0.15, "#f59e0b");
            else if (d.type === "miner") {
              this.cylinder(group, 0, 1.8, 0, 0.25, 0.6, "#f59e0b");
            } else this.box(group, 0.7, 1.6, 0, 1.8, 0.15, 0.15, "#06b6d4");
          } else {
            this.box(
              group,
              0,
              0.16,
              0,
              1.35,
              0.3,
              1.05,
              d.type === "tray" ? "#4f9c9f" : "#3c454e",
            );
            if (d.type === "straight")
              for (let k = -2; k <= 2; k++)
                this.box(group, k * 0.25, 0.33, 0, 0.08, 0.05, 0.95, "#a4acaa");
            if (d.type === "corner") {
              this.box(group, -0.3, 0.34, 0, 0.7, 0.08, 0.4, "#a4acaa");
              this.box(
                group,
                0,
                0.34,
                d.rotation >= 4 ? -0.35 : 0.35,
                0.4,
                0.08,
                0.7,
                "#a4acaa",
              );
            }
            if (d.type !== "tray") {
              const arrow = new T.Mesh(
                this.geo(new T.ConeGeometry(0.16, 0.32, 3)),
                this.mat("#f59e0b", true),
              );
              arrow.rotation.z = -Math.PI / 2;
              if (d.type === "corner")
                arrow.rotation.y = d.rotation >= 4 ? Math.PI / 2 : -Math.PI / 2;
              arrow.position.set(
                0.2,
                0.41,
                d.type === "corner" ? (d.rotation >= 4 ? -0.3 : 0.3) : 0,
              );
              group.add(arrow);
            }
          }
          group.rotation.y = (-d.rotation * Math.PI) / 2;
        }
      }
      for (const key of [...this.instances.keys()])
        if (
          (key.startsWith("item:") ||
            key.startsWith("player:") ||
            key.startsWith("device:")) &&
          !alive.has(key)
        )
          this.remove(key);
      const stage = currentStage(w),
        installed = w.sockets.filter((s) => s.item).length,
        key = `${installed}:${this.settings.low}`;
      if (this.rocketKey !== key) {
        this.rocketKey = key;
        this.rocket.traverse((o) => o.userData.release?.());
        this.rocket.clear();
        for (const part of ROCKET_PARTS) {
          const phase =
            part.asset === "rocket_pad"
              ? 0
              : part.asset === "rocket_gantry" || part.asset.endsWith("_hull")
                ? 1
                : part.asset === "rocket_engine"
                  ? 2
                  : part.asset === "rocket_panel"
                    ? part.stage === 4
                      ? 3
                      : 4
                    : 5;
          const v = assetInstance(part.asset, this.settings.low);
          if (!v) continue;
          v.root.position.set(
            18 + part.position[0] * 0.72,
            1.2 + part.position[1] * 0.72,
            part.position[2] * 0.72,
          );
          v.root.rotation.y = part.rotation;
          v.root.scale.setScalar(0.72);
          const slots = w.sockets.filter(
              (s) => s.stage === (w.profile === "lab" ? 0 : phase),
            ),
            ratio = slots.length
              ? slots.filter((s) => s.item).length / slots.length
              : 0;
          v.root.traverse((o) => {
            if (o instanceof T.Mesh) {
              o.castShadow = ratio === 1;
              for (const m of Array.isArray(o.material)
                ? o.material
                : [o.material]) {
                m.transparent = ratio < 1;
                m.opacity = 0.12 + 0.88 * ratio;
              }
            }
          });
          v.root.userData = {
            release: v.release,
            baseY: v.root.position.y,
            flight: part.parent === "flight",
          };
          this.rocket.add(v.root);
        }
      }
      if (w.phase === "LAUNCHED") this.launchAt ??= now;
      else this.launchAt = null;
      for (const part of this.rocket.children)
        part.position.y =
          part.userData.baseY +
          (this.launchAt && part.userData.flight
            ? Math.min(30, ((now - this.launchAt) / 1000) * 2)
            : 0);

      for (const s of w.sockets) {
        const key = s.id;
        let e = this.instances.get(key);
        if (!e) {
          const group = new T.Group();
          group.position.set(s.pos.x, s.pos.y + 0.02, s.pos.z);
          this.scene.add(group);
          e = { group };
          this.instances.set(key, e);
          this.cylinder(group, 0, 0.06, 0, 0.45, 0.1, "#06b6d4");
          const preview = this.loose(s.kind);
          preview.position.y = 0.12;
          preview.traverse((o) => {
            if (o instanceof T.Mesh) {
              const mats = Array.isArray(o.material)
                ? o.material
                : [o.material];
              for (const m of mats) {
                m.transparent = true;
                m.opacity = 0.26;
              }
            }
          });
          group.add(preview);
        }
        e.group.visible = s.stage === stage;
        if (s.item) e.group.scale.setScalar(0.7);
      }
      const t = p ? targets(w, p)[0] : undefined;
      this.target = t?.id ?? "";
      this.selection.visible = !!t;
      if (t) this.selection.position.set(t.pos.x, t.pos.y + 0.06, t.pos.z);
      this.ghost.visible = !!p && !!this.mode && this.mode.kind !== "ping";
      if (p && this.mode && this.mode.kind !== "ping") {
        if (!this.ghost.children.length) {
          const box = this.box(
            this.ghost,
            0,
            0.25,
            0,
            1.35,
            0.5,
            1.05,
            "#06b6d4",
          );
          const m = box.material as T.MeshStandardMaterial;
          m.transparent = true;
          m.opacity = 0.45;
        }
        const x =
            this.mode.x ??
            Math.round(
              (p.pos.x +
                p.facing.x * (this.mode.kind === "machine" ? 2.5 : 1.4)) *
                2,
            ) / 2,
          z =
            this.mode.z ??
            Math.round(
              (p.pos.z +
                p.facing.z * (this.mode.kind === "machine" ? 2.5 : 1.4)) *
                2,
            ) / 2;
        this.ghost.position.set(x, floorHeight(x, z) + 0.02, z);
        this.ghost.rotation.y = (-this.mode.rotation * Math.PI) / 2;
        (this.ghost.children[0] as T.Mesh).scale.set(
          this.mode.kind === "machine" ? 1.75 : 1,
          1,
          this.mode.kind === "machine" ? 2 : 1,
        );
        const reason =
          this.mode.kind === "machine"
            ? machinePlacementReason(w, p, x, z, this.mode.rotation)
            : placementReason(w, p, this.mode.device, x, z, this.mode.rotation);
        (
          (this.ghost.children[0] as T.Mesh).material as T.MeshStandardMaterial
        ).color.set(reason ? "#f47272" : "#06b6d4");
      }
      if (p) {
        const displayed =
          this.instances.get(`player:${p.id}`)?.group.position ?? p.pos;
        const target = new T.Vector3(
          displayed.x,
          displayed.y + 0.7,
          displayed.z,
        );
        if (!this.settings.lock) {
          const ndc = target.clone().project(this.camera);
          if (Math.abs(ndc.x) > 0.3 || Math.abs(ndc.y) > 0.28)
            this.anchor.lerp(
              this.v.set(displayed.x, this.anchor.y, displayed.z),
              1 - Math.exp(-dt * 3),
            );
        }
        this.anchor.y +=
          (displayed.y - this.anchor.y) * (1 - Math.exp(-dt * 3));
        const distance = this.settings.distance;
        this.camera.position.set(
          this.anchor.x + distance * 0.5,
          this.anchor.y + distance * Math.SQRT1_2,
          this.anchor.z + distance * 0.5,
        );
        this.camera.lookAt(this.anchor);
        this.camera.updateMatrixWorld();
        const worker = this.instances.get(`player:${p.id}`),
          hit = new Set<T.Material>();
        const ray = new T.Raycaster(
          this.camera.position,
          target.clone().sub(this.camera.position).normalize(),
          0,
          this.camera.position.distanceTo(target) - 0.5,
        );
        const blockers = [
          ...Object.keys(w.machines),
          ...Object.keys(w.devices).map((id) => `device:${id}`),
        ]
          .map((id) => this.instances.get(id)?.visual?.root)
          .filter(Boolean) as T.Object3D[];
        for (const entry of ray.intersectObjects(
          [...blockers, this.rocket],
          true,
        )) {
          if (entry.object instanceof T.Mesh)
            for (const m of Array.isArray(entry.object.material)
              ? entry.object.material
              : [entry.object.material])
              hit.add(m);
        }
        this.fades.update(hit, now, dt, false);
        worker?.silhouette?.setVisible(hit.size > 0);
      }
    } else {
      this.camera.position.set(this.anchor.x + 16, 22.627, this.anchor.z + 16);
      this.camera.lookAt(this.anchor);
    }
    this.renderer.render(this.scene, this.camera);
    if (now - this.metricsAt > 500) {
      this.metricsAt = now;
      let playerCssHeight = 0;
      if (p) {
        const a = new T.Vector3(p.pos.x, p.pos.y, p.pos.z).project(this.camera),
          b = new T.Vector3(p.pos.x, p.pos.y + 1.8, p.pos.z).project(
            this.camera,
          );
        playerCssHeight = (Math.abs(a.y - b.y) * this.height) / 2;
      }
      const m = {
        webgl: true,
        loaded: this.loaded,
        viewport: [this.width, this.height],
        drawing: [this.canvas.width, this.canvas.height],
        camera: {
          fov: 35,
          distance: this.settings.distance,
          elevation: 45,
          azimuth: 45,
        },
        playerCssHeight,
        triangles: this.renderer.info.render.triangles,
        drawCalls: this.renderer.info.render.calls,
        frameMs: rawDt * 1000,
      };
      this.host.dataset.metrics = JSON.stringify(m);
      this.onMetrics(m);
    }
  };
  dispose() {
    this.disposed = true;
    this.fades.clear();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointer);
    this.canvas.removeEventListener("pointermove", this.hover);
    for (const key of [...this.instances.keys()]) this.remove(key);
    this.rocket.traverse((o) => o.userData.release?.());
    this.scene.traverse((o) => o.userData.dispose?.());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.renderer?.dispose();
    this.canvas.remove();
  }
}
