import type {
  Receipt,
  World,
} from "../../../../packages/carry-core/src/index.ts";
export type Cue =
  | "pickup"
  | "drop"
  | "throw"
  | "input"
  | "mine"
  | "process"
  | "complete"
  | "install"
  | "reward"
  | "upgrade"
  | "ping"
  | "launch"
  | "error"
  | "step"
  | "click";
export function receiptCue(r: Receipt): Cue | null {
  if (!r.ok) return "error";
  const s = r.message;
  if (s.includes("발사!") || s === "직접 설치 완료") return null; // Authoritative world events own these sounds.
  if (s.includes("던")) return "throw";
  if (s.includes("내려") || s.includes("놓기")) return "drop";
  if (s.includes("들기")) return "pickup";
  if (s.includes("투입")) return "input";
  if (s.includes("채굴")) return "mine";
  if (s.includes("설치 완료")) return "install";
  if (/해금|업그레이드|개선/.test(s)) return "upgrade";
  if (s.includes("핑")) return "ping";
  return "click";
}
export class CarryAudio {
  enabled = true;
  volume = 0.45;
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private last = new Map<string, number>();
  private receipts = new Set<string>();
  private events = new Set<string>();
  private worldId = "";
  private phase = "";
  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
      }
      this.master.gain.value = this.volume;
      await this.context.resume();
    } catch {
      /* Audio must never interrupt gameplay. */
    }
  }
  configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        enabled ? this.volume : 0,
        this.context.currentTime,
        0.02,
      );
  }
  play(cue: Cue) {
    const a = this.context,
      master = this.master;
    if (
      !this.enabled ||
      !a ||
      !master ||
      a.state !== "running" ||
      document.hidden
    )
      return;
    const now = a.currentTime,
      gap =
        cue === "step"
          ? 0.32
          : cue === "mine"
            ? 0.22
            : cue === "process"
              ? 0.8
              : 0.07;
    if (now - (this.last.get(cue) ?? -10) < gap) return;
    this.last.set(cue, now);
    const tone = (
      frequency: number,
      duration: number,
      delay = 0,
      type: OscillatorType = "sine",
      gain = 0.13,
      end = frequency,
    ) => {
      const o = a.createOscillator(),
        g = a.createGain(),
        t = now + delay;
      o.type = type;
      o.frequency.setValueAtTime(frequency, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + duration + 0.01);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    };
    const noise = (duration: number, gain: number, frequency: number) => {
      if (!this.noise) {
        this.noise = a.createBuffer(1, a.sampleRate, a.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
      }
      const n = a.createBufferSource(),
        f = a.createBiquadFilter(),
        g = a.createGain();
      n.buffer = this.noise;
      f.type = "lowpass";
      f.frequency.value = frequency;
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start();
      n.stop(now + duration);
      n.onended = () => {
        n.disconnect();
        f.disconnect();
        g.disconnect();
      };
    };
    switch (cue) {
      case "step":
        noise(0.06, 0.08, 500);
        break;
      case "mine":
        noise(0.12, 0.18, 2200);
        tone(920, 0.1, 0, "triangle", 0.09, 240);
        break;
      case "process":
        tone(110, 0.16, 0, "triangle", 0.055, 70);
        noise(0.1, 0.04, 1000);
        break;
      case "pickup":
        tone(350, 0.1, 0, "sine", 0.1, 650);
        break;
      case "drop":
        noise(0.12, 0.12, 900);
        tone(150, 0.1, 0, "triangle", 0.1, 65);
        break;
      case "throw":
        noise(0.2, 0.08, 3000);
        tone(450, 0.16, 0, "sine", 0.06, 180);
        break;
      case "input":
        tone(260, 0.09, 0, "triangle");
        tone(390, 0.12, 0.07, "triangle");
        break;
      case "complete":
        [523, 659, 784].forEach((f, i) => tone(f, 0.2, i * 0.09));
        break;
      case "install":
        noise(0.18, 0.2, 1600);
        tone(190, 0.18, 0, "triangle");
        tone(380, 0.16, 0.12);
        break;
      case "reward":
        tone(1046, 0.15);
        tone(1318, 0.25, 0.09);
        break;
      case "upgrade":
        [392, 523, 659, 1046].forEach((f, i) => tone(f, 0.24, i * 0.09));
        break;
      case "ping":
        tone(880, 0.3);
        break;
      case "launch":
        noise(0.9, 0.25, 700);
        [262, 330, 392, 523].forEach((f, i) => tone(f, 0.6, i * 0.15));
        break;
      case "error":
        tone(180, 0.13, 0, "triangle");
        tone(130, 0.18, 0.13, "triangle");
        break;
      default:
        tone(540, 0.055, 0, "sine", 0.065);
    }
  }
  ack(r: Receipt) {
    if (this.receipts.has(r.id)) return;
    this.receipts.add(r.id);
    if (this.receipts.size > 256)
      this.receipts.delete(this.receipts.values().next().value!);
    const cue = receiptCue(r);
    if (cue) this.play(cue);
  }
  observe(w: World, member: string) {
    const key = (e: World["events"][number]) =>
      `${e.time}:${e.item ?? ""}:${e.text}`;
    if (this.worldId !== w.id) {
      this.worldId = w.id;
      this.events = new Set(w.events.map(key));
      this.phase = w.phase;
      return;
    }
    const p = w.players[member];
    for (const e of w.events) {
      const k = key(e);
      if (this.events.has(k)) continue;
      this.events.add(k);
      if (e.text.includes("설치 +")) {
        this.play("install");
        this.play("reward");
      } else if (e.text.includes("가공 +")) {
        const i = e.item ? w.items[e.item] : null;
        if (!p || !i || Math.hypot(p.pos.x - i.pos.x, p.pos.z - i.pos.z) < 12)
          this.play("complete");
      }
    }
    if (this.events.size > 300) this.events = new Set(w.events.map(key));
    if (p?.mining) this.play("mine");
    if (
      p &&
      Object.values(w.machines).some(
        (m) =>
          m.job &&
          m.job.remaining > 0 &&
          Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 8,
      )
    )
      this.play("process");
    if (w.phase === "LAUNCHED" && this.phase !== "LAUNCHED")
      this.play("launch");
    this.phase = w.phase;
  }
  dispose() {
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.master = undefined;
  }
}
