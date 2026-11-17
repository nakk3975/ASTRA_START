import {
  movePosition,
  CFG,
  type World,
  type V3,
} from "../../../../packages/carry-core/src/index.ts";
const mix = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
/** Local prediction never changes the authoritative world or inventory. */
export class MotionSmoother {
  private room = "";
  private member = "";
  private position: V3 | null = null;
  private correction = { x: 0, y: 0, z: 0 };
  private history: { at: number; pos: V3 }[] = [];
  private frames: { at: number; time: number; players: Record<string, V3> }[] =
    [];
  private lastWorldTime = -1;
  private lastReceived = 0;
  receive(w: World, member: string, now: number, rtt = 0) {
    const p = w.players[member];
    if (!p) return;
    if (this.room !== w.id || this.member !== member || !this.position) {
      this.room = w.id;
      this.member = member;
      this.position = { ...p.pos };
      this.history = [];
      this.frames = [];
      this.correction = { x: 0, y: 0, z: 0 };
      this.lastWorldTime = -1;
    }
    if (w.time < this.lastWorldTime) return;
    this.lastWorldTime = w.time;
    this.lastReceived = now;
    this.frames.push({
      at: now,
      time: w.time,
      players: Object.fromEntries(
        Object.values(w.players).map((q) => [q.id, { ...q.pos }]),
      ),
    });
    this.frames = this.frames.slice(-30);
    const when = now - Math.min(300, Math.max(0, rtt / 2));
    const earlier = this.history.filter((h) => h.at <= when).at(-1),
      later = this.history.find((h) => h.at >= when);
    const predicted =
      earlier && later
        ? mix(
            earlier.pos,
            later.pos,
            (when - earlier.at) / Math.max(1, later.at - earlier.at),
          )
        : (earlier?.pos ?? later?.pos ?? this.position!);
    const error = {
      x: p.pos.x - predicted.x,
      y: p.pos.y - predicted.y,
      z: p.pos.z - predicted.z,
    };
    if (Math.hypot(error.x, error.z) > 3) {
      this.position = { ...p.pos };
      this.history = [];
      this.correction = { x: 0, y: 0, z: 0 };
    } else this.correction = error;
  }
  step(
    w: World,
    member: string,
    input: { x: number; z: number },
    dt: number,
    now: number,
  ): V3 {
    const p = w.players[member];
    if (!p) return { x: 0, y: 0, z: 0 };
    if (!this.position || this.room !== w.id) this.receive(w, member, now);
    // Bound stale prediction during outages; stop immediately when input clears.
    const active =
      now - this.lastReceived < 900 && w.phase !== "LAUNCHED"
        ? input
        : { x: 0, z: 0 };
    this.position = movePosition(
      w,
      p,
      this.position!,
      active,
      Math.min(0.05, dt),
    );
    const alpha = 1 - Math.exp(-dt * 9),
      correction = {
        x: this.correction.x * alpha,
        y: this.correction.y * alpha,
        z: this.correction.z * alpha,
      };
    this.position = {
      x: this.position.x + correction.x,
      y: this.position.y + correction.y,
      z: this.position.z + correction.z,
    };
    this.correction = {
      x: this.correction.x - correction.x,
      y: this.correction.y - correction.y,
      z: this.correction.z - correction.z,
    };
    this.history.push({ at: now, pos: { ...this.position } });
    this.history = this.history.filter((h) => now - h.at < 1200);
    return { ...this.position };
  }
  remote(w: World, id: string, now: number): V3 {
    const latest = this.frames.at(-1);
    if (!latest) return w.players[id].pos;
    const prior = this.frames.at(-2);
    const delay = Math.max(
      0.14,
      Math.min(0.6, prior ? (latest.time - prior.time) * 1.2 : 0.14),
    );
    const time = latest.time + Math.min(0.6, (now - latest.at) / 1000) - delay;
    const a = [...this.frames].reverse().find((f) => f.time <= time),
      b = this.frames.find((f) => f.time >= time);
    if (a?.players[id] && b?.players[id])
      return mix(
        a.players[id],
        b.players[id],
        Math.max(
          0,
          Math.min(1, (time - a.time) / Math.max(0.00001, b.time - a.time)),
        ),
      );
    return { ...(a?.players[id] ?? b?.players[id] ?? w.players[id].pos) };
  }
}
