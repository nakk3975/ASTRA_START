import {
  movePosition,
  type World,
  type V3,
  type MoveFrame,
  type Player,
} from "../../../../packages/carry-core/src/index.ts";
const mix = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
/** Exact acknowledged-input replay. Rendering never writes authority or inventory. */
export class MotionSmoother {
  private room = "";
  private member = "";
  private epoch = -1;
  private world: World | null = null;
  private position: V3 | null = null;
  private offset: V3 = { x: 0, y: 0, z: 0 };
  private input = { x: 0, z: 0 };
  private facing = { x: 0, z: -1 };
  private sequence = 0;
  private sentSequence = 0;
  private pending: MoveFrame[] = [];
  private tailOrigin: V3 | null = null;
  private sampledAt = 0;
  private lastReceived = 0;
  private frames: { at: number; time: number; players: Record<string, V3> }[] =
    [];
  receive(w: World, member: string, now: number, _rtt = 0) {
    const p = w.players[member];
    if (!p) return;
    if (
      this.room !== w.id ||
      this.member !== member ||
      this.epoch !== p.epoch ||
      !this.position
    ) {
      this.room = w.id;
      this.member = member;
      this.epoch = p.epoch;
      this.pending = [];
      this.tailOrigin = null;
      this.sequence = p.motion?.ack ?? 0;
      this.sentSequence = this.sequence;
      this.position = { ...p.pos };
      this.offset = { x: 0, y: 0, z: 0 };
      this.frames = [];
      this.sampledAt = now;
      this.input = { x: 0, z: 0 };
      this.facing = { ...p.facing };
    } else {
      this.capture(now);
      const displayed = {
        x: this.position.x + this.offset.x,
        y: this.position.y + this.offset.y,
        z: this.position.z + this.offset.z,
      };
      const ack = p.motion?.ack ?? 0;
      this.pending = this.pending.filter((f) => f.seq > ack);
      let predicted = { ...p.pos };
      this.tailOrigin = null;
      for (const frame of this.pending) {
        this.tailOrigin = { ...predicted };
        predicted = movePosition(w, p, predicted, frame, frame.dt);
      }
      this.position = predicted;
      this.offset = {
        x: displayed.x - predicted.x,
        y: displayed.y - predicted.y,
        z: displayed.z - predicted.z,
      };
      // Large authority corrections still recover. Small residuals settle only while moving.
      if (Math.hypot(this.offset.x, this.offset.z) > 1.5)
        this.offset = { x: 0, y: 0, z: 0 };
    }
    this.world = w;
    this.lastReceived = now;
    const previous = this.frames.at(-1);
    if (!previous || w.time >= previous.time) {
      this.frames.push({
        at: now,
        time: w.time,
        players: Object.fromEntries(
          Object.values(w.players).map((q) => [q.id, { ...q.pos }]),
        ),
      });
      this.frames = this.frames.slice(-30);
    }
  }
  setInput(input: { x: number; z: number }, now: number) {
    this.capture(now);
    this.input = { ...input };
    const length = Math.hypot(input.x, input.z);
    if (length > 0) this.facing = { x: input.x / length, z: input.z / length };
  }
  /** Display-only player for prompts/placement. Never send its position to authority. */
  player(w: World, member: string): Player {
    const p = w.players[member];
    if (
      !this.position ||
      this.room !== w.id ||
      this.member !== member ||
      this.epoch !== p.epoch
    )
      return p;
    return {
      ...p,
      pos: {
        x: this.position.x + this.offset.x,
        y: this.position.y + this.offset.y,
        z: this.position.z + this.offset.z,
      },
      facing: { ...this.facing },
    };
  }
  checkpoint(now: number) {
    this.capture(now);
    // Seal the final interval: movement after the action belongs to a new seq.
    this.sentSequence = this.sequence;
    return this.sequence;
  }
  private capture(now: number) {
    const elapsed = Math.max(0, Math.min(0.12, (now - this.sampledAt) / 1000));
    this.sampledAt = now;
    const w = this.world,
      p = w?.players[this.member];
    if (
      !w ||
      !p ||
      !this.position ||
      w.phase === "LAUNCHED" ||
      now - this.lastReceived > 1500 ||
      (!this.input.x && !this.input.z)
    )
      return;
    let dt = elapsed;
    while (dt > 1e-6) {
      // Pack render samples into at most 50 ms intervals. Once a sequence has
      // been sent, its duration and direction must never change on retries.
      // Otherwise high-refresh displays exhaust the bounded network queue.
      const tail = this.pending.at(-1);
      const append =
        tail &&
        tail.seq > this.sentSequence &&
        tail.x === this.input.x &&
        tail.z === this.input.z &&
        tail.dt < 0.05 - 1e-6;
      if (!append && this.pending.length >= 90) break;
      const part = Math.min(append ? 0.05 - tail.dt : 0.05, dt);
      if (append && this.tailOrigin) {
        tail.dt += part;
        // Re-integrate the complete unsent interval, exactly as authority will.
        // Integrating each render sample separately gives different wall slides.
        this.position = movePosition(w, p, this.tailOrigin, tail, tail.dt);
      } else {
        this.tailOrigin = { ...this.position };
        this.pending.push({ seq: ++this.sequence, dt: part, ...this.input });
        this.position = movePosition(w, p, this.position, this.input, part);
      }
      dt -= part;
    }
  }
  packet(now: number, through = Infinity) {
    this.capture(now);
    const frames = this.pending
      .filter((f) => f.seq <= through)
      .slice(0, 40)
      .map((f) => ({ ...f }));
    this.sentSequence = Math.max(this.sentSequence, frames.at(-1)?.seq ?? 0);
    return frames;
  }
  step(
    w: World,
    member: string,
    input: { x: number; z: number },
    dt: number,
    now: number,
  ): V3 {
    if (!this.position || this.room !== w.id) this.receive(w, member, now);
    this.setInput(input, now);
    if (input.x || input.z) {
      const k = Math.exp(-Math.min(0.05, dt) * 12);
      this.offset = {
        x: this.offset.x * k,
        y: this.offset.y * k,
        z: this.offset.z * k,
      };
    }
    return {
      x: this.position!.x + this.offset.x,
      y: this.position!.y + this.offset.y,
      z: this.position!.z + this.offset.z,
    };
  }
  remote(w: World, id: string, now: number): V3 {
    const latest = this.frames.at(-1);
    if (!latest) return w.players[id].pos;
    const previous = this.frames.at(-2),
      delay = Math.max(
        0.12,
        Math.min(0.35, previous ? (latest.time - previous.time) * 1.2 : 0.12),
      );
    const target =
      latest.time + Math.min(0.35, (now - latest.at) / 1000) - delay;
    const a = [...this.frames].reverse().find((f) => f.time <= target),
      b = this.frames.find((f) => f.time >= target);
    if (a?.players[id] && b?.players[id])
      return mix(
        a.players[id],
        b.players[id],
        Math.max(
          0,
          Math.min(1, (target - a.time) / Math.max(0.00001, b.time - a.time)),
        ),
      );
    return { ...(a?.players[id] ?? b?.players[id] ?? w.players[id].pos) };
  }
}
