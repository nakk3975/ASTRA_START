import test from "node:test";
import assert from "node:assert/strict";
import { MotionSmoother } from "../apps/web/src/carry/motion.ts";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
import type { MovePacket } from "../packages/carry-core/src/index.ts";

for (const hz of [60, 144, 240, 360]) {
  test(`${hz} Hz movement keeps full distance during 360 ms HTTP round trips`, async () => {
    let now = 0;
    const service = new CarryService(new MemoryCarryStore(), () => now);
    const session = await service.create("refresh", 1);
    const member = session.member;
    const motion = new MotionSmoother();
    let world = session.world;
    motion.receive(world, member, 0);
    const origin = { ...world.players[member].pos };
    let request: { at: number; input: MovePacket } | undefined;
    let response:
      | { at: number; data: Awaited<ReturnType<typeof service.sync>> }
      | undefined;
    let nextSend = 0;
    let previous = { x: 0, z: 0 };
    let control = 0;
    let released: { x: number; z: number } | undefined;
    let final = origin;
    let maxDrift = 0;
    const begin = Math.round(hz * 0.2),
      end = Math.round(hz * 2.6);
    for (let frame = 0; frame <= hz * 7; frame++) {
      now = (frame * 1000) / hz;
      if (request && request.at <= now) {
        response = {
          at: now + 180,
          data: await service.sync(
            session.roomId,
            member,
            session.token,
            request.input,
          ),
        };
        request = undefined;
      }
      if (response && response.at <= now) {
        world = response.data.world;
        motion.receive(world, member, now);
        response = undefined;
      }
      const input = { x: frame >= begin && frame < end ? 1 : 0, z: 0 };
      if (input.x !== previous.x) {
        motion.setInput(input, now);
        previous = input;
        control++;
      }
      final = motion.step(world, member, input, 1 / hz, now);
      if (frame === end) released = { ...final };
      if (released)
        maxDrift = Math.max(
          maxDrift,
          Math.hypot(final.x - released.x, final.z - released.z),
        );
      if (now >= nextSend && !request && !response) {
        request = {
          at: now + 180,
          input: {
            ...input,
            epoch: world.players[member].epoch,
            control,
            frames: motion.packet(now),
          },
        };
        nextSend = now + 80;
      }
    }
    const expected = origin.x + ((end - begin) / hz) * 3.5;
    assert.ok(
      Math.abs(final.x - expected) < 1e-6,
      `lost movement at ${hz} Hz: expected ${expected}, got ${final.x}`,
    );
    assert.ok(maxDrift < 1e-7, `post-release drift ${maxDrift}`);
    const saved = (await service.store.get(session.roomId))!.world.players[
      member
    ].pos;
    assert.ok(
      Math.abs(saved.x - expected) < 1e-6,
      `authority never caught up: ${saved.x}`,
    );
    assert.equal(motion.packet(now).length, 0, "all input is acknowledged");
  });
}

test("transmitted frames stay immutable while new samples and reversals arrive", async () => {
  const service = new CarryService(new MemoryCarryStore(), () => 0);
  const session = await service.create("frames", 1);
  const motion = new MotionSmoother();
  motion.receive(session.world, session.member, 0);
  motion.setInput({ x: 1, z: 0 }, 0);
  const first = motion.packet(10);
  motion.step(session.world, session.member, { x: 1, z: 0 }, 0.01, 20);
  motion.setInput({ x: -1, z: 0 }, 25);
  const next = motion.packet(35);
  assert.deepEqual(next[0], first[0]);
  assert.ok(next.some((f) => f.x === -1));
  assert.ok(next.every((f) => f.dt > 0 && f.dt <= 0.05));
  assert.ok(next.every((f, i) => i === 0 || f.seq === next[i - 1].seq + 1));
});
