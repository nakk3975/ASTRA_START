import {
  ITEM,
  recipe,
  machineSpeed,
  miningSeconds,
  railSeconds,
  type World,
  type V3,
} from "../../../../packages/carry-core/src/index.ts";

export type WorkProgress = {
  id: string;
  label: string;
  pos: V3;
  ratio: number;
  remaining: number;
  status: "working" | "ready" | "blocked";
};
export function workProgress(w: World, elapsed = 0): WorkProgress[] {
  const rows: WorkProgress[] = [];
  const predict = (remaining: number) =>
    remaining > 0
      ? Math.max(0.05, remaining - Math.min(0.25, Math.max(0, elapsed)))
      : 0;
  for (const p of Object.values(w.players)) {
    if (!p.connected || !p.mining) continue;
    const total = miningSeconds(w, p.mining.kind),
      remaining = predict(p.mining.remaining);
    rows.push({
      id: `mining:${p.id}`,
      label: `${ITEM[p.mining.kind].name} 채굴`,
      pos: { ...p.pos, y: p.pos.y + 2.65 },
      ratio: Math.max(0, Math.min(0.98, 1 - remaining / total)),
      remaining,
      status: "working",
    });
  }
  for (const m of Object.values(w.machines)) {
    const r = recipe(w, m.job?.recipe ?? m.recipe),
      speed = w.profile === "lab" ? 1 : machineSpeed(w, m);
    if (m.job && r) {
      const remaining = predict(m.job.remaining / speed);
      rows.push({
        id: m.id,
        label: `${r.name} 가공`,
        pos: { ...m.pos, y: m.pos.y + 2.7 },
        ratio: Math.max(0, Math.min(1, 1 - remaining / (r.seconds / speed))),
        remaining,
        status: m.job.remaining <= 0 ? "blocked" : "working",
      });
    } else {
      const output = m.output
        .map((id) => w.items[id])
        .filter((i) => i?.state === "output");
      if (output.length)
        rows.push({
          id: m.id,
          label: `${ITEM[output[0].kind].name} ${output.length}개`,
          pos: { ...m.pos, y: m.pos.y + 2.7 },
          ratio: 1,
          remaining: 0,
          status: "ready",
        });
    }
  }
  for (const d of Object.values(w.devices)) {
    if (d.progress <= 0 || d.type === "tray") continue;
    const total =
      d.type === "miner"
        ? miningSeconds(w, d.source ?? "metal_scrap", true)
        : d.type === "installer"
          ? 2
          : d.type === "crane"
            ? 2.8
            : railSeconds(w);
    rows.push({
      id: d.id,
      label:
        d.type === "miner"
          ? "자동 채굴"
          : d.type === "installer"
            ? "자동 설치"
            : "운반",
      pos: { ...d.pos, y: d.pos.y + 2.3 },
      ratio: Math.min(1, d.progress),
      remaining: Math.max(0, (1 - d.progress) * total),
      status: "working",
    });
  }
  return rows;
}
export const progressText = (p: WorkProgress) =>
  p.status === "blocked"
    ? "완료 · 출력 공간을 비워 주세요"
    : p.status === "ready"
      ? "완료 · 청록 받침대에서 E"
      : `${Math.round(p.ratio * 100)}% · ${p.remaining.toFixed(1)}초 남음`;
