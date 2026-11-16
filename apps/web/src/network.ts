import { Client, type Room } from "@colyseus/sdk";
import { R } from "../../../packages/content/src/index.ts";
import type { World } from "../../../packages/game-core/src/index.ts";
import type { Ack, Command } from "../../../packages/protocol/src/index.ts";
export class Connection {
  csrf = "";
  room: Room | null = null;
  world: World | null = null;
  member = "";
  epoch = 0;
  seq = 0;
  roomId = "";
  code = "";
  guest: any = null;
  closed = false;
  connected = false;
  onWorld: (w: World) => void = () => {};
  onStatus: (s: string) => void = () => {};
  onError: (s: string) => void = () => {};
  onSecret: (s: string) => void = () => {};
  pending = new Map<
    string,
    {
      command: Command;
      resolve: (a: Ack) => void;
      reject: (e: Error) => void;
      at: number;
    }
  >();
  hold: string | null = null;
  reconnecting = false;
  writerEpoch = "0";
  persist() {
    try {
      sessionStorage.setItem(
        "orbit:outbox",
        JSON.stringify(
          [...this.pending.values()]
            .filter((t) => !t.command.type.startsWith("WORK_"))
            .map((t) => t.command)
            .slice(-32),
        ),
      );
    } catch {}
  }
  restore() {
    try {
      for (const c of JSON.parse(
        sessionStorage.getItem("orbit:outbox") ?? "[]",
      ))
        if (c.roomId === this.roomId && !this.pending.has(c.commandId))
          this.pending.set(c.commandId, {
            command: { ...c, controllerEpoch: this.epoch },
            resolve: () => {},
            reject: () => {},
            at: Date.now(),
          });
    } catch {}
  }
  async api(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": this.csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? "연결 실패");
    return data;
  }
  async session() {
    const s = await this.api("/api/session");
    if (s) {
      this.csrf = s.csrf;
      this.guest = s;
    }
    return s;
  }
  async guestLogin(name: string) {
    await this.session();
    const s = await this.api("/api/guest", { nickname: name });
    this.csrf = s.csrf;
    this.guest = s;
    return s;
  }
  async create(name: string, planned: number) {
    return this.api("/api/rooms", { roomName: name, plannedPlayers: planned });
  }
  async connect(roomId: string, code = "") {
    this.closed = false;
    this.roomId = roomId;
    this.code = code;
    this.onStatus("작업장에 연결 중");
    const ticket = await this.api(`/api/rooms/${roomId}/join-ticket`, {
      roomCode: code,
    });
    const url =
      (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
    const sdk = new Client(url);
    const room = await sdk.joinById(ticket.runtimeRoomId, {
      ticket: ticket.ticket,
    });
    this.room = room;
    room.onMessage("WELCOME", (p: any) => {
      this.member = p.memberId;
      this.epoch = p.controllerEpoch;
      this.writerEpoch = p.writerEpoch;
      this.restore();
      this.onStatus("저장된 작업장을 불러오는 중");
      room.send("REQUEST_FULL_STATE", {});
    });
    room.onMessage("FULL_STATE", (p: any) => {
      if (BigInt(p.writerEpoch) < BigInt(this.writerEpoch)) return;
      this.setWorld(p.world);
      room.send("STATE_READY", {});
      this.connected = true;
      this.onStatus("연결됨");
      if (this.pending.size)
        room.send("COMMAND_STATUS_QUERY", { ids: [...this.pending.keys()] });
    });
    room.onStateChange((state: any) => {
      if (!this.member || BigInt(state.epoch ?? 0) < BigInt(this.writerEpoch))
        return;
      const w: any = {};
      for (const [key, val] of state.publicData ?? []) {
        if (val === "@map") {
          w[key] ??= {};
        } else if (key.includes("|")) {
          const split = key.indexOf("|"),
            root = key.slice(0, split);
          w[root] ??= {};
          w[root][key.slice(split + 1)] = JSON.parse(val);
        } else w[key] = JSON.parse(val);
      }
      const personal = state.privateData?.get(this.member);
      if (personal) {
        const p = JSON.parse(personal.data);
        Object.assign((w.inventories ??= {}), p.inventories);
        Object.assign((w.machines ??= {}), p.machines);
      }
      if (w.id && w.inventories?.["bag:" + this.member]) {
        this.setWorld(w);
        if (!this.connected) {
          room.send("STATE_READY", {});
          this.connected = true;
          this.onStatus("연결됨");
        }
      }
    });
    room.onMessage("COMMAND_ACK", (ack: Ack) => this.ack(ack));
    room.onMessage("COMMAND_ERROR", (p: any) => {
      const task = this.pending.get(p.commandId);
      if (p.code === "COMMAND_PENDING") {
        this.onStatus("작업 결과를 확인하고 있습니다");
        return;
      }
      this.pending.delete(p.commandId);
      this.persist();
      task?.reject(Error(p.code));
      this.onError(p.code);
    });
    room.onMessage("COMMAND_STATUS", (p: any) => {
      for (const { id, receipt } of p.results) {
        if (receipt) this.ack(receipt);
        else {
          const task = this.pending.get(id);
          if (task) {
            task.command.controllerEpoch = this.epoch;
            this.room?.send("COMMAND", task.command);
          }
        }
      }
    });
    room.onMessage("STORAGE_PENDING", () => {
      this.connected = false;
      this.stopInputs();
      this.onStatus("저장 연결을 확인하고 있습니다");
    });
    room.onMessage("SESSION_REPLACED", () => {
      this.closed = true;
      this.connected = false;
      this.stopInputs();
      this.onStatus("다른 탭에서 연결했습니다");
    });
    room.onLeave(() => {
      this.connected = false;
      this.stopInputs();
      if (!this.closed) void this.reconnect();
    });
    room.onError((_c, message) => this.onError(message ?? "연결 오류"));
    localStorage.setItem("orbit:lastRoom", roomId);
    return room;
  }
  setWorld(w: World) {
    if (
      this.world?.id === w.id &&
      BigInt(w.version) < BigInt(this.world.version)
    )
      return;
    this.world = w;
    if (this.hold && !w.members[this.member]?.work) this.hold = null;
    this.onWorld(w);
  }
  ack(ack: Ack) {
    const task = this.pending.get(ack.commandId);
    if (!task) return;
    this.pending.delete(ack.commandId);
    this.persist();
    if (ack.result?.recoveryKey) this.onSecret(String(ack.result.recoveryKey));
    if (ack.status === "REJECTED") {
      task.reject(Error(ack.error?.code));
      this.onError(ack.error?.code ?? "오류");
    } else task.resolve(ack);
  }
  command(type: string, payload: unknown): Promise<Ack> {
    if (this.pending.size >= 32) return Promise.reject(Error("SERVER_BUSY"));
    if (!this.room || !this.connected || !this.world)
      return Promise.reject(Error("STATE_NOT_READY"));
    const command: Command = {
      protocolVersion: R.protocol_version,
      roomId: this.roomId,
      commandId: crypto.randomUUID(),
      controllerEpoch: this.epoch,
      clientSeq: ++this.seq,
      minDurableVersion: this.world.version,
      type,
      payload,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(command.commandId, {
        command,
        resolve,
        reject,
        at: Date.now(),
      });
      this.persist();
      this.room!.send("COMMAND", command);
    });
  }
  move(dx: number, dz: number) {
    if (this.connected)
      this.room?.send("MOVE_INPUT", {
        dx: Math.round(dx),
        dz: Math.round(dz),
        seq: ++this.seq,
        controllerEpoch: this.epoch,
      });
  }
  holding() {
    if (this.hold && this.connected)
      this.room?.send("WORK_HOLD", {
        workId: this.hold,
        controllerEpoch: this.epoch,
      });
  }
  stopInputs() {
    this.move(0, 0);
    const hold = this.hold;
    this.hold = null;
    if (hold && this.connected)
      void this.command("WORK_STOP", { workId: hold }).catch(() => {});
  }
  async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      this.onStatus("연결이 끊겼습니다. 저장된 작업장을 불러오고 있습니다");
      const start = Date.now();
      let n = 0;
      while (
        !this.closed &&
        Date.now() - start < R.timers_ms.connect_ui_timeout
      ) {
        await new Promise((r) =>
          setTimeout(
            r,
            R.retry.base_delays_ms[
              Math.min(n++, R.retry.base_delays_ms.length - 1)
            ],
          ),
        );
        try {
          await this.session();
          await this.connect(this.roomId, this.code);
          return;
        } catch {}
      }
      this.onStatus("연결을 다시 시도해 주세요");
    } finally {
      this.reconnecting = false;
    }
  }
  async leave() {
    this.closed = true;
    this.stopInputs();
    this.connected = false;
    await this.room?.leave(true);
    this.room = null;
    this.world = null;
  }
}
export const connection = new Connection();
