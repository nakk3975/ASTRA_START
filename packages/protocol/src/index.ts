import { z } from "zod";
import { R, B, ITEMS, RECIPES } from "../../content/src/index.ts";
const id = z.string().min(1).max(R.limits.client_string_max_length),
  int = z.number().int().nonnegative().max(B.limits.integer_quantity_max),
  quantity = int.min(1).max(B.limits.player_command_quantity_max),
  item = z.enum(ITEMS as [(typeof ITEMS)[number], ...(typeof ITEMS)[number][]]);
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const version = { expectedEntityVersion: int };
export const payloads: Record<string, z.ZodType> = {
  READY_SET: object({ ready: z.boolean() }),
  START_SESSION: object({ settingsRevision: int }),
  SET_LOBBY_SETTINGS: object({
    plannedPlayers: z.number().int().min(1).max(R.world.max_players),
  }),
  SET_ROOM_PAUSE: object({ paused: z.boolean() }),
  CLAIM_LEADER: object({}),
  WORK_START: z.discriminatedUnion("kind", [
    object({ kind: z.literal("GATHER"), sourceId: id }),
    object({
      kind: z.literal("MANUAL_CRAFT"),
      channelId: id,
      recipeId: z.enum(RECIPES as [string, ...string[]]),
    }),
    object({ kind: z.literal("ASSEMBLY"), stageId: id }),
    object({
      kind: z.literal("INSPECTION"),
      checkId: z.enum(B.construction.inspection_ids as [string, ...string[]]),
    }),
  ] as any),
  WORK_STOP: object({ workId: id }),
  TRANSFER_ITEM: object({ from: id, to: id, itemId: item, quantity }),
  TAKE_MAX: object({ from: id, to: id, itemId: item, quantity }),
  STASH_OVERFLOW: object({ itemId: item, quantity }),
  SET_MACHINE_RECIPE: object({
    entityId: id,
    recipeId: z.enum(RECIPES as [string, ...string[]]),
    ...version,
  }),
  SET_MACHINE_ENABLED: object({
    entityId: id,
    enabled: z.boolean(),
    ...version,
  }),
  CANCEL_JOB: object({ entityId: id, ...version }),
  PLACE_MACHINE: object({
    machineType: z.enum(
      Object.keys(B.machines).filter((k) => k !== "manual_workbench") as [
        string,
        ...string[],
      ],
    ),
    x: int,
    z: int,
    rotation: z.number().int().min(0).max(3),
  }),
  MOVE_MACHINE: object({
    entityId: id,
    x: int,
    z: int,
    rotation: z.number().int().min(0).max(3),
    ...version,
  }),
  DISMANTLE_MACHINE: object({ entityId: id, ...version }),
  UPGRADE_MACHINE: object({
    entityId: id,
    upgradeId: z.enum(["machine_mk2", "extractor_mk2"]),
    ...version,
  }),
  UPGRADE_PLAYER: object({
    upgradeId: z.enum(["carry_tier_1", "carry_tier_2", "move_tier_1"]),
  }),
  CREATE_LINK: object({ from: id, to: id, itemId: item }),
  DRAIN_LINK: object({ entityId: id, ...version }),
  EDIT_LINK: object({
    entityId: id,
    from: id,
    to: id,
    itemId: item,
    ...version,
  }),
  REMOVE_LINK: object({ entityId: id, ...version }),
  CONTRIBUTE_ROCKET: object({ itemId: item, quantity }),
  PROPOSE_LAUNCH: object({}),
  CAST_VOTE: object({ voteId: id, yes: z.boolean() }),
  CANCEL_LAUNCH: object({ attemptId: id }),
  SAVE_BARRIER: object({}),
  ROTATE_ROOM_CODE: object({}),
  ROTATE_RECOVERY_KEY: object({}),
  TRANSFER_OWNERSHIP: object({ targetMemberId: id }),
  ACCEPT_OWNERSHIP: object({ offerId: id }),
  DELETE_SAVED_ROOM: object({ code: id, version: z.string().regex(/^\d+$/) }),
  PING: object({ targetId: id }),
};
export const envelope = z
  .object({
    protocolVersion: z.literal(R.protocol_version),
    roomId: z.string().uuid(),
    commandId: z.string().uuid(),
    controllerEpoch: int,
    clientSeq: int,
    minDurableVersion: z.string().regex(/^\d+$/),
    type: id,
    payload: z.unknown(),
  })
  .strict();
export type Command = z.infer<typeof envelope> & { payload: any };
export type Ack = {
  commandId: string;
  status: "APPLIED" | "REJECTED";
  durableVersion: string;
  writerEpoch: string;
  appliedTick: string;
  result?: Record<string, unknown>;
  error?: { code: string };
};
export function parseCommand(raw: unknown): Command {
  const c = envelope.parse(raw);
  const schema = payloads[c.type];
  if (!schema) throw Error("BAD_PAYLOAD");
  return { ...c, payload: schema.parse(c.payload) };
}
export const moveSchema = object({
  dx: z.number().int().min(-1000).max(1000),
  dz: z.number().int().min(-1000).max(1000),
  seq: int,
  controllerEpoch: int,
});
export const holdSchema = object({ workId: id, controllerEpoch: int });
export function safeShape(v: unknown, depth = 0): boolean {
  if (depth > R.limits.client_json_max_depth) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string")
    return v.length <= R.limits.client_string_max_length;
  if (Array.isArray(v))
    return (
      v.length <= R.limits.client_array_max_length &&
      v.every((x) => safeShape(x, depth + 1))
    );
  if (v && typeof v === "object")
    return Object.entries(v).every(
      ([k, x]) =>
        !["__proto__", "constructor", "prototype"].includes(k) &&
        safeShape(x, depth + 1),
    );
  return true;
}
