import { Room, type Client } from "@colyseus/core";
import { performance } from "node:perf_hooks";
import { R } from "../../../packages/content/src/index.ts";
import { join, leave, visible } from "../../../packages/game-core/src/index.ts";
import {
  parseCommand,
  moveSchema,
  holdSchema,
  safeShape,
} from "../../../packages/protocol/src/index.ts";
import { Actor } from "./actor.ts";
import { GameState, publishSchema, StateView } from "./schema.ts";
export type Ticket = {
  guest: string;
  name: string;
  room: string;
  expires: number;
};
export const tickets = new Map<string, Ticket>();
export const actors = new Map<string, Actor>();
export let openActor: (id: string) => Promise<Actor>;
export const bindActors = (fn: typeof openActor) => {
  openActor = fn;
};
type Control = {
  member: string;
  epoch: number;
  ready: boolean;
  congestedSince?: number;
  tokens: Record<string, { n: number; t: number }>;
};
export class OrbitRoom extends Room<{ state: GameState }> {
  state = new GameState();
  autoDispose = false;
  patchRate = null;
  maxClients = R.world.max_players + 1;
  actor!: Actor;
  idleTimer?: ReturnType<typeof setTimeout>;
  controls = new Map<string, Control>();
  async onCreate(options: { worldId: string }) {
    this.actor = await openActor(options.worldId);
    publishSchema(this.state, this.actor.world, this.actor.epoch);
    this.actor.onPublish = (w) => {
      publishSchema(this.state, w, this.actor.epoch);
      for (const c of this.clients) {
        const ctl = this.controls.get(c.sessionId);
        const queued = (c.ref as any).bufferedAmount ?? 0;
        if (ctl) {
          if (queued > R.limits.outbound_soft_limit_bytes)
            ctl.congestedSince ??= Date.now();
          else ctl.congestedSince = undefined;
          if (
            queued > R.limits.outbound_hard_limit_bytes ||
            (ctl.congestedSince &&
              Date.now() - ctl.congestedSince >
                R.timers_ms.backpressure_persistent_limit)
          ) {
            c.leave(4009, "RESYNC_REQUIRED");
            continue;
          }
        }
        const p = ctl && this.state.privateData.get(ctl.member);
        if (p) {
          c.view ??= new StateView();
          c.view.add(p);
        }
      }
      this.broadcastPatch();
    };
    this.actor.onPending = (code) =>
      this.broadcast("STORAGE_PENDING", { code });
    this.onMessage("STATE_READY", (c) => {
      const ctl = this.controls.get(c.sessionId);
      if (ctl) ctl.ready = true;
    });
    this.onMessage("COMMAND", async (c, raw) => {
      try {
        const ctl = this.control(c);
        this.rate(ctl, "economic_commands");
        if (
          !safeShape(raw) ||
          Buffer.byteLength(JSON.stringify(raw)) > R.limits.client_message_bytes
        )
          throw Error("BAD_PAYLOAD");
        const cmd = parseCommand(raw);
        if (cmd.roomId !== this.actor.id) throw Error("BAD_PAYLOAD");
        const ack = await this.actor.enqueue(ctl.member, cmd);
        c.send("COMMAND_ACK", ack);
      } catch (e) {
        c.send("COMMAND_ERROR", {
          commandId: raw?.commandId,
          accepted: false,
          code: (e as Error).message.includes('"')
            ? "BAD_PAYLOAD"
            : (e as Error).message,
        });
      }
    });
    this.onMessage("MOVE_INPUT", (c, raw) => {
      try {
        const ctl = this.control(c);
        this.rate(ctl, "movement_and_hold");
        const p = moveSchema.parse(raw);
        if (p.controllerEpoch !== ctl.epoch) throw Error("SESSION_REPLACED");
        const input = this.actor.rt.inputs[ctl.member] ?? {
          dx: 0,
          dz: 0,
          seq: -1,
          at: 0,
          hold: null,
          holdAt: 0,
        };
        if (p.seq <= input.seq) return;
        this.actor.rt.inputs[ctl.member] = {
          ...input,
          ...p,
          at: performance.now(),
        };
      } catch {}
    });
    this.onMessage("WORK_HOLD", (c, raw) => {
      try {
        const ctl = this.control(c);
        this.rate(ctl, "movement_and_hold");
        const p = holdSchema.parse(raw);
        if (p.controllerEpoch !== ctl.epoch) throw Error("SESSION_REPLACED");
        const input = this.actor.rt.inputs[ctl.member] ?? {
          dx: 0,
          dz: 0,
          seq: -1,
          at: 0,
          hold: null,
          holdAt: 0,
        };
        this.actor.rt.inputs[ctl.member] = {
          ...input,
          hold: p.workId,
          holdAt: performance.now(),
        };
      } catch {}
    });
    this.onMessage("REQUEST_FULL_STATE", (c) => {
      try {
        const ctl = this.control(c, false);
        this.rate(ctl, "status_queries");
        c.send("FULL_STATE", {
          world: visible(this.actor.world, ctl.member),
          writerEpoch: this.actor.epoch,
        });
      } catch {}
    });
    this.onMessage("COMMAND_STATUS_QUERY", async (c, raw) => {
      try {
        const ctl = this.control(c);
        this.rate(ctl, "status_queries");
        if (
          !Array.isArray(raw?.ids) ||
          raw.ids.length > R.limits.command_status_query_ids
        )
          throw Error("BAD_PAYLOAD");
        const results = [];
        for (const id of raw.ids) {
          if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
            throw Error("BAD_PAYLOAD");
          results.push({
            id,
            receipt:
              (await this.actor.repo.receipt(this.actor.id, ctl.member, id))
                ?.outcome ?? null,
          });
        }
        c.send("COMMAND_STATUS", { results });
      } catch (e) {
        c.send("COMMAND_ERROR", { code: (e as Error).message });
      }
    });
  }
  onAuth(_c: Client, options: any) {
    const ticket = tickets.get(options?.ticket);
    if (!ticket || ticket.room !== this.actor.id || ticket.expires < Date.now())
      throw Error("INVALID_TICKET");
    tickets.delete(options.ticket);
    return ticket;
  }
  async onJoin(c: Client, _options: any, auth: Ticket) {
    clearTimeout(this.idleTimer);
    const member = await this.actor.mutate((w) =>
      join(w, auth.guest, auth.name, Date.now()),
    );
    for (const old of this.clients) {
      const ctl = this.controls.get(old.sessionId);
      if (old !== c && ctl?.member === member.id) {
        old.send("SESSION_REPLACED", {});
        old.leave(4011);
      }
    }
    const ctl = {
      member: member.id,
      epoch: member.epoch,
      ready: false,
      tokens: {},
    };
    this.controls.set(c.sessionId, ctl);
    c.view = new StateView();
    const p = this.state.privateData.get(member.id);
    if (p) c.view.add(p);
    c.send("WELCOME", {
      memberId: member.id,
      controllerEpoch: member.epoch,
      protocolVersion: R.protocol_version,
      contentVersion: R.content_version,
      writerEpoch: this.actor.epoch,
      durableVersion: this.actor.world.version,
      simTick: this.actor.world.tick,
      roomId: this.actor.id,
    });
  }
  async onLeave(c: Client, code?: number) {
    const ctl = this.controls.get(c.sessionId);
    this.controls.delete(c.sessionId);
    if (ctl && this.actor.world.members[ctl.member]?.epoch === ctl.epoch) {
      delete this.actor.rt.inputs[ctl.member];
      await this.actor.mutate((w) =>
        leave(w, ctl.member, Date.now(), code === 4000),
      );
    }
    if (!this.clients.length) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        if (!this.clients.length) void this.disconnect();
      }, R.timers_ms.manual_channel_retention_max + 1000);
    }
  }
  async onDispose() {
    clearTimeout(this.idleTimer);
    await this.actor.close();
    actors.delete(this.actor.id);
  }
  control(c: Client, requireReady = true) {
    const ctl = this.controls.get(c.sessionId);
    if (!ctl || this.actor.world.members[ctl.member]?.epoch !== ctl.epoch)
      throw Error("SESSION_REPLACED");
    if (requireReady && !ctl.ready) throw Error("STATE_NOT_READY");
    return ctl;
  }
  rate(c: Control, key: keyof typeof R.rate_limits) {
    const rule = R.rate_limits[key];
    if (typeof rule === "number") return;
    const now = performance.now(),
      token = c.tokens[key] ?? { n: rule.burst, t: now };
    token.n = Math.min(
      rule.burst,
      token.n + ((now - token.t) / 1000) * rule.per_second,
    );
    token.t = now;
    c.tokens[key] = token;
    if (token.n < 1) throw Error("RATE_LIMITED");
    token.n--;
  }
}
