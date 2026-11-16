import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  B,
  M,
  R,
  ITEMS,
  RECIPES,
  UNIT,
  canonical,
  type Item,
  type Counts,
} from "../packages/content/src/index.ts";
import {
  createWorld,
  join,
  command,
  tick,
  path,
  geometry,
  count,
  center,
  assertInvariants,
  type World,
  type Runtime,
  type Point,
} from "../packages/game-core/src/index.ts";
export function fullCoreRun(n: number) {
  let w = createWorld(randomUUID(), "Full economy " + n, "FULLTEST", n, "test");
  const rt: Runtime = { now: 0, wallNow: 0, inputs: {} };
  const members = Array.from(
    { length: n },
    (_, i) => join(w, randomUUID(), "작업자" + (i + 1), 0).id,
  );
  const started = performance.now();
  let commands = 0,
    walkTicks = 0;
  const checkpoints: any[] = [];
  function cmd(m: string, type: string, payload: any = {}) {
    commands++;
    const r = command(
      w,
      m,
      {
        protocolVersion: R.protocol_version,
        roomId: w.id,
        commandId: randomUUID(),
        controllerEpoch: w.members[m].epoch,
        clientSeq: commands,
        minDurableVersion: w.version,
        type,
        payload,
      },
      rt,
    );
    assert.equal(
      r.error,
      undefined,
      `${type} ${JSON.stringify(payload)}: ${r.error}`,
    );
    w = r.world;
    return r.result;
  }
  function step(n = 1) {
    for (let k = 0; k < n; k++) {
      rt.now += 50;
      rt.wallNow += 50;
      for (const m of members) {
        const old = rt.inputs[m] ?? {
          dx: 0,
          dz: 0,
          seq: 0,
          at: 0,
          hold: null,
          holdAt: 0,
        };
        rt.inputs[m] = {
          ...old,
          at: rt.now,
          hold: w.members[m].work?.id ?? null,
          holdAt: rt.now,
        };
      }
      tick(w, rt);
    }
  }
  function move(m: string, goal: Point) {
    if (w.members[m].work)
      cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
    const route = path(w, w.members[m].position, goal);
    assert.ok(
      route.length ||
        Math.hypot(
          w.members[m].position.x / UNIT - goal.x - 0.5,
          w.members[m].position.z / UNIT - goal.z - 0.5,
        ) < 1,
      "path reachable",
    );
    for (const p of route) {
      let guard = 0;
      while (
        Math.hypot(
          w.members[m].position.x - p.x,
          w.members[m].position.z - p.z,
        ) > 60
      ) {
        assert.ok(guard++ < 30, "movement progress");
        const pos = w.members[m].position,
          dx = p.x - pos.x,
          dz = p.z - pos.z,
          speed = B.player.base_move_tiles_per_second * UNIT * 0.05;
        rt.inputs[m] = {
          dx: Math.round((dx / Math.max(speed, Math.hypot(dx, dz))) * 1000),
          dz: Math.round((dz / Math.max(speed, Math.hypot(dx, dz))) * 1000),
          seq: commands,
          at: rt.now,
          hold: null,
          holdAt: 0,
        };
        step();
        walkTicks++;
      }
    }
    rt.inputs[m] = {
      dx: 0,
      dz: 0,
      seq: commands,
      at: rt.now,
      hold: null,
      holdAt: 0,
    };
  }
  function approach(m: string, id: string) {
    const g = geometry(w, id);
    const choices = g.service_points
      .map((s) => s.cell)
      .sort(
        (a, b) =>
          Math.hypot(
            a.x - w.members[m].position.x / UNIT,
            a.z - w.members[m].position.z / UNIT,
          ) -
          Math.hypot(
            b.x - w.members[m].position.x / UNIT,
            b.z - w.members[m].position.z / UNIT,
          ),
      );
    move(m, choices[0]);
  }
  function putAll(m: string) {
    approach(m, "shared_warehouse");
    for (const i of ITEMS) {
      const q = count(w.inventories["bag:" + m], i);
      if (q)
        cmd(m, "TRANSFER_ITEM", {
          from: "bag:" + m,
          to: "shared_warehouse",
          itemId: i,
          quantity: q,
        });
    }
  }
  const stock = (i: Item) => count(w.inventories.shared_warehouse, i);
  let autoProcessor = "",
    autoDelivery = false,
    autoExtraction = false;
  let turn = 0;
  function ensure(item: Item, needed: number) {
    assert.ok(needed <= 40);
    while (stock(item) < needed) {
      const deficit = needed - stock(item);
      if (item === "ingot" && autoProcessor) {
        const m = members[0],
          batches = Math.min(10, deficit);
        if (!autoExtraction) {
          ensure("metal_scrap", batches * 2);
          approach(m, "shared_warehouse");
          cmd(m, "TRANSFER_ITEM", {
            from: "shared_warehouse",
            to: "bag:" + m,
            itemId: "metal_scrap",
            quantity: batches * 2,
          });
          approach(m, autoProcessor);
          cmd(m, "TRANSFER_ITEM", {
            from: "bag:" + m,
            to: autoProcessor + ":in",
            itemId: "metal_scrap",
            quantity: batches * 2,
          });
        }
        if (autoDelivery) {
          let guard = 0;
          const goal = stock(item) + batches;
          while (stock(item) < goal) {
            step();
            assert.ok(guard++ < 20000, "auto delivery progress");
          }
        } else {
          let guard = 0;
          while (count(w.inventories[autoProcessor + ":out"], item) < batches) {
            step();
            assert.ok(guard++ < 20000);
          }
          approach(m, autoProcessor);
          cmd(m, "TRANSFER_ITEM", {
            from: autoProcessor + ":out",
            to: "bag:" + m,
            itemId: item,
            quantity: batches,
          });
          putAll(m);
        }
        continue;
      }
      const recipe = RECIPES.find((r) => (B.recipes[r].output as Counts)[item]);
      const m = members[turn++ % n];
      if (!recipe) {
        const src = M.source_zones.find((s) => s.item_id === item)!;
        move(m, src.manual_service_points[members.indexOf(m) % 6].cell);
        cmd(m, "WORK_START", { kind: "GATHER", sourceId: src.id });
        let guard = 0;
        while (count(w.inventories["bag:" + m], item) < deficit) {
          step();
          assert.ok(guard++ < 10000);
        }
        cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
        putAll(m);
        continue;
      }
      const rec = B.recipes[recipe],
        out = (rec.output as Counts)[item]!,
        batches = Math.min(
          Math.ceil(deficit / out),
          Math.floor(20 / out),
          ...Object.values(rec.input).map((q) => Math.floor(20 / q)),
        );
      for (const [i, q] of Object.entries(rec.input))
        ensure(i as Item, q * batches);
      approach(m, "shared_warehouse");
      for (const [i, q] of Object.entries(rec.input))
        cmd(m, "TRANSFER_ITEM", {
          from: "shared_warehouse",
          to: "bag:" + m,
          itemId: i,
          quantity: q * batches,
        });
      approach(m, "starter_workbench");
      const channel = "channel:" + m;
      cmd(m, "SET_MACHINE_RECIPE", {
        entityId: channel,
        recipeId: recipe,
        expectedEntityVersion: w.machines[channel].version,
      });
      for (const [i, q] of Object.entries(rec.input))
        cmd(m, "TRANSFER_ITEM", {
          from: "bag:" + m,
          to: channel + ":in",
          itemId: i,
          quantity: q * batches,
        });
      cmd(m, "WORK_START", {
        kind: "MANUAL_CRAFT",
        channelId: channel,
        recipeId: recipe,
      });
      step(Math.ceil(rec.duration_ticks * 1.5) * batches);
      cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
      assert.equal(w.machines[channel].job, null);
      cmd(m, "TRANSFER_ITEM", {
        from: channel + ":out",
        to: "bag:" + m,
        itemId: item,
        quantity: out * batches,
      });
      putAll(m);
    }
  }
  function carryCost(m: string, cost: Counts) {
    let guard = 0;
    do {
      for (const [i, q] of Object.entries(cost)) ensure(i as Item, q);
      assert.ok(guard++ < 10);
    } while (Object.entries(cost).some(([i, q]) => stock(i as Item) < q));
    approach(m, "shared_warehouse");
    for (const [i, q] of Object.entries(cost))
      cmd(m, "TRANSFER_ITEM", {
        from: "shared_warehouse",
        to: "bag:" + m,
        itemId: i,
        quantity: q,
      });
  }
  function build(
    type: keyof typeof B.machines,
    x: number,
    z: number,
    rotation: number,
  ) {
    const m = members[0];
    carryCost(m, B.machines[type].paid_cost);
    const pad =
      type === "extractor"
        ? M.source_zones
            .flatMap((s) => s.extractor_pads)
            .find((p) => p.top_left.x === x && p.top_left.z === z)
        : null;
    move(m, pad ? pad.service_points[0].cell : { x, z: z - 1 });
    const r = cmd(m, "PLACE_MACHINE", { machineType: type, x, z, rotation });
    return r.entityId!;
  }
  function link(from: string, to: string, item: Item) {
    const m = members[0];
    carryCost(m, B.delivery.paid_cost_per_link);
    approach(m, from);
    cmd(m, "CREATE_LINK", { from, to, itemId: item });
  }
  for (const m of members) cmd(m, "READY_SET", { ready: true });
  cmd(members[0], "START_SESSION", { settingsRevision: 0 });
  for (let stage = 0; stage < 6; stage++) {
    for (const [i, q] of Object.entries(w.stages[stage].required)) {
      let left = q;
      while (left) {
        const batch = Math.min(10, left);
        ensure(i as Item, batch);
        const m = members[turn++ % n];
        approach(m, "shared_warehouse");
        cmd(m, "TRANSFER_ITEM", {
          from: "shared_warehouse",
          to: "bag:" + m,
          itemId: i,
          quantity: batch,
        });
        approach(m, "rocket");
        cmd(m, "CONTRIBUTE_ROCKET", { itemId: i, quantity: batch });
        left -= batch;
      }
    }
    for (const m of members) approach(m, "rocket");
    for (const m of members)
      cmd(m, "WORK_START", { kind: "ASSEMBLY", stageId: w.stages[stage].id });
    let guard = 0;
    while (w.stage === stage) {
      step();
      assert.ok(guard++ < 3000);
    }
    checkpoints.push({
      stage: stage + 1,
      tick: w.tick,
      generated: structuredClone(w.ledger.generated),
      automaticProduced: w.stats.automaticProduced,
      delivered: w.stats.delivered,
    });
    if (stage === 0) {
      autoProcessor = build("processor", 11, 5, 0);
      cmd(members[0], "SET_MACHINE_RECIPE", {
        entityId: autoProcessor,
        recipeId: "smelt_ingot",
        expectedEntityVersion: w.machines[autoProcessor].version,
      });
    }
    if (stage === 1) {
      build("logistics_hub", 16, 5, 0);
      link(autoProcessor + ":out", "shared_warehouse", "ingot");
      autoDelivery = true;
    }
    if (stage === 2) {
      const pad = M.source_zones[0].extractor_pads[0],
        ext = build("extractor", pad.top_left.x, pad.top_left.z, 0);
      link(ext + ":out", autoProcessor + ":in", "metal_scrap");
      autoExtraction = true;
    }
  }
  for (const [i, checkId] of B.construction.inspection_ids.entries()) {
    const m = members[i % n];
    cmd(m, "WORK_START", { kind: "INSPECTION", checkId });
    step(B.construction.inspection_ticks_per_check);
  }
  cmd(members[0], "PROPOSE_LAUNCH");
  for (const m of members)
    cmd(m, "CAST_VOTE", { voteId: w.vote!.id, yes: true });
  step(B.launch.countdown_ticks);
  assert.equal(w.phase, "LAUNCHED");
  assert.equal(w.result!.maxPlayers, n);
  assertInvariants(w);
  const frozen = canonical(w);
  step(100);
  assert.equal(canonical(w), frozen);
  return {
    mode: "CORE_SIMULATION_NOT_BROWSER_OR_NETWORK",
    planned: n,
    connectedMembers: n,
    resourceInjection: false,
    teleportation: false,
    normalBalance: true,
    automation: {
      processor: autoProcessor,
      paidMachines: Object.values(w.machines).filter(
        (m) => m.type !== "channel",
      ).length,
      links: Object.keys(w.links).length,
      extractor: autoExtraction,
      automaticProduced: w.stats.automaticProduced,
      delivered: w.stats.delivered,
    },
    tick: w.tick,
    simulatedMinutes: (Number(w.tick) * 0.05) / 60,
    wallMilliseconds: Math.round(performance.now() - started),
    commands,
    walkTicks,
    checkpoints,
    result: w.result,
    finalHash: createHash("sha256").update(canonical(w)).digest("hex"),
  };
}
if (process.argv[1]?.endsWith("full-run.ts")) {
  mkdirSync("docs/qa/evidence", { recursive: true });
  const results = [1, 6].map((n) => {
    const r = fullCoreRun(n);
    console.log(JSON.stringify(r));
    return r;
  });
  writeFileSync(
    "docs/qa/evidence/core-full-runs.json",
    JSON.stringify({ executedAt: new Date().toISOString(), results }, null, 2),
  );
}
