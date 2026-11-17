import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { PoolClient } from "pg";
import { localDatabase } from "./local-db.ts";
import {
  Repository,
  balanceHash,
  hash,
} from "../apps/server/src/repository.ts";
import {
  createWorld,
  add,
  remove,
  count,
} from "../packages/game-core/src/index.ts";

// Isolated real PostgreSQL. Only the client-side COMMIT boundary error is injected.
if (process.env.NODE_ENV === "production") throw Error("Development test only");
const db = await localDatabase({
  directory: process.cwd() + "/.local/qa-commit-recovery",
  port: 55436,
});
const repo = new Repository(db.url);
const results: unknown[] = [];
try {
  await repo.migrate();
  for (const boundary of [
    "BEFORE_COMMIT",
    "AFTER_COMMIT_RESPONSE_LOST",
  ] as const) {
    const before = createWorld(
      randomUUID(),
      "commit boundary fixture",
      randomUUID(),
      1,
      balanceHash,
    );
    add(before.inventories.shared_warehouse, "metal_scrap", 1);
    before.ledger.generated.metal_scrap = 1;
    await repo.create(before, "test-only-no-owner-key");
    const epoch = await repo.acquire(before.id);
    const after = structuredClone(before);
    remove(after.inventories.shared_warehouse, "metal_scrap", 1);
    add(after.inventories.recovery_vault, "metal_scrap", 1);
    after.version = "1";
    const commitId = randomUUID();
    const originalConnect = repo.pool.connect.bind(repo.pool);
    let injected = false;
    repo.pool.connect = (async () => {
      const client: PoolClient = await originalConnect();
      if (injected) return client;
      const query = client.query.bind(client),
        release = client.release.bind(client);
      client.query = (async (...args: any[]) => {
        const isCommit = args[0] === "COMMIT" && !injected;
        if (isCommit && boundary === "BEFORE_COMMIT") {
          injected = true;
          throw Error("INJECTED_BEFORE_COMMIT");
        }
        const result = await (query as any)(...args);
        if (isCommit) {
          injected = true;
          throw Error("INJECTED_COMMIT_RESPONSE_LOST");
        }
        return result;
      }) as typeof client.query;
      client.release = (error) => {
        client.query = query;
        client.release = release;
        release(error);
      };
      return client;
    }) as typeof repo.pool.connect;
    try {
      const commit = repo.commit(before, after, epoch, [], {}, commitId);
      if (boundary === "BEFORE_COMMIT")
        await assert.rejects(commit, /INJECTED_BEFORE_COMMIT/);
      else await commit;
    } finally {
      repo.pool.connect = originalConnect;
    }
    assert.equal(injected, true);
    const loaded = await repo.load(before.id);
    const expected = boundary === "BEFORE_COMMIT" ? before : after;
    assert.equal(hash(loaded), hash(expected));
    assert.equal(
      count(loaded.inventories.shared_warehouse, "metal_scrap") +
        count(loaded.inventories.recovery_vault, "metal_scrap"),
      1,
    );
    const batches = await repo.pool.query(
      "SELECT count(*)::int AS count FROM room_event_batches WHERE room_id=$1",
      [before.id],
    );
    assert.equal(batches.rows[0].count, boundary === "BEFORE_COMMIT" ? 0 : 1);
    assert.equal(
      await repo.resolveCommit(before.id, commitId),
      boundary !== "BEFORE_COMMIT",
    );
    if (boundary !== "BEFORE_COMMIT") {
      await assert.rejects(
        repo.commit(before, after, epoch, [], {}, commitId),
        /RESYNC_REQUIRED/,
      );
      assert.equal(hash(await repo.load(before.id)), hash(after));
    }
    results.push({
      boundary,
      status: "PASS",
      durableVersion: loaded.version,
      journalBatches: batches.rows[0].count,
      totalItems: 1,
      hashMatches: true,
    });
    await repo.release(before.id, epoch);
  }
  await fs.writeFile(
    "docs/qa/evidence/commit-boundary-recovery.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        status: "PASS",
        mode: "REAL_POSTGRESQL_CLIENT_BOUNDARY_ERROR_INJECTION",
        fixture:
          "One metal scrap moved between two buffers to check atomic conservation; not a gameplay run",
        limitations:
          "No OS process kill, packet proxy, WebSocket ACK loss or network partition in this test",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("COMMIT_RECOVERY_PASS", results);
} finally {
  await repo.pool.end();
  await db.db.stop();
}
