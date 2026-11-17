import { Room, type Client } from "@colyseus/core";
import type { CarryService } from "../../../../packages/carry-core/src/service.ts";
import type {
  Command,
  MovePacket,
} from "../../../../packages/carry-core/src/index.ts";
export let carryService: CarryService;
export const bindCarry = (s: CarryService) => {
  carryService = s;
};
export class CarryRoom extends Room {
  maxClients = 7;
  worldId = "";
  controls = new Map<
    string,
    {
      member: string;
      token: string;
      epoch: number;
      input: MovePacket;
      lastInput: number;
      lastCommand: number;
    }
  >();
  busy = false;
  onCreate(options: { worldId: string }) {
    this.worldId = options.worldId;
    this.setSimulationInterval(() => {
      if (!this.clients.length || this.busy) return;
      this.busy = true;
      void carryService
        .pulse(this.worldId)
        .then((s) => this.broadcast("WORLD", s))
        .catch(() => this.broadcast("STORAGE_ERROR", {}))
        .finally(() => {
          this.busy = false;
        });
    }, 100);
    this.onMessage("INPUT", async (c, raw) => {
      const ctl = this.controls.get(c.sessionId);
      if (!ctl || !raw || typeof raw !== "object") return;
      if (
        Date.now() - ctl.lastInput < 30 &&
        raw.x === ctl.input.x &&
        raw.z === ctl.input.z &&
        !raw.frames?.length
      )
        return;
      ctl.lastInput = Date.now();
      try {
        if (
          !Number.isFinite(raw.x) ||
          !Number.isFinite(raw.z) ||
          Math.abs(raw.x) > 1 ||
          Math.abs(raw.z) > 1
        )
          throw Error("잘못된 이동 입력");
        if (JSON.stringify(raw).length > 6500)
          throw Error("이동 입력 크기 초과");
        if ((raw.control ?? 0) >= (ctl.input.control ?? 0))
          ctl.input = { ...raw, epoch: ctl.epoch };
        await carryService.sync(this.worldId, ctl.member, ctl.token, {
          ...raw,
          epoch: ctl.epoch,
        });
      } catch (e) {
        c.send("ERROR", { message: (e as Error).message });
      }
    });
    this.onMessage("COMMAND", async (c, cmd: Command) => {
      const ctl = this.controls.get(c.sessionId);
      if (!ctl || Date.now() - ctl.lastCommand < 80) return;
      ctl.lastCommand = Date.now();
      try {
        if (JSON.stringify(cmd).length > 2000) throw Error("명령 크기 초과");
        const r = await carryService.sync(
          this.worldId,
          ctl.member,
          ctl.token,
          { ...ctl.input, epoch: ctl.epoch },
          cmd,
        );
        c.send("ACK", r);
        this.broadcast("WORLD", r);
      } catch (e) {
        c.send("ERROR", { message: (e as Error).message });
      }
    });
  }
  async onAuth(_c: Client, o: any) {
    const s = await carryService.store.get(this.worldId);
    if (!s) throw Error("작업장을 찾지 못했습니다.");
    await carryService.auth(s, String(o.member), String(o.token));
    return { member: String(o.member), token: String(o.token) };
  }
  async onJoin(c: Client, _o: any, auth: { member: string; token: string }) {
    const r = await carryService.resume(this.worldId, auth.member, auth.token);
    for (const old of this.clients) {
      if (old !== c && this.controls.get(old.sessionId)?.member === auth.member)
        old.leave(4011);
    }
    this.controls.set(c.sessionId, {
      ...auth,
      epoch: r.result,
      input: { x: 0, z: 0, epoch: r.result },
      lastInput: 0,
      lastCommand: 0,
    });
    c.send("WELCOME", r);
  }
  async onLeave(c: Client) {
    const ctl = this.controls.get(c.sessionId);
    this.controls.delete(c.sessionId);
    if (ctl)
      await carryService.leave(this.worldId, ctl.member, ctl.token, ctl.epoch);
  }
}
