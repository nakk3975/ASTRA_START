import { preloadAssets, manifestHash } from "./visuals/assets";
import { viewControl } from "./visuals/camera";
import { Client, type Room } from "@colyseus/sdk";
import { R } from "../../../packages/content/src/index.ts";
import type { World } from "../../../packages/game-core/src/index.ts";
import type { Ack, Command } from "../../../packages/protocol/src/index.ts";
export class Connection {
  constructor(
    private dependencies = {
      loadAssets: preloadAssets,
      assetHash: () => manifestHash,
      client: (url: string) => new Client(url),
      timeoutMs: R.timers_ms.connect_ui_timeout,
    },
  ) {}
  private connecting: AbortController | null = null;
  private reconnectController: AbortController | null = null;
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
  waitingAcks: Ack[] = [];
  welcomed = false;
  connectGeneration = 0;
  persist() {
    try {
      sessionStorage.setItem(
        "orbit:outbox",
        JSON.stringify(
          [...this.pending.values()]
            .filter(
              (t) =>
                ![
                  "WORK_START",
                  "WORK_STOP",
                  "CAST_VOTE",
                  "PROPOSE_LAUNCH",
                  "READY_SET",
                ].includes(t.command.type),
            )
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
  async api(url: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      signal,
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
  async session(signal?: AbortSignal) {
    const s = await this.api("/api/session", undefined, signal);
    signal?.throwIfAborted();
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
  async connect(roomId: string, code = "", retrySignal?: AbortSignal) {
    retrySignal?.throwIfAborted();
    if (!retrySignal) {
      this.reconnectController?.abort(Error("CONNECTION_CANCELLED"));
      this.reconnectController = null;
      this.reconnecting = false;
    }
    this.connecting?.abort(Error("CONNECTION_CANCELLED"));
    const controller = new AbortController();
    const cancelRetry = () => controller.abort(retrySignal?.reason);
    retrySignal?.addEventListener("abort", cancelRetry, { once: true });
    this.connecting = controller;
    const generation = ++this.connectGeneration;
    this.closed = false;
    this.connected = false;
    this.welcomed = false;
    this.world = null;
    this.roomId = roomId;
    this.code = code;
    this.waitingAcks = [];
    this.hold = null;
    const previousRoom = this.room;
    this.room = null;
    if (previousRoom) void previousRoom.leave().catch(() => {});
    const timeout = setTimeout(
      () =>
        controller.abort(
          Error("작업장 연결 시간이 초과됐습니다. 다시 시도해 주세요."),
        ),
      this.dependencies.timeoutMs,
    );
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason),
        { once: true },
      );
    });
    try {
      return await Promise.race([
        this.openRoom(roomId, code, generation, controller.signal),
        aborted,
      ]);
    } catch (e) {
      controller.abort(e);
      if (generation === this.connectGeneration) {
        this.connectGeneration++;
        this.connected = false;
        const room = this.room as Room | null;
        this.room = null;
        if (room) void room.leave().catch(() => {});
        this.onStatus("연결을 다시 시도해 주세요");
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      retrySignal?.removeEventListener("abort", cancelRetry);
      if (this.connecting === controller) this.connecting = null;
    }
  }
  private async openRoom(
    roomId: string,
    code: string,
    generation: number,
    signal: AbortSignal,
  ) {
    this.onStatus("3D 모델을 불러오는 중");
    await this.dependencies.loadAssets();
    signal.throwIfAborted();
    if (generation !== this.connectGeneration || this.closed)
      throw Error("CONNECTION_CANCELLED");
    this.onStatus("작업장에 연결 중");
    const ticket = await this.api(
      `/api/rooms/${roomId}/join-ticket`,
      {
        roomCode: code,
      },
      signal,
    );
    signal.throwIfAborted();
    const url =
      (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
    const sdk = this.dependencies.client(url);
    const room = await sdk.joinById(ticket.runtimeRoomId, {
      ticket: ticket.ticket,
    });
    if (
      signal.aborted ||
      generation !== this.connectGeneration ||
      this.closed
    ) {
      await room.leave();
      throw Error("CONNECTION_CANCELLED");
    }
    this.room = room;
    let readyResolve!: () => void, readyReject!: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const abortReady = () => readyReject(signal.reason);
    signal.addEventListener("abort", abortReady, { once: true });
    const current = () =>
      generation === this.connectGeneration &&
      this.room === room &&
      !this.closed &&
      !signal.aborted;
    let hasInitialState = false;
    const message = (type: string, handler: (p: any) => void) =>
      room.onMessage(type, (p: any) => {
        if (current()) handler(p);
      });
    const markReady = () => {
      room.send("STATE_READY", {});
      this.connected = true;
      hasInitialState = true;
      this.onStatus("연결됨");
      readyResolve();
    };
    message("WELCOME", (p: any) => {
      if (
        p.protocolVersion !== R.protocol_version ||
        p.contentVersion !== R.content_version ||
        p.rendererCompatibilityVersion !== R.renderer_compatibility_version ||
        p.runtimeVersion !== R.runtime_version ||
        p.appearanceSetVersion !== R.appearance_set_version ||
        p.assetManifestHash !== this.dependencies.assetHash()
      ) {
        this.closed = true;
        void room.leave();
        readyReject(
          Error(
            "표시 파일 또는 클라이언트 버전이 다릅니다. 새로고침해 주세요.",
          ),
        );
        return;
      }
      this.welcomed = true;
      this.member = p.memberId;
      this.epoch = p.controllerEpoch;
      this.writerEpoch = p.writerEpoch;
      this.restore();
      this.onStatus("저장된 작업장을 불러오는 중");
      room.send("REQUEST_FULL_STATE", {});
    });
    message("FULL_STATE", (p: any) => {
      if (!this.welcomed || BigInt(p.writerEpoch) < BigInt(this.writerEpoch))
        return;
      this.setWorld(p.world);
      markReady();
      if (this.pending.size)
        room.send("COMMAND_STATUS_QUERY", { ids: [...this.pending.keys()] });
    });
    room.onStateChange((state: any) => {
      if (
        !current() ||
        !this.welcomed ||
        !this.member ||
        BigInt(state.epoch ?? 0) < BigInt(this.writerEpoch)
      )
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
          markReady();
        }
      }
    });
    message("COMMAND_ACK", (ack: Ack) => this.ack(ack));
    message("COMMAND_ERROR", (p: any) => {
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
    message("COMMAND_STATUS", (p: any) => {
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
    message("STORAGE_PENDING", () => {
      this.connected = false;
      this.stopInputs();
      this.onStatus("저장 연결을 확인하고 있습니다");
    });
    message("SESSION_REPLACED", () => {
      this.closed = true;
      this.connected = false;
      this.stopInputs();
      this.onStatus("다른 탭에서 연결했습니다");
      readyReject(Error("SESSION_REPLACED"));
    });
    room.onLeave(() => {
      if (!current()) return;
      this.connected = false;
      this.stopInputs();
      if (!hasInitialState)
        readyReject(Error("초기 상태를 받기 전에 연결이 끊겼습니다."));
      else if (!this.closed) void this.reconnect();
    });
    room.onError((_c, message) => {
      if (!current()) return;
      if (!this.connected) readyReject(Error(message ?? "연결 오류"));
      else this.onError(message ?? "연결 오류");
    });
    localStorage.setItem("orbit:lastRoom", roomId);
    try {
      await ready;
    } finally {
      signal.removeEventListener("abort", abortReady);
    }
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
    const pending = this.waitingAcks.splice(0);
    for (const a of pending) this.ack(a);
  }
  ack(ack: Ack) {
    if (
      ack.status !== "REJECTED" &&
      (!this.world || BigInt(this.world.version) < BigInt(ack.durableVersion))
    ) {
      if (!this.waitingAcks.some((a) => a.commandId === ack.commandId))
        this.waitingAcks.push(ack);
      return;
    }
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
    if (
      viewControl.overview &&
      ![
        "WORK_STOP",
        "CAST_VOTE",
        "CANCEL_LAUNCH",
        "SAVE_BARRIER",
        "SET_ROOM_PAUSE",
      ].includes(type)
    )
      return Promise.reject(
        Error("둘러보기에서는 작업할 수 없습니다. F로 돌아오세요."),
      );
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
    if (viewControl.overview || viewControl.panel || viewControl.resync) {
      dx = 0;
      dz = 0;
    }
    viewControl.input = { x: dx / 1000, z: dz / 1000 };
    viewControl.inputAt = performance.now();
    if (this.connected)
      this.room?.send("MOVE_INPUT", {
        dx: Math.round(dx),
        dz: Math.round(dz),
        seq: ++this.seq,
        controllerEpoch: this.epoch,
      });
  }
  holding() {
    if (this.hold && this.connected && !viewControl.overview)
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
    if (this.reconnecting || this.closed) return;
    const controller = new AbortController();
    this.reconnectController = controller;
    this.reconnecting = true;
    const { roomId, code } = this;
    const timeout = setTimeout(
      () => controller.abort(Error("CONNECTION_TIMEOUT")),
      this.dependencies.timeoutMs,
    );
    const aborted = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason),
        { once: true },
      ),
    );
    const retry = async () => {
      let n = 0;
      while (!this.closed) {
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            controller.signal.removeEventListener("abort", cancel);
            resolve();
          };
          const timer = setTimeout(
            done,
            R.retry.base_delays_ms[
              Math.min(n++, R.retry.base_delays_ms.length - 1)
            ],
          );
          const cancel = () => {
            clearTimeout(timer);
            reject(controller.signal.reason);
          };
          controller.signal.addEventListener("abort", cancel, { once: true });
        });
        controller.signal.throwIfAborted();
        try {
          await this.session(controller.signal);
          controller.signal.throwIfAborted();
          await this.connect(roomId, code, controller.signal);
          return;
        } catch {
          controller.signal.throwIfAborted();
        }
      }
    };
    try {
      this.onStatus("연결이 끊겼습니다. 저장된 작업장을 불러오고 있습니다");
      await Promise.race([retry(), aborted]);
    } catch {
      if (!this.closed && this.reconnectController === controller)
        this.onStatus("연결을 다시 시도해 주세요");
    } finally {
      clearTimeout(timeout);
      if (this.reconnectController === controller) {
        this.reconnectController = null;
        this.reconnecting = false;
      }
    }
  }
  async leave() {
    this.reconnectController?.abort(Error("CONNECTION_CANCELLED"));
    this.connecting?.abort(Error("CONNECTION_CANCELLED"));
    this.connectGeneration++;
    this.closed = true;
    this.stopInputs();
    this.connected = false;
    await this.room?.leave(true);
    this.room = null;
    this.world = null;
  }
}
export const connection = new Connection();
