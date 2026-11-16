import WS from "ws";
import { randomUUID } from "node:crypto";
import { Client } from "@colyseus/sdk";
import { R } from "../packages/content/src/index.ts";
import type { World } from "../packages/game-core/src/index.ts";
(globalThis as any).WebSocket = WS;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class NetworkBot {
  constructor(public base: string) {}
  cookie = "";
  csrf = "";
  guest = "";
  room: any;
  world!: World;
  member = "";
  epoch = 0;
  seq = 0;
  id = "";
  requests = new Map<
    string,
    { resolve: (a: any) => void; reject: (e: any) => void }
  >();
  lastCommand: any;
  storageErrors: string[] = [];
  async api(url: string, body?: any) {
    const res = await fetch(this.base + url, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: this.base,
        "Content-Type": "application/json",
        Cookie: this.cookie,
        "X-CSRF-Token": this.csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = res.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0];
    const data = await res.json();
    if (!res.ok) throw Error(data.error);
    return data;
  }
  async login(name: string) {
    const g = await this.api("/api/guest", { nickname: name });
    this.csrf = g.csrf;
    this.guest = g.guestId;
  }
  async connect(id: string, code: string) {
    this.id = id;
    const ticket = await this.api("/api/rooms/" + id + "/join-ticket", {
      roomCode: code,
    });
    const sdk = new Client(this.base.replace("http", "ws"), {
      headers: {
        Origin: this.base,
        Cookie: this.cookie,
        "X-CSRF-Token": this.csrf,
      },
    });
    this.room = await sdk.joinById(ticket.runtimeRoomId, {
      ticket: ticket.ticket,
    });
    this.room.onMessage("WELCOME", (p: any) => {
      this.member = p.memberId;
      this.epoch = p.controllerEpoch;
      this.room.send("REQUEST_FULL_STATE", {});
    });
    this.room.onMessage("FULL_STATE", (p: any) => {
      this.world = p.world;
      this.room.send("STATE_READY", {});
    });
    this.room.onMessage("COMMAND_ACK", (a: any) => {
      this.requests.get(a.commandId)?.resolve(a);
      this.requests.delete(a.commandId);
    });
    this.room.onMessage("COMMAND_ERROR", (a: any) => {
      this.requests.get(a.commandId)?.reject(Error(a.code));
      this.requests.delete(a.commandId);
    });
    this.room.onMessage("SESSION_REPLACED", () => {});
    this.room.onMessage("STORAGE_PENDING", (p: any) => {
      this.storageErrors.push(p.code);
    });
    await this.until(() => !!this.world, 10000);
    await wait(50);
  }
  async until(fn: () => boolean, ms = 5000) {
    const start = Date.now();
    while (!fn()) {
      if (Date.now() - start > ms) throw Error("TIMEOUT");
      await wait(25);
    }
  }
  async refresh() {
    const prior = this.world;
    this.room.send("REQUEST_FULL_STATE", {});
    await this.until(() => this.world !== prior);
    return this.world;
  }
  async cmd(type: string, payload: any = {}, reuse?: any) {
    const c = reuse ?? {
      protocolVersion: R.protocol_version,
      roomId: this.id,
      commandId: randomUUID(),
      controllerEpoch: this.epoch,
      clientSeq: ++this.seq,
      minDurableVersion: this.world.version,
      type,
      payload,
    };
    this.lastCommand = c;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(c.commandId);
        reject(Error("ACK_TIMEOUT"));
      }, 10000);
      this.requests.set(c.commandId, {
        resolve: (a) => {
          clearTimeout(timer);
          resolve(a);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.room.send("COMMAND", c);
    });
  }
}
