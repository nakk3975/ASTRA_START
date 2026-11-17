import test from "node:test";
import assert from "node:assert/strict";
import { MotionSmoother } from "../apps/web/src/carry/motion.ts";
import {
  CarryService,
  MemoryCarryStore,
} from "../packages/carry-core/src/service.ts";
import {
  validFloor,
  floorHeight,
  type V3,
} from "../packages/carry-core/src/index.ts";

for (const hz of [60, 144, 240, 360]) {
  test(`${hz} Hz wall slides and ramp travel converge without release drift under delayed replies`, async () => {
    const cases = [
      {
        name: "ore corner",
        from: { x: -16.3, y: 0, z: -7 },
        input: { x: -1, z: 0.35 },
        seconds: 1.3,
      },
      {
        name: "ramp ascent",
        from: { x: 7.7, y: 0, z: 0 },
        input: { x: 1, z: 0 },
        seconds: 1.35,
      },
      {
        name: "ramp descent",
        from: { x: 12.4, y: 1.2, z: 0 },
        input: { x: -1, z: 0 },
        seconds: 1.35,
      },
    ];
    for (const fixture of cases) {
      let now = 0;
      const svc = new CarryService(new MemoryCarryStore(), () => now);
      const s = await svc.create("collision", 1);
      await svc.update(s.roomId, (row) => {
        row.world.players[s.member].pos = fixture.from;
      });
      let w = (await svc.store.get(s.roomId))!.world;
      const m = new MotionSmoother();
      m.receive(w, s.member, 0);
      let pending: {
        at: number;
        result: Awaited<ReturnType<typeof svc.sync>>;
      }[] = [];
      let revision = -1,
        last = fixture.from,
        stopped: V3 | undefined;
      for (let frame = 0; frame < hz * 4; frame++) {
        now = (frame * 1000) / hz;
        for (const reply of pending.filter((r) => r.at <= now)) {
          if (reply.result.revision > revision) {
            revision = reply.result.revision;
            w = reply.result.world;
            m.receive(w, s.member, now);
          }
        }
        pending = pending.filter((r) => r.at > now);
        const moving = frame < hz * fixture.seconds;
        const input = moving ? fixture.input : { x: 0, z: 0 };
        m.setInput(input, now);
        last = m.step(w, s.member, input, 1 / hz, now);
        assert.ok(
          validFloor(w, last),
          `${fixture.name}: prediction entered a wall`,
        );
        assert.ok(
          Math.abs(last.y - floorHeight(last.x, last.z)) < 1e-7,
          `${fixture.name}: floor height mismatch`,
        );
        if (!moving) {
          stopped ??= last;
          assert.ok(
            Math.hypot(
              last.x - stopped.x,
              last.y - stopped.y,
              last.z - stopped.z,
            ) < 1e-7,
            `${fixture.name}: movement after key release`,
          );
        }
        if (frame % Math.round(hz / 10) === 0) {
          pending.push({
            at: now + 300,
            result: await svc.sync(s.roomId, s.member, s.token, {
              ...input,
              control: moving ? 1 : 2,
              epoch: s.world.players[s.member].epoch,
              frames: m.packet(now),
            }),
          });
        }
      }
      const authority = (await svc.store.get(s.roomId))!.world.players[s.member]
        .pos;
      assert.ok(
        Math.hypot(
          last.x - authority.x,
          last.y - authority.y,
          last.z - authority.z,
        ) < 1e-7,
        `${fixture.name}: display failed to converge to server`,
      );
      assert.equal(m.packet(now).length, 0);
    }
  });
}
