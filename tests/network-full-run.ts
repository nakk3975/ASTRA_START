import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { canonical } from "../packages/content/src/index.ts";
import { actors } from "../apps/server/src/room.ts";
import { hash, type Repository } from "../apps/server/src/repository.ts";
import { NetworkBot } from "./network-client.ts";
import { exerciseEconomy } from "./full-scenario.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, label: string, timeout = 10000) {
  const start = performance.now();
  while (!fn()) {
    if (performance.now() - start > timeout) throw Error("TIMEOUT " + label);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Integration-only virtual clock: real sockets, actor, transactions, and schema.
 * No world fixture, economic injection, teleport, rate bypass, or HTTP cheat API.
 * Heartbeats and PostgreSQL writer leases keep their real wall clocks.
 */
export async function runNetworkFull(base: string, repo: Repository) {
  const evidence: any = {
    executedAt: new Date().toISOString(),
    mode: "REAL_HTTP_WEBSOCKET_POSTGRESQL_ACCELERATED_SIMULATION_CLOCK",
    normalClock: false,
    browser: false,
    source: "tests/network-full-run.ts + tests/full-scenario.ts",
    results: [],
  };
  const save = () => {
    mkdirSync("docs/qa/evidence", { recursive: true });
    writeFileSync(
      "docs/qa/evidence/network-full-runs.json",
      JSON.stringify(evidence, null, 2),
    );
  };
  save();
  try {
    const plannedPlayers =
      process.env.ORBIT_FULL_QA_PLAYERS === "6" ? [6] : [1, 6];
    for (const planned of plannedPlayers) {
      const bots = Array.from({ length: planned }, () => new NetworkBot(base));
      for (const [i, b] of bots.entries())
        await b.login("완주작업자" + (i + 1));
      const created = await bots[0].api("/api/rooms", {
        roomName: `실제 ${planned}소켓 가속 완주`,
        plannedPlayers: planned,
      });
      for (const b of bots) await b.connect(created.roomId, created.code);
      const actor = actors.get(created.roomId)!;
      clearInterval(actor.timer);
      await until(() => !actor.busy, "pause real scheduler");
      let virtualNow = performance.now();
      actor.simulationNow = () => virtualNow;
      actor.nextTick = virtualNow + 50;
      // Drain commands through the unmodified actor transaction path. Logical
      // ticks advance only when the driver advances this room's clock.
      actor.timer = setInterval(() => void actor.pump(), 1);
      const members = bots.map((b) => b.member);
      const byMember = new Map(bots.map((b) => [b.member, b]));
      assert.equal(new Set(bots.map((b) => b.guest)).size, planned);
      assert.equal(new Set(members).size, planned);
      let inputMessages = 0,
        holdMessages = 0,
        committedBatches = 0;
      const step = async (ticks: number) => {
        for (let left = ticks; left > 0; ) {
          const batch = Math.min(5, left);
          for (const b of bots) {
            const work = actor.world.members[b.member].work;
            if (work) {
              b.room.send("WORK_HOLD", {
                controllerEpoch: b.epoch,
                workId: work.id,
              });
              holdMessages++;
              await until(
                () =>
                  actor.rt.inputs[b.member]?.hold === work.id &&
                  actor.rt.inputs[b.member]?.holdAt === virtualNow,
                "WORK_HOLD received",
              );
            }
          }
          await until(() => !actor.busy, "actor ready");
          virtualNow += batch * 50;
          await actor.pump();
          assert.equal(actor.failed, null);
          committedBatches++;
          left -= batch;
        }
      };
      try {
        const result = await exerciseEconomy({
          get world() {
            return actor.world;
          },
          members,
          mode: evidence.mode,
          checkpoint(stage, world) {
            evidence.progress = {
              planned,
              stage,
              tick: world.tick,
              updatedAt: new Date().toISOString(),
            };
            save();
          },
          async command(member, type, payload) {
            // Legitimate thinking time also replenishes the unchanged token bucket.
            await step(3);
            const b = byMember.get(member)!;
            const ack = await b.cmd(type, payload);
            assert.equal(
              ack.status,
              "APPLIED",
              `${type}: ${JSON.stringify(ack)}`,
            );
            return ack.result;
          },
          async input(member, dx, dz) {
            const b = byMember.get(member)!,
              seq = ++b.seq;
            b.room.send("MOVE_INPUT", {
              controllerEpoch: b.epoch,
              seq,
              dx,
              dz,
            });
            inputMessages++;
            await until(
              () => actor.rt.inputs[member]?.seq === seq,
              "MOVE_INPUT received",
            );
          },
          step,
        });
        for (const b of bots) {
          await b.refresh();
          assert.equal(b.world.phase, "LAUNCHED");
          assert.equal(
            canonical(b.world.result),
            canonical(actor.world.result),
          );
          assert.deepEqual(b.storageErrors, []);
        }
        const loaded = await repo.load(actor.id);
        assert.equal(hash(loaded), hash(actor.world));
        const durable = await repo.pool.query(
          "SELECT count(*)::int AS count FROM command_receipts WHERE room_id=$1",
          [actor.id],
        );
        evidence.results.push({
          ...result,
          status: "PASS",
          roomId: actor.id,
          distinctGuests: planned,
          distinctWebSockets: planned,
          inputMessages,
          holdMessages,
          committedBatches,
          durableCommandReceipts: durable.rows[0].count,
          allClientsReceivedLaunch: true,
          durableReloadHashMatches: true,
          completedAt: new Date().toISOString(),
        });
        console.log("NETWORK_FULL_PASS", planned, result.tick);
        save();
      } finally {
        clearInterval(actor.timer);
        await until(() => !actor.busy, "restore scheduler");
        actor.simulationNow = () => performance.now();
        actor.nextTick = performance.now() + 50;
        actor.timer = setInterval(() => void actor.pump(), 50);
        for (const b of bots) await b.room.leave();
        await wait(150);
        await actor.close();
        actors.delete(actor.id);
      }
    }
    evidence.status = "PASS";
    delete evidence.progress;
  } catch (error) {
    evidence.status = "FAIL";
    evidence.error = String((error as Error).stack ?? error);
    console.error("NETWORK_FULL_FAIL", error);
  }
  evidence.completedAt = new Date().toISOString();
  save();
}
