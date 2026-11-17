import { MotionSmoother } from "./motion";
import { Client, type Room } from "@colyseus/sdk";
import type {
  World,
  Command,
  Receipt,
} from "../../../../packages/carry-core/src/index.ts";
export type Session = {
  roomId: string;
  code: string;
  member: string;
  token: string;
};
export class CarryConnection {
  world: World | null = null;
  session: Session | null = null;
  room: Room | null = null;
  revision = -1;
  seq = 0;
  epoch = 0;
  transport = "http";
  input = { x: 0, z: 0 };
  movement = new MotionSmoother();
  control = 0;
  inFlight = 0;
  urgent = false;
  setInput(input: { x: number; z: number }) {
    const changed = input.x !== this.input.x || input.z !== this.input.z;
    this.movement.setInput(input, performance.now());
    this.input = { ...input };
    if (changed) {
      this.control++;
      this.urgent = true;
      void this.sync(true);
    }
  }
  rtt = 0;
  onWorld = (w: World, rtt: number) => {};
  onStatus = (s: string) => {};
  onAck = (r: Receipt) => {};
  timer?: ReturnType<typeof setInterval>;
  pending = new Map<string, Command>();
  private actionBarriers = new Map<
    string,
    { seq: number; input: { x: number; z: number } }
  >();
  busy = false;
  stopped = true;
  generation = 0;
  private retryAt = 0;
  private failures = 0;
  async api(action: string, data: any) {
    const r = await fetch(`/api/carry/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.headers.get("content-type")?.includes("application/json"))
      throw Error(
        "게임 서버에 연결되지 않았습니다. 검수 전용 주소가 아닌 게임 주소를 열어 주세요.",
      );
    const v = await r.json();
    if (!r.ok)
      throw Object.assign(Error(v.error ?? "서버 오류"), { status: r.status });
    return v;
  }
  auth() {
    const s = this.session!;
    return { id: s.roomId, member: s.member, token: s.token };
  }
  accept(r: any) {
    if (r.world && r.revision >= this.revision) {
      this.world = r.world;
      this.revision = r.revision;
      const epoch = this.world!.players[this.session!.member].epoch;
      if (this.epoch !== epoch) this.actionBarriers.clear();
      this.epoch = epoch;
      this.seq = Math.max(
        this.seq,
        this.world!.players[this.session!.member].lastSeq,
      );
      this.movement.receive(
        this.world!,
        this.session!.member,
        performance.now(),
        this.rtt,
      );
      this.onWorld(this.world!, this.rtt);
    }
    if (r.result?.id) {
      this.pending.delete(r.result.id);
      this.actionBarriers.delete(r.result.id);
      this.persistOutbox();
      this.onAck(r.result);
    }
  }
  persistOutbox() {
    try {
      sessionStorage.setItem(
        "carry:outbox",
        JSON.stringify({
          roomId: this.session?.roomId,
          commands: [...this.pending.values()],
        }),
      );
    } catch {}
  }
  async start(
    mode: "create" | "join",
    name: string,
    code: string,
    planned: number,
    profile = "campaign",
    avatar = "worker",
  ) {
    await this.stop();
    const r = await this.api(
      mode,
      mode === "create"
        ? { name, planned, profile, avatar }
        : { name, code, avatar },
    );
    this.session = {
      roomId: r.roomId,
      code: r.code,
      member: r.member,
      token: r.token,
    };
    localStorage.setItem("carry:session", JSON.stringify(this.session));
    this.transport = r.transport;
    this.accept(r);
    await this.connect();
  }
  async resume() {
    const raw = localStorage.getItem("carry:session");
    if (!raw) throw Error("이 브라우저에 이어할 작업장이 없습니다.");
    this.stopped = true;
    this.generation++;
    clearInterval(this.timer);
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
    this.revision = -1;
    this.session = JSON.parse(raw);
    const r = await this.api("resume", this.auth());
    this.transport = r.transport;
    this.accept(r);
    await this.connect();
  }
  async connect() {
    this.retryAt = 0;
    this.failures = 0;
    this.stopped = false;
    const generation = ++this.generation;
    try {
      const out = JSON.parse(sessionStorage.getItem("carry:outbox") ?? "null");
      if (out?.roomId === this.session?.roomId)
        for (const c of out.commands ?? []) {
          this.pending.set(c.id, c);
          this.seq = Math.max(this.seq, c.seq);
        }
    } catch {}
    if (this.transport === "colyseus") {
      const r = await this.api("runtime", this.auth());
      const room = await new Client(
        location.origin.replace(/^http/, "ws"),
      ).joinById(r.runtimeRoomId, {
        member: this.session!.member,
        token: this.session!.token,
      });
      if (generation !== this.generation) {
        await room.leave();
        return;
      }
      this.room = room;
      room.onMessage("WELCOME", (r) => this.accept(r));
      room.onMessage("WORLD", (r) => this.accept(r));
      room.onMessage("ACK", (r) => this.accept(r));
      room.onMessage("ERROR", (r) => this.onStatus(r.message));
      room.onMessage("STORAGE_ERROR", () =>
        this.onStatus("저장 응답을 기다리고 있습니다."),
      );
      room.onLeave(() => {
        if (generation === this.generation && !this.stopped) {
          this.input = { x: 0, z: 0 };
          this.onStatus("연결이 끊어졌습니다. 이어하기로 재접속해 주세요.");
          this.stopped = true;
          clearInterval(this.timer);
        }
      });
    }
    this.schedule();
    this.onStatus("연결됨");
    await this.sync();
  }
  schedule() {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.sync(), 80);
  }
  async sync(expedited = false) {
    if (
      this.stopped ||
      !this.session ||
      performance.now() < this.retryAt ||
      this.inFlight >= (expedited ? 2 : 1)
    )
      return;
    this.inFlight++;
    this.busy = true;
    this.urgent = false;
    const generation = this.generation,
      control = this.control,
      cmd = this.pending.values().next().value,
      barrier = cmd && this.actionBarriers.get(cmd.id);
    const input = {
      ...(barrier?.input ?? this.input),
      control,
      epoch: this.epoch,
      frames: this.movement.packet(performance.now(), barrier?.seq),
      ...(barrier ? { actionAfter: barrier.seq } : {}),
    };
    try {
      if (this.room) {
        this.room.send("INPUT", input);
        if (cmd) this.room.send("COMMAND", cmd);
      } else {
        const at = performance.now(),
          response = await this.api("sync", {
            ...this.auth(),
            input,
            command: cmd,
          });
        if (generation === this.generation && !this.stopped) {
          this.rtt = performance.now() - at;
          this.failures = 0;
          this.retryAt = 0;
          this.accept(response);
        }
      }
    } catch (e) {
      if (generation === this.generation) {
        const error = e as Error & { status?: number };
        if (
          error.status &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ) {
          this.stopped = true;
          clearInterval(this.timer);
          this.input = { x: 0, z: 0 };
          this.movement.setInput(this.input, performance.now());
          this.onStatus(
            `${error.message} 아래 ‘작업장 다시 연결’을 눌러 주세요.`,
          );
        } else {
          this.retryAt =
            performance.now() +
            Math.min(15000, 1000 * 2 ** Math.min(4, this.failures++));
          this.onStatus(
            "연결 응답이 늦어 재시도 중입니다. 저장된 작업장은 유지됩니다.",
          );
        }
      }
    } finally {
      this.inFlight--;
      this.busy = this.inFlight > 0;
      if (
        generation === this.generation &&
        !this.stopped &&
        (this.urgent || control < this.control)
      )
        queueMicrotask(() => void this.sync(true));
    }
  }
  command(type: Command["type"], extra: Partial<Command> = {}) {
    if (this.stopped) return;
    if (this.pending.size >= 8) {
      this.onStatus("이전 행동의 응답을 기다려 주세요.");
      return;
    }
    const c = { ...extra, id: crypto.randomUUID(), seq: ++this.seq, type };
    this.actionBarriers.set(c.id, {
      seq: this.movement.checkpoint(performance.now()),
      input: { ...this.input },
    });
    this.pending.set(c.id, c);
    this.persistOutbox();
    this.urgent = true;
    void this.sync(true);
  }
  async stop() {
    this.stopped = true;
    this.generation++;
    clearInterval(this.timer);
    this.input = { x: 0, z: 0 };
    if (this.room) {
      await this.room.leave();
      this.room = null;
    } else if (this.session)
      await this.api("leave", { ...this.auth(), epoch: this.epoch }).catch(
        () => {},
      );
    this.pending.clear();
    this.actionBarriers.clear();
    this.persistOutbox();
    this.world = null;
    this.revision = -1;
    this.seq = 0;
  }
}
