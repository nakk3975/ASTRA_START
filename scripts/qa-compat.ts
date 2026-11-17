import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { localDatabase } from "./local-db.ts";
import {
  Repository,
  balanceHash,
  hash,
} from "../apps/server/src/repository.ts";
import { Actor } from "../apps/server/src/actor.ts";
import { createWorld } from "../packages/game-core/src/index.ts";
import { R } from "../packages/content/src/index.ts";
const db = await localDatabase({
  directory: process.cwd() + "/.local/qa-compat",
  port: 55434,
});
const repo = new Repository(db.url);
await repo.migrate();
try {
  const w = createWorld(
    randomUUID(),
    "v1 compatibility",
    "COMPAT",
    1,
    balanceHash,
  );
  w.runtimeVersion = "1.0.0-design";
  await repo.create(w, "qa-not-a-secret");
  const oldHash = hash(w);
  assert.equal(hash(await repo.load(w.id)), oldHash);
  const a = new Actor(repo, w.id);
  await a.open();
  assert.equal(a.world.runtimeVersion, R.runtime_version);
  assert.equal(a.world.balanceHash, balanceHash);
  assert.equal(a.world.version, "1");
  const events = await repo.pool.query(
    "select before_hash,after_hash from room_event_batches where room_id=$1",
    [w.id],
  );
  assert.equal(events.rows[0].before_hash, oldHash);
  assert.equal(events.rows[0].after_hash, hash(a.world));
  await a.close();
  assert.equal((await repo.load(w.id)).runtimeVersion, R.runtime_version);
  const bad = createWorld(
    randomUUID(),
    "reject unknown runtime",
    "UNKNOWN",
    1,
    balanceHash,
  );
  bad.runtimeVersion = "9.9.9";
  await repo.create(bad, "qa-not-a-secret");
  await assert.rejects(repo.load(bad.id), /CONTENT_VERSION_MISMATCH/);
  await fs.writeFile(
    "docs/qa/evidence/v11-compat.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        status: "PASS",
        oldRuntime: "1.0.0-design",
        newRuntime: R.runtime_version,
        originalHashVerified: true,
        migrationJournalled: true,
        unknownRuntimeRejected: true,
      },
      null,
      2,
    ),
  );
} finally {
  await repo.pool.end();
  await db.db.stop();
}
