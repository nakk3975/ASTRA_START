import {
  MACHINE_CATALOG,
  MACHINE_UPGRADE_COST,
  MACHINE_UPGRADE_XP,
  VEIN_UPGRADE_COST,
  VEIN_UPGRADE_XP,
  DEVICE_PRICE,
  STAGE_BONUS,
  ITEM,
  type Kind,
  type MachineKind,
  type DeviceKind,
} from "./config.ts";
import {
  hands,
  carryCapacity,
  researchCost,
  itemValue,
  validAvatar,
  machineKind,
} from "./progression.ts";
import {
  MAP,
  SOURCES,
  validFloor,
  reachable,
  clearLine,
  machinePort,
  rectHit,
} from "./map.ts";
import { spawn, event, deviceUnlocked } from "./index.ts";
import type { World, Player, Command, Item, Machine } from "./types.ts";
export const MARKET = { x: -15, y: 0, z: 10 };
export function credit(w: World, coins: number) {
  w.economy.coins += coins;
  w.economy.earned += coins;
}
function spend(w: World, coins: number, xp = 0) {
  if (w.economy.xp < xp) throw Error(`팀 경험치 ${xp} XP가 필요합니다.`);
  if (w.economy.coins < coins) throw Error(`${coins} 코인이 필요합니다.`);
  w.economy.coins -= coins;
  w.economy.spent += coins;
}
function space(w: World, p: Player) {
  if (hands(p).length >= carryCapacity(w))
    throw Error("운반 칸을 비운 뒤 구매하세요.");
}
function give(w: World, p: Player, kind: Kind) {
  const i = spawn(w, kind, p.pos, "hand", p.id);
  if (p.hand) p.extraHands.push(i.id);
  else p.hand = i.id;
  return i;
}
export function payInstalled(w: World, i: Item) {
  const value = itemValue(i);
  credit(w, value);
  event(w, `${ITEM[i.kind].name} 납품 +${value} 코인`, i.id);
  for (let stage = 0; stage < STAGE_BONUS.length; stage++) {
    const sockets = w.sockets.filter((s) => s.stage === stage);
    if (
      sockets.length &&
      sockets.every((s) => s.item) &&
      !w.stageBonuses.includes(stage)
    ) {
      w.stageBonuses.push(stage);
      const bonus = Math.ceil(
        STAGE_BONUS[stage] * (1 + 0.35 * (w.planned - 1)),
      );
      credit(w, bonus);
      event(w, `M${stage + 1} 완성 보너스 +${bonus} 코인`);
    }
  }
}
export function machinePlacementReason(
  w: World,
  p: Player,
  x: number,
  z: number,
  rotation: number,
) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > 3
  )
    return "배치 좌표가 올바르지 않습니다.";
  if (
    Math.hypot(x - p.pos.x, z - p.pos.z) > 3 ||
    p.pos.y !== 0 ||
    !clearLine(w, p.pos, { x, y: 0, z })
  )
    return "설비를 들고 설치할 위치 가까이 이동하세요.";
  if (x < -17 || x > 6.2 || Math.abs(z) > 9.5)
    return "가공 구역 안에 설치하세요. 광맥·경사로·바깥 통로는 비워 주세요.";
  const rect = {
    x,
    z,
    w: rotation % 2 ? 2.1 : 2.35,
    d: rotation % 2 ? 2.35 : 2.1,
  };
  if (
    Object.values(w.players).some(
      (q) => q.connected && rectHit(q.pos.x, q.pos.z, rect, 0.36),
    )
  )
    return "작업자가 있는 위치는 비워 주세요.";
  if (!validFloor(w, { x, y: 0, z }, 1.2))
    return "벽이나 다른 기계와 겹칩니다.";
  const candidate = { pos: { x, y: 0, z }, rotation };
  if (
    Object.values(w.machines).some((m) =>
      [machinePort(m), machinePort(m, true)].some((a) =>
        rectHit(a.x, a.z, rect, 0.6),
      ),
    )
  )
    return "다른 기계의 입출력 받침대를 비워 주세요.";
  if (
    [machinePort(candidate), machinePort(candidate, true)].some(
      (a) => !validFloor(w, a, 0.55),
    )
  )
    return "입출력 공간이 막혀 있습니다.";
  if (
    Object.values(w.devices).some((d) => rectHit(d.pos.x, d.pos.z, rect, 0.8))
  )
    return "운반 설비와 겹칩니다.";
  if (
    Object.values(w.items).some(
      (i) => i.state === "ground" && rectHit(i.pos.x, i.pos.z, rect, 0.4),
    )
  )
    return "바닥 물건을 먼저 옮겨 주세요.";
  if (Math.hypot(MARKET.x - x, MARKET.z - z) < 2.5)
    return "판매소 앞을 비워 주세요.";
  if (Object.keys(w.machines).length >= 24)
    return "기계는 작업장당 24대까지 설치할 수 있습니다.";
  return "";
}
export function marketAction(
  w: World,
  p: Player,
  c: Command,
): string | undefined {
  if (c.type === "AVATAR") {
    if (!validAvatar(c.avatar)) throw Error("캐릭터를 선택하세요.");
    p.avatar = c.avatar!;
    return "캐릭터 변경";
  }
  if (c.type === "BUY_MACHINE") {
    if (!machineKind(c.machine)) throw Error("알 수 없는 기계");
    space(w, p);
    const spec = MACHINE_CATALOG[c.machine];
    spend(w, spec.price, spec.xp);
    const i = give(w, p, `kit_${c.machine}`);
    i.machineData = { tier: 0, investment: spec.price };
    return `${spec.name} 상자 구매 · 직접 설치하세요`;
  }
  if (c.type === "BUY_DEVICE") {
    if (!Object.hasOwn(DEVICE_PRICE, c.device ?? ""))
      throw Error("알 수 없는 운반 설비");
    const kind = c.device!;
    if (!deviceUnlocked(w, kind)) throw Error("성장 메뉴에서 먼저 해금하세요.");
    space(w, p);
    spend(w, DEVICE_PRICE[kind]);
    give(w, p, `kit_${kind}`);
    return "설비 상자 구매 · 직접 설치하세요";
  }
  if (c.type === "PLACE_MACHINE") {
    if (!machineKind(c.machine) || !p.hand)
      throw Error("기계 상자를 들고 있어야 합니다.");
    const i = w.items[p.hand];
    if (i.kind !== `kit_${c.machine}`)
      throw Error("선택한 기계 상자가 아닙니다.");
    const why = machinePlacementReason(w, p, c.x!, c.z!, c.rotation!);
    if (why) throw Error(why);
    const id = `machine:${++w.nextId}`,
      spec = MACHINE_CATALOG[c.machine];
    w.machines[id] = {
      id,
      type: c.machine,
      tier: i.machineData?.tier ?? 0,
      investment: i.machineData?.investment ?? spec.price,
      rotation: c.rotation!,
      pos: { x: c.x!, y: 0, z: c.z! },
      recipe: spec.recipe,
      input: [],
      output: [],
      job: null,
    };
    i.state = "consumed";
    i.owner = id;
    p.hand = p.extraHands.shift() ?? null;
    event(w, `${spec.name} 설치`, i.id);
    return "기계 설치 완료";
  }
  if (c.type === "UPGRADE_MACHINE" || c.type === "PACK_MACHINE") {
    const m = w.machines[c.target ?? ""];
    if (
      !m ||
      ![machinePort(m), machinePort(m, true)].some((a) =>
        reachable(w, p.pos, a),
      )
    )
      throw Error("기계 입출력 받침대 가까이 이동하세요.");
    if (m.job || m.input.length || m.output.length)
      throw Error("가공을 마치고 입력·출력 물건을 비워 주세요.");
    if (c.type === "UPGRADE_MACHINE") {
      if (m.tier >= 3) throw Error("최고 등급 기계입니다.");
      const cost = researchCost(w, MACHINE_UPGRADE_COST[m.tier]);
      spend(w, cost, MACHINE_UPGRADE_XP[m.tier]);
      m.investment += cost;
      m.tier++;
      event(w, `기계 ${m.tier + 1}등급으로 개선`);
      return "설비 업그레이드 완료";
    }
    space(w, p);
    if (!machineKind(m.type)) throw Error("이 기계는 재포장할 수 없습니다.");
    const i = give(w, p, `kit_${m.type}`);
    i.machineData = { tier: m.tier, investment: m.investment };
    delete w.machines[m.id];
    return "기계를 상자로 회수했습니다. 다시 설치할 수 있습니다.";
  }
  if (c.type === "UPGRADE_VEIN") {
    const kind = c.target as Kind;
    const src = SOURCES.find((s) => s.kind === kind);
    if (!src) throw Error("알 수 없는 광맥");
    const v = w.veins[kind]!;
    if (v.level >= 4) throw Error("최고 등급 광맥입니다.");
    spend(
      w,
      researchCost(w, VEIN_UPGRADE_COST[v.level]),
      VEIN_UPGRADE_XP[v.level],
    );
    v.level++;
    event(w, `${ITEM[kind].name} 광맥 ${v.level + 1}등급`);
    return "광맥 품질과 채굴 속도 증가";
  }
  if (c.type === "SELL" || (c.type === "INTERACT" && c.target === "market")) {
    if (!reachable(w, p.pos, MARKET))
      throw Error("광맥 구역 아래 판매소로 이동하세요.");
    if (!p.hand) throw Error("판매할 물건을 들고 오세요.");
    const i = w.items[p.hand],
      value = itemValue(i);
    if (!value) throw Error("설비 상자는 판매할 수 없습니다. 다시 설치하세요.");
    i.state = "consumed";
    i.owner = "market";
    p.hand = p.extraHands.shift() ?? null;
    credit(w, value);
    event(w, `${ITEM[i.kind].name} 판매 +${value} 코인`, i.id);
    return `${value} 코인에 판매했습니다`;
  }
}
