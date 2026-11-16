import { B, M, UNIT } from "../../../packages/content/src/index.ts";
import { geometry, type World } from "../../../packages/game-core/src/index.ts";
// Same authoritative world and inputs as the WebGL renderer. No separate simulation.
export function canvasWorld(host: HTMLElement, latest: { current: any }) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "작업장 2D 호환 월드");
  host.append(canvas);
  const ctx = canvas.getContext("2d")!;
  let width = 0,
    height = 0,
    frame = 0,
    zoom = 22,
    tx = 24,
    tz = 16,
    scale = 16,
    stopped = false;
  let targets: { id: string; x: number; y: number; r: number }[] = [];
  const project = (x: number, z: number, h = 0) => ({
    x: width / 2 + (x - tx - (z - tz) * 0.42) * scale,
    y: height / 2 + (z - tz) * scale * 0.68 - h * scale,
  });
  function poly(
    points: { x: number; y: number }[],
    color: string,
    stroke?: string,
  ) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function slab(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: string,
  ) {
    const a = project(x, z, h),
      b = project(x + w, z, h),
      c = project(x + w, z + d, h),
      f = project(x, z + d, h);
    poly([f, c, project(x + w, z + d), project(x, z + d)], "#879c8e");
    poly([b, c, project(x + w, z + d), project(x + w, z)], "#687d73");
    poly([a, b, c, f], color, "#859989");
  }
  let labels: { text: string; x: number; z: number; h: number }[] = [];
  function label(text: string, x: number, z: number, h = 1) {
    labels.push({ text, x, z, h });
  }
  function drawLabel(text: string, x: number, z: number, h = 1) {
    const p = project(x, z, h);
    ctx.font =
      "600 " + Math.max(11, Math.min(16, scale * 0.67)) + "px sans-serif";
    ctx.textAlign = "center";
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(253,250,235,.94)";
    ctx.beginPath();
    ctx.roundRect(p.x - tw / 2 - 7, p.y - 17, tw + 14, 23, 6);
    ctx.fill();
    ctx.fillStyle = "#304b49";
    ctx.fillText(text, p.x, p.y);
  }
  function target(id: string, x: number, z: number, h = 0, r = 1.3) {
    const p = project(x, z, h);
    targets.push({ id, x: p.x, y: p.y, r: r * scale });
    if (latest.current.selected === id) {
      ctx.strokeStyle = "#ed8448";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y + scale * 0.4,
        scale * r,
        scale * r * 0.48,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  const names: any = {
    manual_workbench: "수동 작업대",
    shared_warehouse: "공용 창고",
    starter_generator: "기본 발전기",
    recovery_vault: "비상 회수함",
  };
  function facility(g: any, type: string) {
    const { x, z } = g.top_left,
      { width: w, depth: d } = g.footprint;
    const color =
      type === "manual_workbench"
        ? "#cba36d"
        : type === "shared_warehouse"
          ? "#dfbd72"
          : type === "solar_array"
            ? "#4f8293"
            : type === "extractor"
              ? "#cc9d67"
              : "#9ab4ae";
    slab(x, z, w, d, 1, color);
    slab(
      x + 0.3,
      z + 0.3,
      w - 0.6,
      d - 0.6,
      1.4,
      type === "solar_array" ? "#42718e" : "#e7d9b5",
    );
    const c = g.delivery_distance_anchor;
    label(
      names[type] ?? (B.machines as any)[type]?.name_ko ?? type,
      c.x,
      c.z,
      2,
    );
    target(g.id, c.x, c.z, 1, 1.7);
    for (const s of g.service_points) {
      const p = project(s.interaction_anchor.x, s.interaction_anchor.z);
      ctx.fillStyle = "#fcf2ce";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, scale * 0.2, scale * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function render() {
    if (stopped) return;
    frame = requestAnimationFrame(render);
    const props = latest.current,
      w = props.world as World | null,
      me = w?.members[props.member];
    const cx = props.overview || !me ? 24 : me.position.x / UNIT,
      cz = props.overview || !me ? 16 : me.position.z / UNIT;
    tx += (cx - tx) * 0.08;
    tz += (cz - tz) * 0.08;
    scale = height / (props.overview ? 29 : zoom);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#bccbb5";
    ctx.fillRect(0, 0, width, height);
    targets = [];
    labels = [];
    slab(0, 0, 48, 32, 0, "#c4c7a9");
    for (const a of M.factory_regions)
      slab(
        a.x_min,
        a.z_min,
        a.x_max - a.x_min + 1,
        a.z_max - a.z_min + 1,
        0,
        "#b3bdad",
      );
    for (const a of M.protected_walkways)
      slab(
        a.x_min,
        a.z_min,
        a.x_max - a.x_min + 1,
        a.z_max - a.z_min + 1,
        0,
        "#dfddc5",
      );
    ctx.strokeStyle = "rgba(93,120,95,.15)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= 48; x++) {
      const a = project(x, 0),
        b = project(x, 32);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let z = 0; z <= 32; z++) {
      const a = project(0, z),
        b = project(48, z);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const src of M.source_zones) {
      const x = (src.x_min + src.x_max + 1) / 2,
        z = (src.z_min + src.z_max + 1) / 2;
      slab(
        src.x_min,
        src.z_min,
        src.x_max - src.x_min + 1,
        src.z_max - src.z_min + 1,
        0.15,
        "#b4a38c",
      );
      for (let i = 0; i < 9; i++)
        slab(
          src.x_min + 0.5 + (i % 3) * 1.1,
          src.z_min + 0.5 + Math.floor(i / 3) * 1.1,
          0.7,
          0.7,
          0.3 + (i % 3) * 0.15,
          ["#a68f78", "#c6ae6b", "#95b3a6", "#a79ac0"][
            M.source_zones.indexOf(src)
          ],
        );
      label(src.name_ko, x, z, 2);
      target(src.id, x, z, 0, 2.7);
      for (const s of src.manual_service_points) {
        const p = project(s.cell.x + 0.5, s.cell.z + 0.5);
        ctx.fillStyle = "#fff0ba";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, scale * 0.25, scale * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const pad of src.extractor_pads)
        slab(pad.top_left.x, pad.top_left.z, 2, 2, 0.02, "#d7cda8");
    }
    const facilities = [
      ...M.starter_entities,
      ...Object.values(w?.machines ?? {})
        .filter((m) => m.type !== "channel")
        .map((m) => ({ ...m.geometry, kind: m.type })),
    ].sort((a, b) => a.top_left.z - b.top_left.z);
    for (const f of facilities) facility(f, f.kind);
    const r = M.rocket_envelope,
      rc = r.delivery_distance_anchor;
    slab(
      r.top_left.x,
      r.top_left.z,
      r.footprint.width,
      r.footprint.depth,
      0.15,
      "#9ea99b",
    );
    const stage = w?.stage ?? 0;
    if (stage > 0) slab(rc.x - 1.6, rc.z - 1.6, 3.2, 3.2, 0.5, "#e5dfca");
    if (stage > 1) {
      slab(rc.x - 2, rc.z + 1, 0.25, 0.25, 5, "#ae9775");
      slab(rc.x + 1.75, rc.z + 1, 0.25, 0.25, 5, "#ae9775");
    }
    if (stage > 2) {
      const p = project(rc.x, rc.z, 1);
      ctx.fillStyle = "#f6edd2";
      ctx.beginPath();
      ctx.roundRect(
        p.x - scale * 0.65,
        p.y - scale * 4,
        scale * 1.3,
        scale * 4,
        scale * 0.55,
      );
      ctx.fill();
      if (stage > 3) {
        ctx.fillStyle = "#df9263";
        ctx.fillRect(
          p.x - scale * 0.65,
          p.y - scale * 1.2,
          scale * 1.3,
          scale * 0.35,
        );
      }
      if (stage > 4) {
        ctx.fillStyle = "#67969c";
        ctx.beginPath();
        ctx.arc(p.x, p.y - scale * 3, scale * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (w?.phase === "LAUNCHED") {
        poly(
          [
            { x: p.x - scale * 0.35, y: p.y },
            {
              x: p.x,
              y: p.y + scale * (1.5 + Math.sin(Date.now() / 130) * 0.2),
            },
            { x: p.x + scale * 0.35, y: p.y },
          ],
          "#efbd70",
        );
      }
    }
    label(
      stage >= 6 ? "발사 준비 완료" : "로켓 조립 구역",
      rc.x,
      rc.z,
      stage > 2 ? 6 : 2,
    );
    target("rocket", rc.x, rc.z, 1, 3);
    if (w) {
      for (const [id, pos] of Object.entries(w.crates)) {
        slab(pos.x + 0.1, pos.z + 0.1, 0.8, 0.8, 0.7, "#c8a472");
        target(id, pos.x + 0.5, pos.z + 0.5, 0.5, 0.8);
      }
      for (const l of Object.values(w.links)) {
        const a = geometry(w, l.from).delivery_distance_anchor,
          b = geometry(w, l.to).delivery_distance_anchor,
          pa = project(a.x, a.z, 2.4),
          pb = project(b.x, b.z, 2.4);
        ctx.strokeStyle = "#559d95";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const c of Object.values(w.cargo)) {
        const a = geometry(w, c.from).delivery_distance_anchor,
          b = geometry(w, c.to).delivery_distance_anchor,
          t = Math.min(
            1,
            (Number(w.tick) - Number(c.departed)) /
              (Number(c.arrival) - Number(c.departed)),
          );
        slab(
          a.x + (b.x - a.x) * t - 0.2,
          a.z + (b.z - a.z) * t - 0.2,
          0.4,
          0.4,
          2.5,
          "#f5cd78",
        );
      }
      for (const [i, m] of Object.values(w.members).entries()) {
        if (!m.connected) continue;
        const x = m.position.x / UNIT,
          z = m.position.z / UNIT,
          p = project(x, z);
        ctx.fillStyle = "rgba(55,77,60,.2)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, scale * 0.4, scale * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = [
          "#e88a59",
          "#60a9bf",
          "#ad8cc4",
          "#88ac63",
          "#c5a459",
          "#d38aa3",
        ][i % 6];
        ctx.fillRect(
          p.x - scale * 0.24,
          p.y - scale * 0.8,
          scale * 0.48,
          scale * 0.65,
        );
        ctx.fillStyle = "#f3cf9b";
        ctx.beginPath();
        ctx.arc(p.x, p.y - scale, scale * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#edc45d";
        ctx.fillRect(
          p.x - scale * 0.3,
          p.y - scale * 1.25,
          scale * 0.6,
          scale * 0.17,
        );
        if (m.work) {
          ctx.fillStyle = "#ed8850";
          ctx.fillRect(
            p.x + scale * 0.28,
            p.y - scale * 0.6,
            scale * 0.3,
            scale * 0.12,
          );
        }
        label(i + 1 + " " + m.name, x, z, 1.6);
        target("bag:" + m.id, x, z, 0.7, 0.65);
      }
    }
    if (props.ghost) {
      const g = props.ghost;
      ctx.globalAlpha = 0.6;
      slab(g.x, g.z, 2, 2, 0.8, "#f2b76b");
      ctx.globalAlpha = 1;
    }
    for (const l of labels) drawLabel(l.text, l.x, l.z, l.h);
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = "#536a59";
    ctx.fillText("2D 호환 렌더러", width - 12, height - 12);
  }
  const resize = () => {
    width = host.clientWidth;
    height = host.clientHeight;
    const dpr = Math.min(devicePixelRatio, 1.5);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const click = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (latest.current.ghost) {
      const z = (y - height / 2) / (scale * 0.68) + tz;
      latest.current.onGround({
        x: Math.floor((x - width / 2) / scale + tx + (z - tz) * 0.42),
        z: Math.floor(z),
      });
      return;
    }
    const hits = targets
      .filter((t) => Math.hypot(x - t.x, y - t.y) < t.r)
      .sort(
        (a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y),
      );
    if (hits[0]) latest.current.onSelect(hits[0].id);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = Math.max(12, Math.min(40, zoom + e.deltaY * 0.01));
  };
  canvas.addEventListener("pointerup", click);
  canvas.addEventListener("wheel", wheel, { passive: false });
  render();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.remove();
  };
}
