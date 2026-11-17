import type { Kind, DeviceKind, UpgradeKey, MachineKind } from "./config.ts";
export type V3 = { x: number; y: number; z: number };
export type ItemState =
  | "ground"
  | "air"
  | "hand"
  | "input"
  | "processing"
  | "output"
  | "device"
  | "installed"
  | "consumed";
export type Item = {
  id: string;
  kind: Kind;
  state: ItemState;
  owner: string | null;
  pos: V3;
  vel: V3;
  rotation: number;
  born: number;
  quality: number;
  machineData?: { tier: number; investment: number };
  recovered: number;
  sleep: boolean;
};
export type MoveFrame = { seq: number; dt: number; x: number; z: number };
export type MovePacket = {
  x: number;
  z: number;
  epoch: number;
  control?: number;
  frames?: MoveFrame[];
  /** Execute the accompanying action only after this movement interval is applied. */
  actionAfter?: number;
};
export type Player = {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  connected: boolean;
  pos: V3;
  facing: { x: number; z: number };
  hand: string | null;
  extraHands: string[];
  mining: null | { kind: Kind; remaining: number };
  input: { x: number; z: number; at: number };
  motion?: { ack: number; control: number; budget: number; at: number };
  lastSeq: number;
  lastSeen: number;
  epoch: number;
  action: string;
  actionUntil: number;
};
export type Machine = {
  id: string;
  type: string;
  tier: number;
  rotation: number;
  investment: number;
  pos: V3;
  recipe: string;
  input: string[];
  output: string[];
  job: null | { input: string[]; remaining: number; recipe: string };
};
export type Device = {
  id: string;
  type: DeviceKind;
  pos: V3;
  rotation: number;
  item: string | null;
  progress: number;
  source?: Kind;
};
export type Socket = {
  id: string;
  stage: number;
  kind: Kind;
  pos: V3;
  item: string | null;
};
export type Receipt = {
  id: string;
  seq: number;
  fingerprint: string;
  ok: boolean;
  message: string;
};
export type World = {
  rules: string;
  id: string;
  code: string;
  profile: "campaign" | "lab";
  planned: number;
  time: number;
  phase: "WORKING" | "LAUNCHED";
  nextId: number;
  players: Record<string, Player>;
  items: Record<string, Item>;
  machines: Record<string, Machine>;
  devices: Record<string, Device>;
  sockets: Socket[];
  receipts: Record<string, Receipt[]>;
  pings: { id: string; player: string; pos: V3; until: number }[];
  refill: number;
  events: { time: number; text: string; item?: string }[];
  veins: Partial<Record<Kind, { level: number; extracted: number }>>;
  stageBonuses: number[];
  economy: {
    coins: number;
    xp: number;
    earned: number;
    spent: number;
    upgrades: UpgradeKey[];
  };
};
export type Command = {
  id: string;
  seq: number;
  type:
    | "INTERACT"
    | "DROP"
    | "THROW"
    | "RECIPE"
    | "PLACE"
    | "PING"
    | "LAUNCH"
    | "UPGRADE"
    | "SELECT_HAND"
    | "BUY_MACHINE"
    | "PLACE_MACHINE"
    | "UPGRADE_MACHINE"
    | "PACK_MACHINE"
    | "BUY_DEVICE"
    | "UPGRADE_VEIN"
    | "SELL"
    | "AVATAR";
  machine?: MachineKind;
  avatar?: string;
  target?: string;
  recipe?: string;
  device?: DeviceKind;
  upgrade?: UpgradeKey;
  x?: number;
  z?: number;
  rotation?: number;
};
export type Rect = { x: number; z: number; w: number; d: number };
