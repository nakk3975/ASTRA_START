import test from "node:test";
import assert from "node:assert/strict";
import { moveInPlayground } from "../apps/web/src/visuals/playground.ts";
import { reviewReady } from "../apps/web/src/visuals/review-state.ts";
import { B } from "../packages/content/src/index.ts";

test("preview walking maps screen directions and keeps diagonal speed normalized", () => {
  const start = { x: 20, z: 20 };
  const right = moveInPlayground(start, { x: 1, z: 0 }, 0.1);
  assert.ok(right.x > start.x && right.z < start.z);
  const diagonal = moveInPlayground(start, { x: 1, z: 1 }, 0.1);
  assert.ok(
    Math.abs(
      Math.hypot(diagonal.x - start.x, diagonal.z - start.z) -
        B.player.base_move_tiles_per_second * 0.1,
    ) < 1e-8,
  );
  assert.deepEqual(moveInPlayground(start, { x: 0, z: 0 }, 0.1), start);
  assert.deepEqual(start, { x: 20, z: 20 });
});

test("preview stops at the boundary and selected large model, without jumping after a hidden tab", () => {
  const boundary = { x: 32, z: 22 };
  assert.deepEqual(moveInPlayground(boundary, { x: 1, z: 1 }, 0.1), boundary);
  const front = { x: 23, z: 19.2 };
  assert.deepEqual(
    moveInPlayground(front, { x: 1, z: -1 }, 0.1, { x: 4.6, z: 5.6 }),
    front,
  );
  assert.deepEqual(moveInPlayground(front, { x: 1, z: -1 }, 1), front);
  assert.deepEqual(moveInPlayground(front, { x: 1, z: -1 }, NaN), front);
});

test("changing the selected model cannot record stale review measurements", () => {
  const settings = {
    size: [1366, 768],
    low: false,
    clip: "idle",
    count: 1,
    rotation: 0,
    assetId: "refinery",
  };
  const metrics = {
    webgl: true,
    loaded: true,
    css: settings.size,
    quality: "standard",
    review: { clip: "idle", count: 1, rotation: 0, assetId: "processor" },
  };
  assert.equal(reviewReady(metrics, settings), false);
  assert.equal(
    reviewReady(
      { ...metrics, review: { ...metrics.review, assetId: "refinery" } },
      settings,
    ),
    true,
  );
});
