import {
  hands,
  carryCapacity,
  movementSpeed,
  startingFunds,
  machineCapacity,
  machineSpeed,
  miningSeconds,
  railSeconds,
  machineCanRecipe,
  researchCost,
  validAvatar,
} from "./progression.ts";
import { marketAction, payInstalled, MARKET } from "./market.ts";
import { movePosition } from "./motion.ts";
export * from "./progression.ts";
export * from "./market.ts";
export * from "./motion.ts";
import {
  CFG,
  ITEM,
  RECIPES,
  PROFILES,
  RULES,
  plannedQuantity,
  UPGRADES,
  DEVICE_UNLOCK,
  REWARDS,
  type Kind,
  type DeviceKind,
} from "./config.ts";
import {
  floorHeight,
  validFloor,
  reachable,
  clearLine,
  safeFloor,
  machinePort,
  MAP,
  SOURCES,
  veinPort,
  rectHit,
  walls,
} from "./map.ts";
import type {
  World,
  Player,
  Item,
  V3,
  Command,
  Device,
  Receipt,
  Machine,
} from "./types.ts";
export * from "./config.ts";
export * from "./types.ts";
export * from "./map.ts";
const zero = () => ({ x: 0, y: 0, z: 0 });
const removeHand = (p: Player) => {
  p.hand = p.extraHands.shift() ?? null;
};
const addHand = (p: Player, id: string) => {
  if (p.hand) p.extraHands.push(id);
  else p.hand = id;
};
export function deviceUnlocked(w: World, type: DeviceKind) {
  const key = DEVICE_UNLOCK[type];
  return w.profile === "lab" || !key || w.economy.upgrades.includes(key);
}
export function migrateCarry(w: World) {
  if (w.rules === "carry-2.0.0" || w.rules === "mining-2.1.0") {
    w.economy ??= { coins: 0, xp: 0, earned: 0, spent: 0, upgrades: [] };
    w.economy.upgrades = w.economy.upgrades.map((k) =>
      k === "processing" ? "processing1" : k,
    );
    for (const p of Object.values(w.players)) {
      p.extraHands ??= [];
      p.mining = null;
      p.avatar ??= "worker";
    }
    for (const m of Object.values(w.machines)) {
      m.tier ??= 2;
      m.rotation ??= 0;
      m.investment ??= 0;
    }
    for (const i of Object.values(w.items)) i.quality ??= 0;
    w.veins = Object.fromEntries(
      SOURCES.map((s) => [s.kind, { level: 0, extracted: 0 }]),
    );
    w.stageBonuses = [
      ...new Set(
        w.sockets
          .filter((s) =>
            w.sockets.filter((q) => q.stage === s.stage).every((q) => q.item),
          )
          .map((s) => s.stage),
      ),
    ];
    w.rules = RULES;
    event(
      w,
      "공방 성장 규칙 적용: 기존 설비·물건·자금 보존. 빈 공방은 새 작업장에서 시작합니다.",
    );
  }
  return w;
}
function award(w: World, kind: Kind, id: string) {
  const r = REWARDS[kind];
  if (r) {
    w.economy.xp += r.xp;
    event(w, `${ITEM[kind].name} 가공 +${r.xp} XP · 판매/납품 시 코인`, id);
  }
}
export function event(w: World, text: string, item?: string) {
  w.events.push({ time: w.time, text, item });
  w.events = w.events.slice(-40);
}
export function spawn(
  w: World,
  kind: Kind,
  pos: V3,
  state: Item["state"] = "ground",
  owner: string | null = null,
): Item {
  const id = `${w.id}:item:${++w.nextId}`;
  return (w.items[id] = {
    id,
    kind,
    state,
    owner,
    pos: { ...pos },
    vel: zero(),
    rotation: 0,
    born: w.time,
    quality: 0,
    recovered: 0,
    sleep: state === "ground",
  });
}
export function createCarryWorld(
  id: string,
  code: string,
  planned = 1,
  profile: World["profile"] = "campaign",
): World {
  if (!Number.isInteger(planned) || planned < 1 || planned > 6)
    throw Error("인원은 1~6명입니다.");
  const w: World = {
    rules: RULES,
    id,
    code,
    profile,
    planned,
    time: 0,
    phase: "WORKING",
    nextId: 0,
    players: {},
    items: {},
    machines: {},
    devices: {},
    sockets: [],
    receipts: {},
    pings: [],
    refill: 0,
    events: [],
    veins: Object.fromEntries(
      SOURCES.map((s) => [s.kind, { level: 0, extracted: 0 }]),
    ),
    stageBonuses: [],
    economy: {
      coins: profile === "campaign" ? startingFunds(planned) : 0,
      xp: 0,
      earned: profile === "campaign" ? startingFunds(planned) : 0,
      spent: 0,
      upgrades: [],
    },
  };
  const defs = [
    ["press-a", "processor", -8, -7, "smelt_ingot"],
    ["press-b", "processor", -8, 0, "draw_wire"],
    ["press-c", "processor", -8, 7, "recycle_polymer"],
    ["fabricator-a", "fabricator", -1, -7, "press_plate"],
    ["fabricator-b", "fabricator", -1, 7, "cut_gear"],
    ["fabricator-c", "fabricator", -1, 0, "assemble_circuit"],
    ["fabricator-d", "fabricator", 6, 7, "assemble_hull"],
    ["refinery", "refinery", -13, 7, "blend_fuel"],
    ["assembler", "assembler", 6, -7, "assemble_engine"],
    ["assembler-control", "assembler", 6, 0, "assemble_control"],
    ["workbench", "workbench", -13, -10, "kit_tray"],
  ] as const;
  for (const [id, type, x, z, recipe] of profile === "lab" ? defs : [])
    w.machines[id] = {
      id,
      type,
      tier: 2,
      rotation: 0,
      investment: 0,
      pos: { x, y: 0, z },
      recipe: profile === "lab" && id === "press-a" ? "lab_plate" : recipe,
      input: [],
      output: [],
      job: null,
    };
  for (const [stage, s] of PROFILES[profile].stages.entries()) {
    let n = 0;
    for (const [kind, count] of Object.entries(s.required))
      for (let k = 0; k < plannedQuantity(count, planned, profile); k++) {
        w.sockets.push({
          id: `socket:${stage}:${n}`,
          stage,
          kind: kind as Kind,
          pos: {
            x: 13.3 + Math.floor(n / 6) * 1.7,
            y: 1.2,
            z: -4.5 + (n++ % 6) * 1.8,
          },
          item: null,
        });
      }
  }
  return w;
}
export function recipe(w: World, id: string) {
  if (w.profile === "lab" && id === "lab_plate")
    return {
      name: "검증용 철판",
      machine: "processor",
      input: { metal_scrap: 1 },
      output: "plate" as Kind,
      seconds: 4,
    };
  return RECIPES[id];
}
export function joinCarry(w: World, id: string, name: string, now: number) {
  let p = w.players[id];
  if (!p) {
    const used = Object.values(w.players)
      .filter((p) => p.connected)
      .map((p) => p.seat);
    const seat = Array.from({ length: 6 }, (_, i) => i).find(
      (i) => !used.includes(i),
    );
    if (seat === undefined) throw Error("작업장이 가득 찼습니다.");
    p = w.players[id] = {
      id,
      name: name.slice(0, 18),
      seat,
      avatar: "worker",
      connected: true,
      pos: { x: -14, y: 0, z: -5 + seat * 1.4 },
      facing: { x: 1, z: 0 },
      hand: null,
      extraHands: [],
      mining: null,
      input: { x: 0, z: 0, at: -10 },
      lastSeq: 0,
      lastSeen: now,
      epoch: 0,
      action: "idle",
      actionUntil: 0,
    };
  } else if (!p.connected) {
    const used = Object.values(w.players)
      .filter((q) => q.connected && q.id !== id)
      .map((q) => q.seat);
    const seat = Array.from({ length: 6 }, (_, i) => i).find(
      (i) => !used.includes(i),
    );
    if (seat === undefined) throw Error("작업장이 가득 찼습니다.");
    p.seat = seat;
  }
  p.connected = true;
  p.lastSeen = now;
  p.epoch++;
  p.input = { x: 0, z: 0, at: -10 };
  return p;
}
function grounded(w: World, i: Item, pos: V3, reason?: string) {
  i.state = "ground";
  i.owner = null;
  i.pos = { ...pos };
  i.vel = zero();
  i.sleep = true;
  if (reason) {
    i.recovered++;
    event(w, reason, i.id);
  }
}
export function leaveCarry(w: World, id: string) {
  const p = w.players[id];
  if (!p) return;
  for (const id of hands(p)) {
    const i = w.items[id];
    grounded(
      w,
      i,
      safeFloor(w, p.pos, i.id),
      "접속 종료: 운반물을 안전한 바닥으로 반환",
    );
  }
  p.hand = null;
  p.extraHands = [];
  p.mining = null;
  p.connected = false;
  p.input = { x: 0, z: 0, at: -10 };
}
export function currentStage(w: World) {
  return PROFILES[w.profile].stages.findIndex((_, n) =>
    w.sockets.some((s) => s.stage === n && !s.item),
  );
}
export function setInput(w: World, id: string, x: number, z: number) {
  const p = w.players[id];
  if (!p?.connected) return;
  const n = Math.max(1, Math.hypot(x, z));
  p.input = { x: x / n, z: z / n, at: w.time };
  if (n > 1 || x || z) p.facing = { x: x / n, z: z / n };
}
export function targets(w: World, p: Player) {
  const t: { id: string; pos: V3; label: string }[] = [];
  if (hands(p).length < carryCapacity(w)) {
    for (const i of Object.values(w.items))
      if (
        ["ground", "output", "input"].includes(i.state) ||
        (i.state === "device" &&
          w.devices[i.owner!]?.type !== "crane" &&
          !(
            w.devices[i.owner!]?.type === "installer" &&
            w.devices[i.owner!]?.progress > 0
          ))
      )
        t.push({ id: i.id, pos: i.pos, label: `E ${ITEM[i.kind].name} 들기` });
    for (const src of SOURCES)
      t.push({
        id: `vein:${src.kind}`,
        pos: veinPort(src),
        label: p.mining ? "채굴 중…" : `E ${ITEM[src.kind].name} 채굴`,
      });
  }
  if (p.hand) {
    t.push({ id: "market", pos: MARKET, label: "E 판매" });
    for (const m of Object.values(w.machines))
      t.push({
        id: `in:${m.id}`,
        pos: machinePort(m),
        label: `E ${recipe(w, m.recipe)?.name ?? "기계"} 재료 넣기`,
      });
    for (const s of w.sockets.filter((s) => s.stage === currentStage(w)))
      t.push({
        id: s.id,
        pos: s.pos,
        label: `E ${ITEM[s.kind].name} 설치${s.item ? " (완료)" : ""}`,
      });
    for (const d of Object.values(w.devices))
      if (!["crane", "miner"].includes(d.type))
        t.push({ id: d.id, pos: d.pos, label: "E 운반 설비에 놓기" });
  }
  return t
    .filter((t) => reachable(w, p.pos, t.pos))
    .sort(
      (a, b) =>
        Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) -
        Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z),
    );
}
function take(w: World, p: Player, i: Item) {
  if (hands(p).length >= carryCapacity(w))
    throw Error("운반 칸이 가득 찼습니다. 업그레이드로 늘릴 수 있습니다.");
  if (!["ground", "input", "output", "device"].includes(i.state))
    throw Error("지금 집을 수 없는 물건입니다.");
  if (
    i.state === "device" &&
    (w.devices[i.owner!]?.type === "crane" ||
      (w.devices[i.owner!]?.type === "installer" &&
        w.devices[i.owner!]?.progress > 0))
  )
    throw Error("설비가 운반·설치 중입니다.");
  if (!reachable(w, p.pos, i.pos))
    throw Error("가까이 다가가 주세요. 벽 너머에서는 집을 수 없습니다.");
  if (i.state === "input" || i.state === "output") {
    const m = w.machines[i.owner!];
    const a = m[i.state];
    a.splice(a.indexOf(i.id), 1);
  }
  if (i.state === "device") {
    const d = w.devices[i.owner!];
    d.item = null;
    d.progress = 0;
  }
  i.state = "hand";
  i.owner = p.id;
  i.sleep = true;
  i.vel = zero();
  addHand(p, i.id);
  p.action = "pick";
  p.actionUntil = w.time + 0.3;
}
function acceptMachine(w: World, m: Machine, i: Item) {
  const r = recipe(w, m.recipe);
  const needed = (r?.input as Partial<Record<Kind, number>>)?.[i.kind] ?? 0;
  if (
    r.output.startsWith("kit_") &&
    !deviceUnlocked(w, r.output.slice(4) as DeviceKind)
  )
    throw Error("업그레이드에서 해당 자동화를 먼저 해금하세요.");
  if (!needed) throw Error("현재 레시피에 맞지 않는 재료입니다.");
  if (
    m.input.length >= CFG.inputSlots ||
    m.input.filter((id) => w.items[id].kind === i.kind).length >= needed
  )
    throw Error("해당 입력 받침대가 가득 찼습니다.");
  i.state = "input";
  i.owner = m.id;
  i.pos = machinePort(m);
  i.vel = zero();
  i.sleep = true;
  m.input.push(i.id);
}
export function direction(rotation: number) {
  const a = ((rotation % 4) * Math.PI) / 2;
  return { x: Math.round(Math.cos(a)), z: Math.round(Math.sin(a)) };
}
export function deviceEnds(d: Device) {
  const v = direction(d.rotation);
  const from = { x: d.pos.x - v.x * 1.4, y: d.pos.y, z: d.pos.z - v.z * 1.4 };
  const to = { x: d.pos.x + v.x * 1.4, y: d.pos.y, z: d.pos.z + v.z * 1.4 };
  if (d.type === "corner") {
    const turn = direction(d.rotation + (d.rotation >= 4 ? -1 : 1));
    to.x = d.pos.x + turn.x * 1.4;
    to.z = d.pos.z + turn.z * 1.4;
  }
  to.y = floorHeight(to.x, to.z);
  from.y = floorHeight(from.x, from.z);
  return { from, to };
}
export function placementReason(
  w: World,
  p: Player,
  type: DeviceKind,
  x: number,
  z: number,
  rotation: number,
) {
  if (
    !["straight", "corner", "crane", "tray", "miner", "installer"].includes(
      type,
    )
  )
    return "알 수 없는 설비입니다.";
  if (!deviceUnlocked(w, type))
    return "업그레이드에서 먼저 해당 자동화를 해금해 주세요.";
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > (type === "corner" ? 7 : 3)
  )
    return "배치 좌표가 올바르지 않습니다.";
  const pos = { x, y: floorHeight(x, z), z };
  if (!reachable(w, p.pos, pos)) return "가까운 유효한 바닥에 설치해 주세요.";
  if (!validFloor(w, pos, 0.85)) return "벽 또는 기계와 겹칩니다.";
  if (type === "installer") {
    if (
      floorHeight(x, z) !== 1.2 ||
      !w.sockets.some((s) => Math.hypot(s.pos.x - x, s.pos.z - z) < 2.7)
    )
      return "설치기는 발사대 소켓 근처에 배치하세요.";
  }
  if (type === "miner" && x > 7.3) return "채굴기는 광맥에 설치하세요.";
  if (type === "crane" && x > 7.5 && x < 12.5 && Math.abs(z) < 2.5)
    return "램프 중앙은 통행을 위해 비워 주세요.";
  if (w.sockets.some((s) => Math.hypot(s.pos.x - x, s.pos.z - z) < 0.7))
    return "설치 소켓 위는 비워 주세요.";
  if (
    type === "miner" &&
    !SOURCES.some((s) => Math.hypot(s.x - x, s.z - z) < 2.3)
  )
    return "자동 채굴기는 광맥 가까이에 설치하세요.";
  if (Math.abs(z) > 10.4 || Math.abs(x) > 20.5)
    return "바깥 우회 통로는 비워 주세요.";
  if (Object.values(w.devices).length >= CFG.deviceLimit)
    return "이 작업장의 설비 한도에 도달했습니다.";
  if (
    Object.values(w.devices).some(
      (d) => Math.hypot(d.pos.x - x, d.pos.z - z) < 1.25,
    )
  )
    return "다른 설비와 겹칩니다.";
  if (
    Object.values(w.machines).some((m) =>
      [machinePort(m), machinePort(m, true)].some(
        (a) => Math.hypot(a.x - x, a.z - z) < 1.1,
      ),
    )
  )
    return "기계의 접근·입출력 공간을 비워 주세요.";
  if (
    Object.values(w.items).some(
      (i) => i.state === "ground" && Math.hypot(i.pos.x - x, i.pos.z - z) < 0.7,
    )
  )
    return "바닥의 물건을 먼저 옮겨 주세요.";
  return "";
}
function action(w: World, p: Player, c: Command) {
  if (w.phase === "LAUNCHED" && c.type !== "PING")
    throw Error("발사가 완료됐습니다.");
  const market = marketAction(w, p, c);
  if (market !== undefined) return market;
  const held = p.hand ? w.items[p.hand] : null;
  if (c.type === "INTERACT") {
    const t = targets(w, p).find((t) => t.id === c.target);
    if (!t) throw Error("가까운 유효한 대상을 바라봐 주세요.");
    if (t.id.startsWith("vein:")) {
      if (p.mining) throw Error("채굴 중입니다.");
      const src = SOURCES.find((s) => `vein:${s.kind}` === t.id)!;
      p.mining = { kind: src.kind, remaining: miningSeconds(w, src.kind) };
      p.action = "mine";
      p.actionUntil = w.time + miningSeconds(w, src.kind);
      return "광맥 채굴 시작";
    }
    if (w.items[t.id]) {
      const i = w.items[t.id];
      take(w, p, i);
      return `${ITEM[i.kind].name} 들기`;
    }
    if (!held) throw Error("손이 비어 있습니다.");
    if (t.id.startsWith("in:")) {
      acceptMachine(w, w.machines[t.id.slice(3)], held);
      removeHand(p);
      return "입력 받침대에 투입";
    }
    const s = w.sockets.find((s) => s.id === t.id);
    if (s) {
      if (s.item) throw Error("이미 설치한 소켓입니다.");
      if (s.stage !== currentStage(w))
        throw Error("현재 단계의 소켓이 아닙니다.");
      if (s.kind !== held.kind)
        throw Error(`${ITEM[s.kind].name}이 필요합니다.`);
      held.state = "installed";
      held.owner = s.id;
      held.pos = { ...s.pos };
      s.item = held.id;
      payInstalled(w, held);
      removeHand(p);
      p.action = "work";
      p.actionUntil = w.time + 0.6;
      event(w, `${p.name}: ${ITEM[held.kind].name} 설치`, held.id);
      return "직접 설치 완료";
    }
    const d = w.devices[t.id];
    if (!d || ["crane", "miner"].includes(d.type) || d.item)
      throw Error("운반 설비가 가득 찼습니다.");
    held.state = "device";
    held.owner = d.id;
    held.pos = { ...d.pos };
    d.item = held.id;
    d.progress = 0;
    removeHand(p);
    return "운반 설비에 놓기";
  }
  if (c.type === "DROP" || c.type === "THROW") {
    if (!held) throw Error("손이 비어 있습니다.");
    const f = p.facing;
    const pos = {
      x: p.pos.x + f.x * 0.95,
      y: p.pos.y,
      z: p.pos.z + f.z * 0.95,
    };
    pos.y = floorHeight(pos.x, pos.z);
    if (
      !validFloor(w, pos, 0.25) ||
      !clearLine(w, p.pos, pos, 0.2) ||
      Math.abs(pos.y - p.pos.y) > 0.4
    )
      throw Error("앞쪽에 내려놓을 안전한 바닥이 없습니다.");
    if (
      Object.values(w.items).some(
        (i) =>
          i.id !== held.id &&
          i.state === "ground" &&
          Math.hypot(i.pos.x - pos.x, i.pos.z - pos.z) < 0.5,
      )
    )
      throw Error("앞쪽 바닥에 다른 물건이 있습니다.");
    removeHand(p);
    p.action = "drop";
    p.actionUntil = w.time + 0.3;
    grounded(w, held, pos);
    if (c.type === "THROW") {
      held.state = "air";
      held.sleep = false;
      held.pos.y = p.pos.y + 0.8;
      held.vel = {
        x: f.x * CFG.throwSpeed,
        y: CFG.throwUp,
        z: f.z * CFG.throwSpeed,
      };
    }
    return c.type === "DROP" ? "내려놓기" : "짧게 던지기";
  }
  if (c.type === "RECIPE") {
    const m = w.machines[c.target ?? ""],
      r = recipe(w, c.recipe ?? "");
    if (!m || !r || !machineCanRecipe(m, c.recipe!))
      throw Error("이 기계에서는 만들 수 없습니다.");
    if (
      r.output.startsWith("kit_") &&
      !deviceUnlocked(w, r.output.slice(4) as DeviceKind)
    )
      throw Error("먼저 해당 자동화를 해금해 주세요.");
    if (
      ![machinePort(m), machinePort(m, true)].some((pos) =>
        reachable(w, p.pos, pos),
      )
    )
      throw Error("기계 가까이에서 레시피를 바꿔 주세요.");
    if (m.input.length || m.job)
      throw Error("대기 재료를 꺼내고 가공이 끝난 뒤 변경해 주세요.");
    m.recipe = c.recipe!;
    return "레시피 변경";
  }
  if (c.type === "PLACE") {
    const type = c.device!;
    if (!held || held.kind !== `kit_${type}`)
      throw Error("선택한 청사진과 같은 설비 상자를 들고 있어야 합니다.");
    const reason = placementReason(w, p, type, c.x!, c.z!, c.rotation!);
    if (reason) throw Error(reason);
    const id = `device:${++w.nextId}`;
    w.devices[id] = {
      id,
      type,
      pos: { x: c.x!, y: floorHeight(c.x!, c.z!), z: c.z! },
      rotation: c.rotation!,
      item: null,
      progress: 0,
      source:
        type === "miner"
          ? [...SOURCES].sort(
              (a, b) =>
                Math.hypot(a.x - c.x!, a.z - c.z!) -
                Math.hypot(b.x - c.x!, b.z - c.z!),
            )[0].kind
          : undefined,
    };
    held.state = "consumed";
    held.owner = id;
    removeHand(p);
    event(w, "설비 상자 1개로 설치 완료", held.id);
    return "설비 설치 완료";
  }
  if (c.type === "SELECT_HAND") {
    if (!p.hand || !p.extraHands.length)
      throw Error("선택할 다른 운반물이 없습니다.");
    if (c.target) {
      const n = p.extraHands.indexOf(c.target);
      if (n < 0) throw Error("운반 중인 물건이 아닙니다.");
      [p.hand, p.extraHands[n]] = [p.extraHands[n], p.hand];
    } else {
      p.extraHands.push(p.hand);
      p.hand = p.extraHands.shift()!;
    }
    return "사용할 운반물 변경";
  }
  if (c.type === "UPGRADE") {
    const key = c.upgrade!,
      u = UPGRADES[key];
    if (!Object.hasOwn(UPGRADES, key) || !u)
      throw Error("알 수 없는 업그레이드");
    if (w.economy.upgrades.includes(key)) throw Error("이미 해금했습니다.");
    if (u.requires && !w.economy.upgrades.includes(u.requires))
      throw Error("선행 업그레이드가 필요합니다.");
    if (w.economy.xp < u.xp) throw Error(`팀 경험치 ${u.xp} XP가 필요합니다.`);
    const cost = researchCost(w, u.cost);
    if (w.economy.coins < cost)
      throw Error(`팀 자금 ${cost} 코인이 필요합니다.`);
    w.economy.coins -= cost;
    w.economy.spent += cost;
    w.economy.upgrades.push(key);
    event(w, `팀 업그레이드: ${u.name}`);
    return `${u.name} 해금`;
  }
  if (c.type === "PING") {
    const x = Math.max(-23, Math.min(23, c.x ?? p.pos.x)),
      z = Math.max(-12, Math.min(12, c.z ?? p.pos.z));
    w.pings = w.pings.filter((q) => q.player !== p.id);
    w.pings.push({
      id: c.id,
      player: p.id,
      pos: { x, y: floorHeight(x, z), z },
      until: w.time + 6,
    });
    return "팀 핑";
  }
  if (c.type === "LAUNCH") {
    if (currentStage(w) !== -1) throw Error("모든 부품을 먼저 설치해 주세요.");
    if (!reachable(w, p.pos, { x: 14, y: 1.2, z: 4 }))
      throw Error("발사대의 발사 버튼 가까이 이동해 주세요.");
    w.phase = "LAUNCHED";
    event(w, "모두의 손으로 만든 로켓이 발사됩니다!");
    return "발사!";
  }
  throw Error("알 수 없는 행동입니다.");
}
export function commandCarry(w: World, id: string, c: Command): Receipt {
  const p = w.players[id];
  if (!p?.connected) throw Error("접속하지 않은 작업자입니다.");
  if (
    typeof c.id !== "string" ||
    c.id.length > 80 ||
    !Number.isSafeInteger(c.seq) ||
    c.seq <= 0
  )
    throw Error("명령 형식이 올바르지 않습니다.");
  const fingerprint = JSON.stringify(c);
  const old = w.receipts[id]?.find((r) => r.id === c.id);
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw Error("같은 명령 ID의 내용이 변경됐습니다.");
    return old;
  }
  if (c.seq <= p.lastSeq)
    throw Error("이미 처리한 순번입니다. 새로고침해 주세요.");
  let ok = true,
    message = "";
  try {
    message = action(w, p, c);
  } catch (e) {
    ok = false;
    message = (e as Error).message;
  }
  p.lastSeq = c.seq;
  const r = { id: c.id, seq: c.seq, fingerprint, ok, message };
  (w.receipts[id] ??= []).push(r);
  w.receipts[id] = w.receipts[id].slice(-128);
  return r;
}
function machinesTick(w: World, dt: number) {
  for (const m of Object.values(w.machines)) {
    if (m.job) {
      m.job.remaining = Math.max(
        0,
        m.job.remaining - dt * (w.profile === "lab" ? 1 : machineSpeed(w, m)),
      );
      if (
        m.job.remaining === 0 &&
        m.output.length < (w.profile === "lab" ? 3 : machineCapacity(m))
      ) {
        for (const id of m.job.input) {
          const i = w.items[id];
          i.state = "consumed";
          i.owner = m.id;
        }
        const r = recipe(w, m.job.recipe),
          p = machinePort(m, true);
        // Keep every tray slot within crane reach, including rotated five-slot machines.
        const a = (m.rotation * Math.PI) / 2;
        const slots = [
          [0, 0],
          [0, 0.5],
          [0, -0.5],
          [0.4, 0.25],
          [0.4, -0.25],
        ];
        const slot =
          slots.find(
            ([forward, side]) =>
              !m.output.some((id) => {
                const q = w.items[id].pos;
                return (
                  Math.hypot(
                    q.x - (p.x + Math.cos(a) * forward - Math.sin(a) * side),
                    q.z - (p.z + Math.sin(a) * forward + Math.cos(a) * side),
                  ) < 0.2
                );
              }),
          ) ?? slots[0];
        p.x += Math.cos(a) * slot[0] - Math.sin(a) * slot[1];
        p.z += Math.sin(a) * slot[0] + Math.cos(a) * slot[1];
        const i = spawn(w, r.output, p, "output", m.id);
        i.quality = Math.min(
          ...m.job.input.map((id) => w.items[id].quality ?? 0),
        );
        m.output.push(i.id);
        award(w, r.output, i.id);
        m.job = null;
      }
    }
    if (
      !m.job &&
      m.output.length < (w.profile === "lab" ? 3 : machineCapacity(m))
    ) {
      const r = recipe(w, m.recipe);
      if (
        r.output.startsWith("kit_") &&
        !deviceUnlocked(w, r.output.slice(4) as DeviceKind)
      )
        continue;
      const ids: string[] = [];
      for (const [kind, n] of Object.entries(r.input)) {
        const found = m.input
          .filter((id) => w.items[id].kind === kind)
          .slice(0, n);
        if (found.length !== n) {
          ids.length = 0;
          break;
        }
        ids.push(...found);
      }
      if (ids.length) {
        m.input = m.input.filter((id) => !ids.includes(id));
        for (const id of ids) w.items[id].state = "processing";
        m.job = { input: ids, remaining: r.seconds, recipe: m.recipe };
      }
    }
  }
}
function handoff(w: World, d: Device, to: V3) {
  const i = w.items[d.item!];
  for (const other of Object.values(w.devices)) {
    if (other === d || other.item || other.type === "miner") continue;
    const incoming =
      other.type === "crane" ? deviceEnds(other).from : other.pos;
    if (
      Math.hypot(incoming.x - to.x, incoming.z - to.z) > 0.9 ||
      Math.abs(incoming.y - to.y) > 0.5
    )
      continue;
    if (other.type === "straight" || other.type === "corner") {
      const v = direction(other.rotation);
      if ((d.pos.x - other.pos.x) * v.x + (d.pos.z - other.pos.z) * v.z > -0.4)
        continue;
    }
    i.owner = other.id;
    i.pos = { ...incoming };
    other.item = i.id;
    other.progress = 0;
    d.item = null;
    d.progress = 0;
    return true;
  }
  for (const m of Object.values(w.machines)) {
    const port = machinePort(m);
    if (Math.hypot(port.x - to.x, port.z - to.z) > 0.9) continue;
    try {
      acceptMachine(w, m, i);
      d.item = null;
      d.progress = 0;
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
function automationTick(w: World, dt: number) {
  const moved = new Set<string>();
  for (const d of Object.values(w.devices)) {
    const ends = deviceEnds(d);
    if (d.type === "miner") {
      if (!d.item) {
        d.progress += dt / miningSeconds(w, d.source ?? "metal_scrap", true);
        if (d.progress >= 1) {
          const src = SOURCES.find((s) => s.kind === d.source);
          if (src) {
            const i = spawn(
              w,
              src.kind,
              { ...d.pos, y: d.pos.y + 0.25 },
              "device",
              d.id,
            );
            i.quality = w.veins[src.kind]?.level ?? 0;
            w.veins[src.kind]!.extracted++;
            d.item = i.id;
            w.economy.xp++;
            event(w, `${ITEM[i.kind].name} 자동 채굴`, i.id);
          }
          d.progress = 0;
        }
      }
      if (d.item) {
        moved.add(d.item);
        handoff(w, d, ends.to);
      }
      continue;
    }
    if (d.type === "installer") {
      if (d.item) {
        const i = w.items[d.item],
          socket = w.sockets.find(
            (s) =>
              s.stage === currentStage(w) &&
              !s.item &&
              s.kind === i.kind &&
              Math.hypot(s.pos.x - d.pos.x, s.pos.z - d.pos.z) < 2.7,
          );
        if (socket) {
          d.progress += dt / 2;
          if (d.progress >= 1) {
            i.state = "installed";
            i.owner = socket.id;
            i.pos = { ...socket.pos };
            socket.item = i.id;
            payInstalled(w, i);
            d.item = null;
            d.progress = 0;
            event(w, `${ITEM[i.kind].name} 자동 설치`, i.id);
          }
        } else d.progress = 0;
      }
      continue;
    }
    if (d.type === "crane" && !d.item) {
      const found = Object.values(w.items).find(
        (i) =>
          !moved.has(i.id) &&
          (i.state === "output" ||
            i.state === "ground" ||
            (i.state === "device" && w.devices[i.owner!]?.type === "tray")) &&
          Math.hypot(i.pos.x - ends.from.x, i.pos.z - ends.from.z) < 0.75 &&
          Math.abs(i.pos.y - ends.from.y) < 0.5,
      );
      if (found) {
        if (found.state === "output") {
          const m = w.machines[found.owner!];
          m.output.splice(m.output.indexOf(found.id), 1);
        }
        if (found.state === "device") w.devices[found.owner!].item = null;
        found.state = "device";
        found.owner = d.id;
        d.item = found.id;
        d.progress = 0;
        moved.add(found.id);
      }
    }
    if (!d.item || moved.has(d.item) || d.type === "tray") continue;
    const i = w.items[d.item];
    d.progress = Math.min(
      1,
      d.progress + dt / (d.type === "crane" ? 2.8 : railSeconds(w)),
    );
    const f = d.type === "crane" ? ends.from : d.pos,
      t = ends.to,
      ratio = d.progress;
    i.pos = {
      x: f.x + (t.x - f.x) * ratio,
      y:
        floorHeight(f.x + (t.x - f.x) * ratio, f.z + (t.z - f.z) * ratio) +
        (d.type === "crane" ? Math.sin(ratio * Math.PI) * 2.1 : 0.25),
      z: f.z + (t.z - f.z) * ratio,
    };
    if (d.progress >= 1) {
      moved.add(i.id);
      handoff(w, d, t);
    }
  }
}
function physicsTick(w: World, dt: number) {
  for (const i of Object.values(w.items)) {
    if (i.state === "hand") {
      const p = w.players[i.owner!];
      i.pos = {
        x: p.pos.x + p.facing.x * 0.6,
        y: p.pos.y + 1.05,
        z: p.pos.z + p.facing.z * 0.6,
      };
      continue;
    }
    if (i.state !== "air") continue;
    if (
      i.pos.x < MAP.minX ||
      i.pos.x > MAP.maxX ||
      i.pos.z < MAP.minZ ||
      i.pos.z > MAP.maxZ ||
      i.pos.y < -4 ||
      !Object.values(i.pos).every(Number.isFinite)
    ) {
      grounded(
        w,
        i,
        safeFloor(w, { x: -14, y: 0, z: 10 }, i.id),
        "낙하 물건을 회수 앞마당에 복구",
      );
      continue;
    }
    for (let step = 0; step < 4; step++) {
      const h = dt / 4,
        old = { ...i.pos };
      i.vel.y -= CFG.gravity * h;
      const nx = i.pos.x + i.vel.x * h,
        nz = i.pos.z + i.vel.z * h,
        ny = i.pos.y + i.vel.y * h;
      const obstacle = walls(w).some((r) => rectHit(nx, nz, r, 0.22));
      if (obstacle || nx < -23.7 || nx > 23.7 || nz < -12.7 || nz > 12.7) {
        i.vel.x = 0;
        i.vel.z = 0;
      } else {
        i.pos.x = nx;
        i.pos.z = nz;
      }
      const floor = floorHeight(i.pos.x, i.pos.z);
      if (floor > old.y + 0.2) {
        i.pos.x = old.x;
        i.pos.z = old.z;
        i.vel.x = i.vel.z = 0;
      }
      i.pos.y = ny;
      const ground = floorHeight(i.pos.x, i.pos.z);
      if (i.pos.y <= ground) {
        const pos = safeFloor(w, { ...i.pos, y: ground }, i.id);
        grounded(w, i, pos);
        break;
      }
    }
    if (i.pos.y < -4 || !Object.values(i.pos).every(Number.isFinite)) {
      grounded(
        w,
        i,
        safeFloor(w, { x: -14, y: 0, z: 10 }, i.id),
        "낙하 물건을 회수 앞마당에 복구",
      );
    }
  }
}
export function tickCarry(w: World, dt: number) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25)
    throw Error("Invalid simulation step");
  if (!Object.values(w.players).some((p) => p.connected)) return;
  w.time += dt;
  for (const p of Object.values(w.players)) {
    if (!p.connected || w.phase === "LAUNCHED") continue;
    const i = p.input;
    if (w.time - i.at > CFG.inputExpiry) continue;
    p.pos = movePosition(w, p, p.pos, i, dt);
  }
  if (w.phase === "WORKING") {
    for (const p of Object.values(w.players)) {
      if (!p.connected || !p.mining) continue;
      const src = SOURCES.find((s) => s.kind === p.mining!.kind);
      if (
        !src ||
        !reachable(w, p.pos, veinPort(src)) ||
        hands(p).length >= carryCapacity(w)
      ) {
        p.mining = null;
        continue;
      }
      p.mining.remaining -= dt;
      if (p.mining.remaining <= 0) {
        const i = spawn(w, src.kind, p.pos, "hand", p.id);
        i.quality = w.veins[src.kind]?.level ?? 0;
        w.veins[src.kind]!.extracted++;
        addHand(p, i.id);
        p.mining = null;
        w.economy.xp++;
        event(w, `${p.name}: ${ITEM[i.kind].name} 채굴`, i.id);
      }
    }
    machinesTick(w, dt);
    automationTick(w, dt);
  }
  physicsTick(w, dt);
  w.pings = w.pings.filter((p) => p.until > w.time);
}
export function assertCarry(w: World) {
  if (w.rules !== RULES)
    throw Error(
      "지원하지 않는 저장 규칙입니다. 기존 저장본은 그대로 보존합니다.",
    );
  const claimed = new Map<string, string>();
  const add = (id: string, owner: string, state: Item["state"]) => {
    const i = w.items[id];
    if (!i || i.owner !== owner || i.state !== state || claimed.has(id))
      throw Error("ITEM_OWNERSHIP_INVARIANT");
    claimed.set(id, owner);
  };
  for (const p of Object.values(w.players)) {
    if (!validAvatar(p.avatar)) throw Error("PLAYER_AVATAR_INVARIANT");
    for (const id of hands(p)) add(id, p.id, "hand");
    if (hands(p).length > carryCapacity(w))
      throw Error("CARRY_CAPACITY_INVARIANT");
    if (!Object.values(p.pos).every(Number.isFinite))
      throw Error("PLAYER_POSITION_INVARIANT");
  }
  if (
    !w.economy ||
    !Number.isSafeInteger(w.economy.coins) ||
    w.economy.coins < 0 ||
    w.economy.earned - w.economy.spent !== w.economy.coins ||
    !Number.isSafeInteger(w.economy.xp)
  )
    throw Error("ECONOMY_INVARIANT");
  for (const m of Object.values(w.machines)) {
    if (
      !Number.isInteger(m.tier) ||
      m.tier < 0 ||
      m.tier > 3 ||
      !Number.isInteger(m.rotation) ||
      m.rotation < 0 ||
      m.rotation > 3
    )
      throw Error("MACHINE_LEVEL_INVARIANT");
    m.input.forEach((id) => add(id, m.id, "input"));
    m.output.forEach((id) => add(id, m.id, "output"));
    m.job?.input.forEach((id) => add(id, m.id, "processing"));
    if (m.output.length > Math.max(3, machineCapacity(m)))
      throw Error("OUTPUT_CAPACITY_INVARIANT");
  }
  for (const d of Object.values(w.devices))
    if (d.item) add(d.item, d.id, "device");
  for (const s of w.sockets) if (s.item) add(s.item, s.id, "installed");
  for (const i of Object.values(w.items)) {
    if (!Number.isInteger(i.quality) || i.quality < 0 || i.quality > 4)
      throw Error("ITEM_QUALITY_INVARIANT");
    if (!ITEM[i.kind] || !Object.values(i.pos).every(Number.isFinite))
      throw Error("ITEM_POSITION_INVARIANT");
    if (
      ["hand", "input", "output", "processing", "device", "installed"].includes(
        i.state,
      ) &&
      !claimed.has(i.id)
    )
      throw Error("ORPHAN_ITEM");
    if (["ground", "air"].includes(i.state) && i.owner !== null)
      throw Error("FREE_ITEM_OWNER");
  }
}
export function publicWorld(w: World) {
  return {
    ...w,
    items: Object.fromEntries(
      Object.entries(w.items).filter(([, i]) => i.state !== "consumed"),
    ),
    receipts: {},
  };
}
