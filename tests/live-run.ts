import assert from "node:assert/strict";
import WS from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { B, M, R, canonical } from "../packages/content/src/index.ts";
import {
  createWorld,
  join,
  assertInvariants,
  add,
  plus,
  count,
  center,
  type World,
} from "../packages/game-core/src/index.ts";
import {
  Repository,
  hash,
  balanceHash,
} from "../apps/server/src/repository.ts";
import { actors } from "../apps/server/src/room.ts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function runLive(base: string, repo: Repository) {
  mkdirSync("docs/qa/evidence", { recursive: true });
  const evidence: any = {
    executedAt: new Date().toISOString(),
    mode: "REAL_HTTP_WEBSOCKET_POSTGRESQL_NORMAL_CLOCK",
    tests: [],
  };
  const record = (id: string, detail: any) => {
    evidence.tests.push({ id, status: "PASS", ...detail });
    writeFileSync(
      "docs/qa/evidence/live-integration.json",
      JSON.stringify(evidence, null, 2),
    );
  };
  try {
    (globalThis as any).WebSocket = WS;
    const { Client } = await import("@colyseus/sdk");
    class Bot {
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
      async api(url: string, body?: any) {
        const res = await fetch(base + url, {
          method: body ? "POST" : "GET",
          headers: {
            Origin: base,
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
        const sdk = new Client(base.replace("http", "ws"), {
          headers: {
            Origin: base,
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
        this.room.onMessage("STORAGE_PENDING", () => {});
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
    const bots = Array.from({ length: 6 }, () => new Bot());
    for (const [i, b] of bots.entries()) await b.login("온라인시험" + (i + 1));
    const created = await bots[0].api("/api/rooms", {
      roomName: "6인 실제 네트워크 검증",
      plannedPlayers: 6,
    });
    for (const b of bots) await b.connect(created.roomId, created.code);
    await wait(600);
    for (const b of bots) await b.refresh();
    assert.equal(
      Object.values(bots[0].world.members).filter((m) => m.connected).length,
      6,
    );
    assert.equal(new Set(bots.map((b) => b.member)).size, 6);
    record("six-distinct-websocket-clients", {
      players: 6,
      uniqueGuests: 6,
      uniqueMembers: 6,
    });
    for (const b of bots) {
      assert.deepEqual(
        Object.keys(b.world.inventories).filter((i) => i.startsWith("bag:")),
        ["bag:" + b.member],
      );
      assert.deepEqual(
        Object.keys(b.world.machines).filter((i) => i.startsWith("channel:")),
        ["channel:" + b.member],
      );
      const state = b.room.state;
      assert.equal(state.privateData.size, 1);
      assert.ok(state.privateData.has(b.member));
    }
    record("private-state-view", { fullStateAndSchemaFilter: true });
    const seventh = new Bot();
    await seventh.login("일곱번째");
    let rejected = "";
    try {
      await seventh.connect(created.roomId, created.code);
    } catch (e) {
      rejected = (e as Error).message;
    }
    assert.ok(rejected.includes("ROOM_FULL"));
    record("seventh-rejected", { error: rejected });
    for (const b of bots)
      assert.equal(
        (await b.cmd("READY_SET", { ready: true })).status,
        "APPLIED",
      );
    assert.equal(
      (await bots[0].cmd("START_SESSION", { settingsRevision: 0 })).status,
      "APPLIED",
    );
    await wait(600);
    await bots[0].refresh();
    assert.equal(bots[0].world.phase, "RUNNING");
    assert.equal(bots[0].world.stages[0].required.plate, 16);
    record("six-player-ready-start-and-goals", {
      phase: "RUNNING",
      firstStagePlate: 16,
    });
    // Explicit fixtures for contention tests; these are NOT playthrough evidence.
    const contentionActor = actors.get(created.roomId)!;
    await contentionActor.mutate((w) => {
      for (const m of Object.values(w.members))
        m.position = center(M.starter_entities[1].service_points[0].cell);
      add(w.inventories.shared_warehouse, "metal_scrap", 1);
      plus(w.ledger.generated, { metal_scrap: 1 });
    });
    for (const bot of bots) await bot.refresh();
    const takeResults = await Promise.all(
      bots.map((bot) =>
        bot.cmd("TRANSFER_ITEM", {
          from: "shared_warehouse",
          to: "bag:" + bot.member,
          itemId: "metal_scrap",
          quantity: 1,
        }),
      ),
    );
    assert.equal(takeResults.filter((a) => a.status === "APPLIED").length, 1);
    const transferCommands = bots.map((bot) =>
      structuredClone(bot.lastCommand),
    );
    assert.equal(
      takeResults.filter((a) => a.error?.code === "NOT_ENOUGH_ITEMS").length,
      5,
    );
    assert.equal(
      count(contentionActor.world.inventories.shared_warehouse, "metal_scrap"),
      0,
    );
    assert.equal(
      bots.reduce(
        (n, bot) =>
          n +
          count(
            contentionActor.world.inventories["bag:" + bot.member],
            "metal_scrap",
          ),
        0,
      ),
      1,
    );
    record("T01-final-item-six-concurrent", {
      fixture: true,
      applied: 1,
      rejected: 5,
      total: 1,
    });
    await contentionActor.mutate((w) => {
      w.stage = 1;
      w.stages[0].completed = true;
      for (const m of Object.values(w.members)) {
        m.position = center({ x: 11, z: 7 });
        for (const [item, q] of Object.entries(
          B.machines.processor.paid_cost,
        )) {
          add(w.inventories["bag:" + m.id], item as any, q);
          plus(w.ledger.generated, { [item]: q });
        }
      }
    });
    await wait(600);
    for (const bot of bots) await bot.refresh();
    const buildResults = await Promise.all(
      bots.map((bot) =>
        bot.cmd("PLACE_MACHINE", {
          machineType: "processor",
          x: 11,
          z: 5,
          rotation: 2,
        }),
      ),
    );
    assert.equal(buildResults.filter((a) => a.status === "APPLIED").length, 1);
    assert.equal(
      buildResults.filter((a) => a.error?.code === "OCCUPIED").length,
      5,
    );
    assert.equal(
      Object.values(contentionActor.world.machines).filter(
        (m) => m.type === "processor",
      ).length,
      1,
    );
    assert.deepEqual(
      contentionActor.world.ledger.spent,
      B.machines.processor.paid_cost,
    );
    assertInvariants(contentionActor.world);
    record("T02-footprint-six-concurrent", {
      fixture: true,
      applied: 1,
      rejected: 5,
      paidOnce: true,
    });
    const win = takeResults.findIndex((a) => a.status === "APPLIED"),
      transfer = transferCommands[win];
    for (let k = 0; k < 100; k++) {
      await wait(135);
      assert.deepEqual(await bots[win].cmd("", {}, transfer), takeResults[win]);
    }
    let reuseError = "";
    try {
      await bots[win].cmd(
        "",
        {},
        { ...transfer, payload: { ...transfer.payload, quantity: 2 } },
      );
    } catch (e) {
      reuseError = (e as Error).message;
    }
    assert.equal(reuseError, "IDEMPOTENCY_KEY_REUSED");
    const retryGuest = new Bot();
    retryGuest.cookie = bots[win].cookie;
    retryGuest.csrf = bots[win].csrf;
    retryGuest.guest = bots[win].guest;
    await retryGuest.connect(created.roomId, created.code);
    assert.deepEqual(await retryGuest.cmd("", {}, transfer), takeResults[win]);
    bots[win] = retryGuest;
    assert.equal(
      bots.reduce(
        (n, bot) =>
          n +
          count(
            contentionActor.world.inventories["bag:" + bot.member],
            "metal_scrap",
          ),
        0,
      ),
      1,
    );
    record("T03-hundred-retries-and-reconnect", {
      fixture: true,
      retries: 100,
      sameReceipt: true,
      effectCount: 1,
    });
    record("T04-command-quantity-reuse", { error: reuseError });
    const before = { ...bots[0].world.members[bots[0].member].position };
    for (let i = 0; i < 7; i++) {
      bots[0].room.send("MOVE_INPUT", {
        dx: 1000,
        dz: 0,
        seq: ++bots[0].seq,
        controllerEpoch: bots[0].epoch,
      });
      await wait(100);
    }
    bots[0].room.send("MOVE_INPUT", {
      dx: 0,
      dz: 0,
      seq: ++bots[0].seq,
      controllerEpoch: bots[0].epoch,
    });
    await wait(550);
    await bots[0].refresh();
    const after = bots[0].world.members[bots[0].member].position;
    assert.ok(after.x > before.x);
    record("authoritative-movement", { before, after });
    const b = bots[0],
      ack = await b.cmd("SAVE_BARRIER"),
      original = { ...b.lastCommand };
    assert.equal(ack.status, "APPLIED");
    const again = await b.cmd("", {}, original);
    assert.deepEqual(again, ack);
    let collision = "";
    try {
      await b.cmd(
        "",
        {},
        { ...original, type: "READY_SET", payload: { ready: false } },
      );
    } catch (e) {
      collision = (e as Error).message;
    }
    assert.equal(collision, "IDEMPOTENCY_KEY_REUSED");
    record("durable-ack-and-idempotency", {
      durableVersion: ack.durableVersion,
      retrySameReceipt: true,
      reusedPayloadRejected: true,
    });
    await wait(550);
    await b.refresh();
    const remote = await b.cmd("WORK_START", {
      kind: "GATHER",
      sourceId: "source_metal_scrap",
    });
    assert.equal(remote.error.code, "OUT_OF_RANGE");
    record("remote-work-denied", { error: remote.error.code });
    const replacement = new Bot();
    replacement.cookie = b.cookie;
    replacement.csrf = b.csrf;
    replacement.guest = b.guest;
    await replacement.connect(created.roomId, created.code);
    assert.equal(replacement.member, b.member);
    assert.ok(replacement.epoch > b.epoch);
    record("duplicate-tab-controller-replacement", {
      sameMember: true,
      oldEpoch: b.epoch,
      newEpoch: replacement.epoch,
    });
    bots[0] = replacement;
    const invalid = await fetch(base + "/api/rooms", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        Cookie: replacement.cookie,
      },
      body: JSON.stringify({ plannedPlayers: 1 }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as any).error, "CSRF_FAILED");
    const badOrigin = await fetch(base + "/api/rooms", {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(badOrigin.status, 403);
    record("csrf-and-origin", { csrfRejected: true, originRejected: true });
    for (const type of [
      "ROTATE_ROOM_CODE",
      "ROTATE_RECOVERY_KEY",
      "DELETE_SAVED_ROOM",
    ]) {
      const a = await bots[1].cmd(
        type,
        type === "DELETE_SAVED_ROOM"
          ? { version: bots[1].world.version, code: created.code }
          : {},
      );
      assert.equal(a.error.code, "NOT_OWNER");
    }
    let recoveryDenied = "";
    try {
      await bots[1].api("/api/rooms/" + created.roomId + "/recover-owner", {
        ownerRecoveryKey: created.code,
      });
    } catch (e) {
      recoveryDenied = (e as Error).message;
    }
    assert.equal(recoveryDenied, "RECOVERY_KEY_INVALID");
    record("R15-code-does-not-grant-ownership", {
      commandsDenied: 3,
      codeRecoveryDenied: true,
    });
    for (const bot of bots) await bot.room.leave(true);
    await wait(700);
    const actor = actors.get(created.roomId)!;
    const tick = actor.world.tick;
    await wait(500);
    assert.equal(actor.world.tick, tick);
    await actor.repo.snapshot(actor.world);
    const loaded = await repo.load(created.roomId);
    assert.equal(hash(loaded), hash(actor.world));
    record("postgres-save-offline-freeze", {
      tick,
      roundTripHash: hash(loaded),
    });
    const re = new Bot();
    re.cookie = replacement.cookie;
    re.csrf = replacement.csrf;
    re.guest = replacement.guest;
    await re.connect(created.roomId, created.code);
    assert.equal(re.member, replacement.member);
    assert.equal(re.world.planned, 6);
    assert.equal(re.world.phase, "RUNNING");
    await re.room.leave(true);
    record("session-rejoin", {
      sameMember: true,
      samePlan: true,
      phasePreserved: true,
    });
    // Isolated repository scenario. No alteration to the connected gameplay room.
    const guest = randomUUID();
    await repo.pool.query(
      "INSERT INTO guest_identities(id,auth_secret_hash,nickname) VALUES($1,$2,$3)",
      [guest, hash(randomUUID()), "DB시험"],
    );
    const id = randomUUID(),
      w = createWorld(
        id,
        "DB recovery test",
        randomUUID().slice(0, 8),
        1,
        balanceHash,
      );
    join(w, guest, "DB시험", Date.now());
    await repo.create(w, hash(randomUUID()));
    const epoch = await repo.acquire(id);
    const second = new Repository((repo.pool as any).options.connectionString);
    let fence = "";
    try {
      await second.acquire(id);
    } catch (e) {
      fence = (e as Error).message;
    }
    assert.equal(fence, "WRITER_FENCED");
    const next = structuredClone(w);
    next.version = "1";
    next.name = "durable change";
    await repo.commit(w, next, epoch, []);
    await repo.snapshot(next);
    await repo.pool.query(
      "UPDATE room_snapshots SET state_blob=jsonb_set(state_blob,'{name}','\"corrupt\"') WHERE room_id=$1 AND durable_version=1",
      [id],
    );
    const fallback = await repo.load(id);
    assert.equal(hash(fallback), hash(next));
    await repo.pool.query(
      "DELETE FROM room_event_batches WHERE room_id=$1 AND durable_version=1",
      [id],
    );
    await assert.rejects(() => repo.load(id), /SAVE_CORRUPT/);
    const preserved = (
      await repo.pool.query(
        "SELECT head_hash,durable_version FROM rooms WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(preserved.head_hash, hash(next));
    assert.equal(preserved.durable_version, "1");
    record("T10-missing-event-preserves-corrupt-save", {
      fallbackAlreadyMatched: true,
      missingEventRejected: true,
      originalHeadPreserved: true,
    });
    await repo.release(id, epoch);
    const epoch2 = await second.acquire(id);
    let stale = "";
    try {
      const later = structuredClone(next);
      later.version = "2";
      await repo.commit(next, later, epoch, []);
    } catch (e) {
      stale = (e as Error).message;
    }
    assert.equal(stale, "WRITER_FENCED");
    await second.release(id, epoch2);
    await second.pool.end();
    record("writer-fence-and-corrupt-snapshot-fallback", {
      secondWriterDenied: true,
      staleEpochDenied: true,
      olderSnapshotReplayHash: hash(fallback),
    });
    evidence.completedAt = new Date().toISOString();
    evidence.status = "PASS";
    writeFileSync(
      "docs/qa/evidence/live-integration.json",
      JSON.stringify(evidence, null, 2),
    );
  } catch (e) {
    evidence.status = "FAIL";
    evidence.error = String((e as Error)?.stack ?? e);
    writeFileSync(
      "docs/qa/evidence/live-integration.json",
      JSON.stringify(evidence, null, 2),
    );
    console.error("LIVE_QA_FAILED", e);
  }
}
