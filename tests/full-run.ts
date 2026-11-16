import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { R } from "../packages/content/src/index.ts";
import {
  createWorld,
  join,
  command,
  tick,
  type Runtime,
} from "../packages/game-core/src/index.ts";
import { exerciseEconomy } from "./full-scenario.ts";
export async function fullCoreRun(n: number) {
  let w = createWorld(randomUUID(), "Full economy " + n, "FULLTEST", n, "test");
  const rt: Runtime = { now: 0, wallNow: 0, inputs: {} };
  const members = Array.from(
    { length: n },
    (_, i) => join(w, randomUUID(), "작업자" + (i + 1), 0).id,
  );
  let seq = 0;
  return exerciseEconomy({
    get world() {
      return w;
    },
    members,
    mode: "CORE_SIMULATION_NOT_BROWSER_OR_NETWORK",
    async command(m, type, payload) {
      const applied = command(
        w,
        m,
        {
          protocolVersion: R.protocol_version,
          roomId: w.id,
          commandId: randomUUID(),
          controllerEpoch: w.members[m].epoch,
          clientSeq: ++seq,
          minDurableVersion: w.version,
          type,
          payload,
        },
        rt,
      );
      assert.equal(applied.error, undefined, `${type}: ${applied.error}`);
      w = applied.world;
      return applied.result;
    },
    async input(m, dx, dz) {
      rt.inputs[m] = { dx, dz, seq: ++seq, at: rt.now, hold: null, holdAt: 0 };
    },
    async step(n) {
      for (let k = 0; k < n; k++) {
        rt.now += 50;
        rt.wallNow += 50;
        for (const m of members)
          rt.inputs[m] = {
            ...(rt.inputs[m] ?? {
              dx: 0,
              dz: 0,
              seq: 0,
              at: 0,
              hold: null,
              holdAt: 0,
            }),
            at: rt.now,
            hold: w.members[m].work?.id ?? null,
            holdAt: rt.now,
          };
        tick(w, rt);
      }
    },
  });
}
if (process.argv[1]?.endsWith("full-run.ts")) {
  mkdirSync("docs/qa/evidence", { recursive: true });
  const results = [];
  for (const n of [1, 6]) {
    const r = await fullCoreRun(n);
    console.log(JSON.stringify(r));
    results.push(r);
  }
  writeFileSync(
    "docs/qa/evidence/core-full-runs.json",
    JSON.stringify({ executedAt: new Date().toISOString(), results }, null, 2),
  );
}
