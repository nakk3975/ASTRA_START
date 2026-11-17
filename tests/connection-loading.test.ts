import test from "node:test";
import assert from "node:assert/strict";
import type { Client, Room } from "@colyseus/sdk";
import { Connection } from "../apps/web/src/network.ts";
import { R } from "../packages/content/src/index.ts";

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: storage,
});
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: { protocol: "http:", host: "localhost" },
});
class Socket {
  handlers = new Map<string, (p: any) => void>();
  leaveHandler = () => {};
  stateHandler = (_p: any) => {};
  errorHandler = (_code: number, _message?: string) => {};
  sent: string[] = [];
  leaves = 0;
  onMessage(type: string, cb: (p: any) => void) {
    this.handlers.set(type, cb);
  }
  onLeave(cb: () => void) {
    this.leaveHandler = cb;
  }
  onStateChange(cb: (p: any) => void) {
    this.stateHandler = cb;
  }
  onError(cb: (n: number, s?: string) => void) {
    this.errorHandler = cb;
  }
  send(type: string) {
    this.sent.push(type);
  }
  async leave() {
    this.leaves++;
    this.leaveHandler();
    return 1000;
  }
  emit(type: string, payload: any) {
    this.handlers.get(type)?.(payload);
  }
}
const welcome = {
  protocolVersion: R.protocol_version,
  contentVersion: R.content_version,
  runtimeVersion: R.runtime_version,
  rendererCompatibilityVersion: R.renderer_compatibility_version,
  appearanceSetVersion: R.appearance_set_version,
  assetManifestHash: "verified",
  memberId: "member",
  controllerEpoch: 1,
  writerEpoch: "1",
};
function setup(
  loadAssets = async () => ({ version: "1.1.0", status: "PILOT", assets: [] }),
  timeoutMs = 200,
) {
  const socket = new Socket();
  let tickets = 0;
  const connection = new Connection({
    loadAssets,
    assetHash: () => "verified",
    timeoutMs,
    client: () =>
      ({
        joinById: async () => socket as unknown as Room,
      }) as unknown as Client,
  });
  connection.api = async () => {
    tickets++;
    return { runtimeRoomId: "runtime", ticket: "ticket" };
  };
  return { socket, connection, tickets: () => tickets };
}
async function handlers(socket: Socket) {
  for (let i = 0; i < 1000; i++) {
    if (socket.handlers.has("WELCOME")) return;
    await new Promise((r) => setImmediate(r));
  }
  throw Error("handler setup failed");
}
function snapshot(id: string) {
  return {
    writerEpoch: "1",
    world: { id, version: "1", members: { member: {} }, inventories: {} },
  };
}
test("socket join is not connection success until a compatible WELCOME and full state arrive", async () => {
  const { socket, connection } = setup();
  let done = false;
  const pending = connection.connect("room").then((r) => {
    done = true;
    return r;
  });
  await handlers(socket);
  assert.equal(done, false);
  socket.emit("WELCOME", welcome);
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false);
  assert.equal(socket.sent.includes("STATE_READY"), false);
  socket.emit("FULL_STATE", snapshot("room"));
  await pending;
  assert.equal(connection.connected, true);
  assert.equal(socket.sent.filter((s) => s === "STATE_READY").length, 1);
  await connection.leave();
});
test("missing initial state times out, closes the socket, and ignores a late snapshot", async () => {
  const { socket, connection } = setup(undefined, 25);
  await assert.rejects(connection.connect("room"), /시간이 초과/);
  assert.equal(socket.leaves, 1);
  socket.emit("WELCOME", welcome);
  socket.emit("FULL_STATE", snapshot("old-room"));
  assert.equal(connection.world, null);
  assert.equal(connection.connected, false);
});
test("a changed visual manifest rejects entry without STATE_READY", async () => {
  const { socket, connection } = setup();
  const pending = assert.rejects(connection.connect("room"), /표시 파일/);
  await handlers(socket);
  socket.emit("WELCOME", { ...welcome, assetManifestHash: "old-files" });
  await pending;
  assert.equal(socket.sent.includes("STATE_READY"), false);
  assert.equal(connection.connected, false);
});
test("leaving during model decode cancels entry before a join ticket is requested", async () => {
  let release!: () => void;
  const { connection, tickets } = setup(async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    return { version: "1.1.0", status: "PILOT", assets: [] };
  });
  const pending = assert.rejects(
    connection.connect("old-room"),
    /CONNECTION_CANCELLED/,
  );
  await connection.leave();
  await pending;
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(tickets(), 0);
  assert.equal(connection.world, null);
});
test("a socket that arrives after cancellation is closed without applying state", async () => {
  const { socket, connection } = setup();
  let release!: (room: Room) => void;
  const client = {
    joinById: () =>
      new Promise<Room>((r) => {
        release = r;
      }),
  };
  const c = new Connection({
    loadAssets: async () => ({ version: "1.1.0", status: "PILOT", assets: [] }),
    assetHash: () => "verified",
    client: () => client as unknown as Client,
    timeoutMs: 200,
  });
  c.api = connection.api;
  const pending = assert.rejects(c.connect("room"), /CONNECTION_CANCELLED/);
  for (let i = 0; i < 10 && !release; i++)
    await new Promise((r) => setImmediate(r));
  await c.leave();
  await pending;
  release(socket as unknown as Room);
  await new Promise((r) => setImmediate(r));
  assert.equal(socket.leaves, 1);
  assert.equal(c.room, null);
});

test("leaving cancels the pending reconnect delay without opening another socket", async () => {
  const { connection, tickets } = setup(undefined, 3000);
  connection.roomId = "old-room";
  const retry = connection.reconnect();
  await connection.leave();
  await retry;
  assert.equal(tickets(), 0);
  assert.equal(connection.reconnecting, false);
  assert.equal(connection.closed, true);
});

test("a manual connection cancels a stale reconnect even if its session request finishes late", async () => {
  const { socket, connection, tickets } = setup(undefined, 3000);
  let release!: () => void;
  let sessionStarted!: () => void;
  const started = new Promise<void>((r) => {
    sessionStarted = r;
  });
  connection.session = async () => {
    sessionStarted();
    await new Promise<void>((r) => {
      release = r;
    });
    return null;
  };
  connection.roomId = "old-room";
  const retry = connection.reconnect();
  await started;
  const joined = connection.connect("new-room");
  await handlers(socket);
  socket.emit("WELCOME", welcome);
  socket.emit("FULL_STATE", snapshot("new-room"));
  await joined;
  await retry;
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(tickets(), 1);
  assert.equal(connection.roomId, "new-room");
  assert.equal(connection.connected, true);
  await connection.leave();
});

test("the reconnect deadline includes a stalled session request", async () => {
  const { connection, tickets } = setup(undefined, 1100);
  let signal: AbortSignal | undefined;
  connection.session = async (s) => {
    signal = s;
    return new Promise(() => {});
  };
  await connection.reconnect();
  assert.equal(signal?.aborted, true);
  assert.equal(tickets(), 0);
  assert.equal(connection.reconnecting, false);
});
