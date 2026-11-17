import type { Application } from "express";
import { matchMaker } from "@colyseus/core";
import { carryService } from "./room.ts";
const rooms = new Map<string, Promise<string>>();
export function mountCarry(app: Application) {
  const buckets = new Map<string, { at: number; n: number }>();
  app.post("/api/carry/:action", async (req, res) => {
    try {
      const actionType = String(req.params.action),
        key =
          String(req.ip) +
          (["join", "create"].includes(actionType) ? ":entry" : ":play"),
        now = Date.now();
      for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
      let b = buckets.get(key);
      if (!b) {
        b = { at: now, n: 0 };
        buckets.set(key, b);
      }
      if (++b.n > (key.endsWith(":entry") ? 30 : 2400))
        throw Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      const body = req.body ?? {},
        action = req.params.action;
      let data: any;
      if (action === "create")
        data = await carryService.create(body.name, body.planned, body.profile, body.avatar);
      else if (action === "join")
        data = await carryService.join(String(body.code), body.name, body.avatar);
      else if (action === "resume")
        data = await carryService.resume(body.id, body.member, body.token);
      else if (action === "sync")
        data = await carryService.sync(
          body.id,
          body.member,
          body.token,
          body.input,
          body.command,
        );
      else if (action === "leave")
        data = await carryService.leave(
          body.id,
          body.member,
          body.token,
          body.epoch,
        );
      else if (action === "runtime") {
        const row = await carryService.store.get(body.id);
        if (!row) throw Error("작업장을 찾지 못했습니다.");
        await carryService.auth(row, body.member, body.token);
        let job = rooms.get(body.id);
        if (job) {
          const previous = await job;
          const found = await matchMaker.query({ roomId: previous });
          if (!found.length) {
            rooms.delete(body.id);
            job = undefined;
          }
        }
        if (!job) {
          job = matchMaker
            .createRoom("carry", { worldId: body.id })
            .then((r) => r.roomId)
            .catch((e) => {
              rooms.delete(body.id);
              throw e;
            });
          rooms.set(body.id, job);
        }
        data = { runtimeRoomId: await job };
      } else throw Error("알 수 없는 요청입니다.");
      res.json({ ...data, transport: "colyseus" });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
}
