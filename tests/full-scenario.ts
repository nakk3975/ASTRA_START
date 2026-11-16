import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  B,
  M,
  ITEMS,
  RECIPES,
  UNIT,
  canonical,
  type Item,
  type Counts,
} from "../packages/content/src/index.ts";
import {
  path,
  geometry,
  count,
  assertInvariants,
  type World,
  type Point,
} from "../packages/game-core/src/index.ts";
export interface EconomyDriver {
  readonly world: World;
  readonly members: string[];
  readonly mode: string;
  command(member: string, type: string, payload: any): Promise<any>;
  step(ticks: number): Promise<void>;
  input(member: string, dx: number, dz: number): Promise<void>;
  checkpoint?(stage: number, world: World): void;
}
export async function exerciseEconomy(driver: EconomyDriver) {
  let w = driver.world;
  const members = driver.members,
    n = members.length;
  const started = performance.now();
  let commands = 0,
    walkTicks = 0;
  const checkpoints: any[] = [];
  async function cmd(m: string, type: string, payload: any = {}) {
    commands++;
    const result = await driver.command(m, type, payload);
    w = driver.world;
    return result;
  }
  async function step(n = 1) {
    await driver.step(n);
    w = driver.world;
  }
  async function move(m: string, goal: Point) {
    if (w.members[m].work)
      await cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
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
        await driver.input(
          m,
          Math.round((dx / Math.max(speed, Math.hypot(dx, dz))) * 1000),
          Math.round((dz / Math.max(speed, Math.hypot(dx, dz))) * 1000),
        );
        await step();
        walkTicks++;
      }
    }
    await driver.input(m, 0, 0);
  }

  async function approach(m: string, id: string) {
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
    await move(m, choices[0]);
  }
  async function putAll(m: string) {
    await approach(m, "shared_warehouse");
    for (const i of ITEMS) {
      const q = count(w.inventories["bag:" + m], i);
      if (q)
        await cmd(m, "TRANSFER_ITEM", {
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
  async function ensure(item: Item, needed: number) {
    assert.ok(needed <= 40);
    while (stock(item) < needed) {
      const deficit = needed - stock(item);
      if (item === "ingot" && autoProcessor) {
        const m = members[0],
          batches = Math.min(10, deficit);
        if (!autoExtraction) {
          await ensure("metal_scrap", batches * 2);
          await approach(m, "shared_warehouse");
          await cmd(m, "TRANSFER_ITEM", {
            from: "shared_warehouse",
            to: "bag:" + m,
            itemId: "metal_scrap",
            quantity: batches * 2,
          });
          await approach(m, autoProcessor);
          await cmd(m, "TRANSFER_ITEM", {
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
            await step(5);
            assert.ok(guard++ < 20000, "auto delivery progress");
          }
        } else {
          let guard = 0;
          while (count(w.inventories[autoProcessor + ":out"], item) < batches) {
            await step(5);
            assert.ok(guard++ < 20000);
          }
          await approach(m, autoProcessor);
          await cmd(m, "TRANSFER_ITEM", {
            from: autoProcessor + ":out",
            to: "bag:" + m,
            itemId: item,
            quantity: batches,
          });
          await putAll(m);
        }
        continue;
      }
      const recipe = RECIPES.find((r) => (B.recipes[r].output as Counts)[item]);
      const m = members[turn++ % n];
      if (!recipe) {
        const src = M.source_zones.find((s) => s.item_id === item)!;
        await move(m, src.manual_service_points[members.indexOf(m) % 6].cell);
        await cmd(m, "WORK_START", { kind: "GATHER", sourceId: src.id });
        let guard = 0;
        while (count(w.inventories["bag:" + m], item) < deficit) {
          await step(5);
          assert.ok(guard++ < 10000);
        }
        await cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
        await putAll(m);
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
        await ensure(i as Item, q * batches);
      await approach(m, "shared_warehouse");
      for (const [i, q] of Object.entries(rec.input))
        await cmd(m, "TRANSFER_ITEM", {
          from: "shared_warehouse",
          to: "bag:" + m,
          itemId: i,
          quantity: q * batches,
        });
      await approach(m, "starter_workbench");
      const channel = "channel:" + m;
      await cmd(m, "SET_MACHINE_RECIPE", {
        entityId: channel,
        recipeId: recipe,
        expectedEntityVersion: w.machines[channel].version,
      });
      for (const [i, q] of Object.entries(rec.input))
        await cmd(m, "TRANSFER_ITEM", {
          from: "bag:" + m,
          to: channel + ":in",
          itemId: i,
          quantity: q * batches,
        });
      await cmd(m, "WORK_START", {
        kind: "MANUAL_CRAFT",
        channelId: channel,
        recipeId: recipe,
      });
      await step(Math.ceil(rec.duration_ticks * 1.5) * batches);
      await cmd(m, "WORK_STOP", { workId: w.members[m].work!.id });
      assert.equal(w.machines[channel].job, null);
      await cmd(m, "TRANSFER_ITEM", {
        from: channel + ":out",
        to: "bag:" + m,
        itemId: item,
        quantity: out * batches,
      });
      await putAll(m);
    }
  }
  async function carryCost(m: string, cost: Counts) {
    let guard = 0;
    do {
      for (const [i, q] of Object.entries(cost)) await ensure(i as Item, q);
      assert.ok(guard++ < 10);
    } while (Object.entries(cost).some(([i, q]) => stock(i as Item) < q));
    await approach(m, "shared_warehouse");
    for (const [i, q] of Object.entries(cost))
      await cmd(m, "TRANSFER_ITEM", {
        from: "shared_warehouse",
        to: "bag:" + m,
        itemId: i,
        quantity: q,
      });
  }
  async function build(
    type: keyof typeof B.machines,
    x: number,
    z: number,
    rotation: number,
  ) {
    const m = members[0];
    await carryCost(m, B.machines[type].paid_cost);
    const pad =
      type === "extractor"
        ? M.source_zones
            .flatMap((s) => s.extractor_pads)
            .find((p) => p.top_left.x === x && p.top_left.z === z)
        : null;
    await move(m, pad ? pad.service_points[0].cell : { x, z: z - 1 });
    const r = await cmd(m, "PLACE_MACHINE", {
      machineType: type,
      x,
      z,
      rotation,
    });
    return r.entityId!;
  }
  async function link(from: string, to: string, item: Item) {
    const m = members[0];
    await carryCost(m, B.delivery.paid_cost_per_link);
    await approach(m, from);
    await cmd(m, "CREATE_LINK", { from, to, itemId: item });
  }
  for (const m of members) await cmd(m, "READY_SET", { ready: true });
  await cmd(members[0], "START_SESSION", { settingsRevision: 0 });
  for (let stage = 0; stage < 6; stage++) {
    for (const [i, q] of Object.entries(w.stages[stage].required)) {
      let left = q;
      while (left) {
        const batch = Math.min(10, left);
        await ensure(i as Item, batch);
        const m = members[turn++ % n];
        await approach(m, "shared_warehouse");
        await cmd(m, "TRANSFER_ITEM", {
          from: "shared_warehouse",
          to: "bag:" + m,
          itemId: i,
          quantity: batch,
        });
        await approach(m, "rocket");
        await cmd(m, "CONTRIBUTE_ROCKET", { itemId: i, quantity: batch });
        left -= batch;
      }
    }
    for (const m of members) await approach(m, "rocket");
    for (const m of members)
      await cmd(m, "WORK_START", {
        kind: "ASSEMBLY",
        stageId: w.stages[stage].id,
      });
    let guard = 0;
    while (w.stage === stage) {
      await step(5);
      assert.ok(guard++ < 3000);
    }
    console.log("FULL_RUN_STAGE", n, stage + 1, w.tick);
    driver.checkpoint?.(stage + 1, w);
    checkpoints.push({
      stage: stage + 1,
      tick: w.tick,
      generated: structuredClone(w.ledger.generated),
      automaticProduced: w.stats.automaticProduced,
      delivered: w.stats.delivered,
    });
    if (stage === 0) {
      autoProcessor = await build("processor", 11, 5, 0);
      await cmd(members[0], "SET_MACHINE_RECIPE", {
        entityId: autoProcessor,
        recipeId: "smelt_ingot",
        expectedEntityVersion: w.machines[autoProcessor].version,
      });
    }
    if (stage === 1) {
      await build("logistics_hub", 16, 5, 0);
      await link(autoProcessor + ":out", "shared_warehouse", "ingot");
      autoDelivery = true;
    }
    if (stage === 2) {
      const pad = M.source_zones[0].extractor_pads[0],
        ext = await build("extractor", pad.top_left.x, pad.top_left.z, 0);
      await link(ext + ":out", autoProcessor + ":in", "metal_scrap");
      autoExtraction = true;
    }
  }
  for (const [i, checkId] of B.construction.inspection_ids.entries()) {
    const m = members[i % n];
    await cmd(m, "WORK_START", { kind: "INSPECTION", checkId });
    await step(B.construction.inspection_ticks_per_check);
  }
  await cmd(members[0], "PROPOSE_LAUNCH");
  for (const m of members)
    await cmd(m, "CAST_VOTE", { voteId: w.vote!.id, yes: true });
  await step(B.launch.countdown_ticks);
  assert.equal(w.phase, "LAUNCHED");
  assert.equal(w.result!.maxPlayers, n);
  assertInvariants(w);
  const frozen = canonical(w);
  await step(100);
  assert.equal(canonical(w), frozen);
  return {
    mode: driver.mode,
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
