import { screenMovement, viewControl } from './visuals/camera';
import React, { useEffect, useRef, useState } from "react";
import {
  B,
  M,
  R,
  FP,
  UNIT,
  ITEMS,
  RECIPES,
  type Item,
  type Recipe,
  type MachineType,
  type Counts,
} from "../../../packages/content/src/index.ts";
import {
  count,
  total,
  room,
  near,
  geometry,
  reasons,
  unlocked,
  rocketFree,
  type World,
  type Inventory,
  type Machine,
} from "../../../packages/game-core/src/index.ts";
import { connection as net } from "./network";
import { WorldView, colors, type Ghost } from "./WorldView";
import "./style.css";
const itemName = (i: string) => (B.items as any)[i]?.name_ko ?? i;
const machineName = (i: string) =>
  (B.machines as any)[i]?.name_ko ??
  (
    {
      shared_warehouse: "공용 창고",
      starter_workbench: "수동 작업대",
      starter_generator: "기본 발전기",
      recovery_vault: "비상 회수함",
      rocket: "로켓 조립 구역",
    } as any
  )[i] ??
  i;
const words: Record<string, string> = {
  OUT_OF_RANGE: "조금 더 가까이 이동해 주세요.",
  NOT_ENOUGH_ITEMS: "가방에 필요한 재료가 부족합니다.",
  INVENTORY_FULL: "가방이나 목적지에 공간이 없습니다.",
  LOCKED: "먼저 이전 로켓 단계를 완성해 주세요.",
  MACHINE_NOT_EMPTY: "작업을 멈추고 입력·출력·배송을 정리해 주세요.",
  ENTITY_VERSION_CONFLICT:
    "다른 팀원이 변경했습니다. 최신 상태에서 다시 선택해 주세요.",
  REFUND_CAPACITY_REQUIRED: "입력 버퍼를 비워야 제작을 취소할 수 있습니다.",
  ROOM_FULL: "6명이 참여 중이거나 재접속 자리가 예약되어 있습니다.",
  HUB_REQUIRED: "배송 허브를 먼저 설치해 주세요.",
  PROTECTED_REGION: "기계는 생산 구역에 설치해 주세요.",
  OCCUPIED: "이미 다른 시설이 있습니다.",
  PLAYER_OVERLAP: "캐릭터가 있는 칸에는 설치할 수 없습니다.",
  SERVICE_BLOCKED: "시설에 접근하는 길이 막힙니다.",
  PATH_BLOCKED: "필수 통로가 막힙니다.",
  CARGO_IN_FLIGHT: "비행 중인 화물이 도착한 뒤 다시 시도해 주세요.",
  LINK_DRAINING: "먼저 신규 배송을 중지해 주세요.",
  LINK_TOO_LONG: "배송 거리는 최대 24타일입니다.",
  INCOMPATIBLE_PORT: "이 자원을 받을 수 없는 목적지입니다.",
  NOT_ALL_READY: "현재 참여자가 모두 준비해야 합니다.",
  NOT_LEADER: "진행자만 할 수 있습니다.",
  NOT_OWNER: "소유자만 할 수 있습니다.",
  STATE_NOT_READY: "작업장을 동기화하고 있습니다.",
  RATE_LIMITED: "잠시 뒤 다시 시도해 주세요.",
  ROOM_NOT_FOUND: "방 코드를 확인해 주세요.",
  INVALID_ROOM_PHASE: "현재 단계에서 할 수 없는 행동입니다.",
  LAUNCH_REQUIREMENTS_MISSING: "필요한 자재와 조립 상태를 확인해 주세요.",
  INSPECTIONS_INCOMPLETE: "M6 조립과 세 가지 점검을 완료해 주세요.",
  ALREADY_UPGRADED: "이미 강화된 상태입니다.",
  COMMAND_PENDING: "작업 결과를 확인하고 있습니다.",
  AUTH_REQUIRED: "닉네임으로 먼저 접속해 주세요.",
};
const statusWords: Record<string, string> = {
  WORKING: "작동 중",
  SUPPLYING: "전력 공급",
  DELIVERING: "자동 배송",
  DELIVERY_READY: "배송 대기",
  SELECT_RECIPE: "제조법 선택",
  INPUT_MISSING: "재료 부족",
  OUTPUT_FULL: "출력 가득 참",
  POWER_LIMITED: "전력 부족",
  MANUAL_PAUSE: "수동 정지",
  DRAINING: "배송 정리 중",
  MANUAL: "작업장 일시정지",
  NO_CONNECTED_PLAYERS: "접속 대기",
};
function Symbol({
  name = "rocket",
  size = 22,
}: {
  name?: string;
  size?: number;
}) {
  const paths: Record<string, string> = {
    rocket:
      "M12 3c4 2 6 6 6 10l-6 4-6-4c0-4 2-8 6-10Zm-6 7-3 6 4-1m11-5 3 6-4-1M10 19l2 3 2-3M12 8v3",
    bolt: "m14 2-9 12h7l-2 8 9-13h-7l2-7",
    box: "m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10",
    tools: "m4 4 5 5m-5-5 1 4 3 1 10 10 2-2L10 7l-1-3-5-1M4 20l6-6m4-4 5-5",
    link: "m9 15 6-6m-8 3-2 2a4 4 0 0 0 6 6l3-3m-4-10 3-3a4 4 0 0 1 6 6l-2 2",
    users:
      "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 9v-3c0-4 12-4 12 0v3m2-10a3 3 0 1 0 0-6m1 9c5 0 5 2 5 6",
    close: "m6 6 12 12M6 18 18 6",
    check: "m5 12 4 4L19 6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3M3 12h3m12 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
    help: "M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
    map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.box} />
    </svg>
  );
}
function Resource({ item }: { item: string }) {
  const idx = ITEMS.indexOf(item as Item);
  return (
    <span className={"resource resource-" + ((idx + 14) % 7)}>
      <Symbol
        name={
          idx === 3 || idx === 10
            ? "bolt"
            : idx === 1 || idx === 5
              ? "link"
              : idx === 8 || idx === 12
                ? "settings"
                : "box"
        }
        size={18}
      />
    </span>
  );
}
function Cost({ cost }: { cost: Counts }) {
  return (
    <div className="cost">
      {Object.entries(cost).map(([i, q]) => (
        <span key={i}>
          <Resource item={i} />
          {itemName(i)} <b>{q}</b>
        </span>
      ))}
    </div>
  );
}
function TransferQuantity({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      한 번에 옮길 수량
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={1000}
        step={1}
        value={value}
        onChange={(e) =>
          onChange(
            Math.max(
              1,
              Math.min(1000, Math.trunc(Number(e.target.value)) || 1),
            ),
          )
        }
      />
    </label>
  );
}
function Panel({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,[tabindex="0"]',
          ) ?? [],
        );
        if (!nodes.length) return;
        const i = nodes.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          nodes.at(-1)?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && (i === nodes.length - 1 || i === -1)) {
          nodes[0].focus();
          e.preventDefault();
        }
      }
    };
    ref.current?.addEventListener("keydown", key);
    return () => {
      ref.current?.removeEventListener("keydown", key);
      old?.focus();
    };
  }, []);
  return (
    <aside
      ref={ref}
      className="panel"
      role="dialog"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="panel-heading">
        <div>
          <small>{subtitle ?? "WORKSHOP"}</small>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="패널 닫기"
        >
          <Symbol name="close" />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}
export default function App() {
  const [world, setWorld] = useState<World | null>(null),
    [status, setStatus] = useState("준비됨"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(localStorage.getItem("orbit:name") ?? ""),
    [roomName, setRoomName] = useState("우리의 첫 로켓"),
    [planned, setPlanned] = useState(2),
    [joinCode, setJoinCode] = useState(
      new URLSearchParams(location.search).get("code") ?? "",
    ),
    [landing, setLanding] = useState<"home" | "create" | "join">("home"),
    [recent, setRecent] = useState<any[]>([]),
    [secretKey, setSecretKey] = useState("");
  const [recoveryRoom, setRecoveryRoom] = useState(""),
    [recoveryInput, setRecoveryInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null),
    [panel, setPanel] = useState<string | null>(null),
    [low, setLow] = useState(localStorage.getItem("orbit:low") === "true"),
    [overview, setOverview] = useState(false),
    [ghost, setGhost] = useState<Ghost | null>(null),
    [recipe, setRecipe] = useState<Recipe>("smelt_ingot"),
    [linkItem, setLinkItem] = useState<Item>("metal_scrap"),
    [linkTo, setLinkTo] = useState("shared_warehouse"),
    [quantity, setQuantity] = useState(20),
    [selectedSlot, setSelectedSlot] = useState(0),
    [mute, setMute] = useState(true),
    [tutorial, setTutorial] = useState(true),
    [resultHidden, setResultHidden] = useState(false),
    [portrait, setPortrait] = useState(
      matchMedia("(max-width: 600px) and (orientation: portrait)").matches,
    );
  const keys = useRef(new Set<string>()),
    stick = useRef({ dx: 0, dz: 0 }),
    audioRef = useRef<AudioContext | null>(null),
    worldRef = useRef(world),
    panelRef = useRef(panel);
  worldRef.current = world;
  panelRef.current = panel;
  const me = world?.members[net.member],
    bag = world?.inventories["bag:" + net.member],
    stage = world?.stages[world.stage];
  const showError = (s: string) => {
    setError(words[s] ?? s);
  };
  useEffect(() => {
    net.onWorld = setWorld;
    net.onStatus = setStatus;
    net.onError = showError;
    net.onSecret = setSecretKey;
    void net
      .session()
      .then((s) => {
        if (s) {
          setName(s.name);
          return net.api("/api/rooms/recent").then(setRecent);
        }
      })
      .catch(() => setStatus("서버 연결을 확인해 주세요"));
    const resize = () => {
      const next = matchMedia(
        "(max-width: 600px) and (orientation: portrait)",
      ).matches;
      setPortrait(next);
      net.stopInputs();
      keys.current.clear();
      stick.current = { dx: 0, dz: 0 };
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    keys.current.clear();
    stick.current = { dx: 0, dz: 0 };
    net.stopInputs();
    viewControl.panel=!!panel;
  }, [panel]);
  useEffect(() => { viewControl.overview=overview; net.stopInputs(); }, [overview]);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  useEffect(() => {
    localStorage.setItem("orbit:low", String(low));
  }, [low]);
  const beep = () => {
    if (mute) return;
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
    const o = audioRef.current.createOscillator(),
      g = audioRef.current.createGain();
    o.connect(g);
    g.connect(audioRef.current.destination);
    o.frequency.setValueAtTime(620, audioRef.current.currentTime);
    g.gain.setValueAtTime(0.04, audioRef.current.currentTime);
    g.gain.exponentialRampToValueAtTime(
      0.001,
      audioRef.current.currentTime + 0.09,
    );
    o.start();
    o.stop(audioRef.current.currentTime + 0.1);
  };
  async function send(type: string, payload: any = {}) {
    try {
      const ack = await net.command(type, payload);
      beep();
      return ack;
    } catch (e) {
      showError((e as Error).message);
      return null;
    }
  }
  function closePanel() {
    net.stopInputs();
    setPanel(null);
  }
  async function startWork(payload: any) {
    if (portrait) return;
    if (net.hold && net.world?.members[net.member]?.work) {
      net.stopInputs();
      return;
    }
    net.hold = null;
    const ack = await send("WORK_START", payload);
    if (ack?.result?.workId) net.hold = String(ack.result.workId);
  }
  function select(id: string) {
    net.stopInputs();
    setSelected(id);
    setGhost(null);
    if (id.startsWith("source_")) setPanel("source");
    else if (id === "rocket") setPanel("rocket");
    else if (id === "starter_workbench") {
      setRecipe(
        world?.machines["channel:" + net.member]?.recipe ?? "smelt_ingot",
      );
      setPanel("machine");
    } else if (id === "starter_generator") setPanel("power");
    else if (id.startsWith("bag:")) setPanel("transfer");
    else if (world?.machines[id]) {
      setRecipe(
        world.machines[id].recipe ??
          RECIPES.find(
            (r) => B.recipes[r].machine === world.machines[id].type,
          ) ??
          "smelt_ingot",
      );
      setPanel("machine");
    } else setPanel("storage");
  }
  const interact = () => {
    const w = worldRef.current;
    if (!w) return;
    const p = w.members[net.member];
    let id = selected;
    const candidates = [
      ...M.source_zones.map((s) => ({
        id: s.id,
        geo: {
          ...M.rocket_envelope,
          id: s.id,
          service_points: s.manual_service_points,
        },
      })),
      ...M.starter_entities.map((g) => ({ id: g.id, geo: g })),
      { id: "rocket", geo: M.rocket_envelope },
      ...Object.values(w.machines)
        .filter((m) => m.type !== "channel")
        .map((m) => ({ id: m.id, geo: m.geometry })),
    ];
    if (
      !id ||
      !candidates.some((x) => x.id === id && near(w, p.position, x.geo) >= 0)
    )
      id = candidates
        .filter((x) => near(w, p.position, x.geo) >= 0)
        .sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
    if (!id) {
      showError("OUT_OF_RANGE");
      return;
    }
    if (id.startsWith("source_")) {
      setSelected(id);
      void startWork({ kind: "GATHER", sourceId: id });
    } else select(id);
  };
  const actionRef = useRef(interact);
  actionRef.current = interact;
  useEffect(() => {
    const clear = () => {
      keys.current.clear();
      stick.current = { dx: 0, dz: 0 };
      net.stopInputs();
    };
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,textarea,select") ||
        document.hidden
      )
        return;
      if (e.key === "Escape") {
        closePanel();
        setGhost(null);
        return;
      }
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
        ].includes(e.key)
      ) {
        if (!panelRef.current) {
          e.preventDefault();
          if (net.hold) net.stopInputs();
          keys.current.add(e.key);
        }
      }
      if (e.repeat) return;
      if (e.key.toLowerCase() === "e") actionRef.current();
      if (e.key.toLowerCase() === "b") {
        net.stopInputs();
        setPanel("build");
      }
      if (e.key.toLowerCase() === "r")
        setGhost((g) => (g ? { ...g, rotation: (g.rotation + 1) % 4 } : g));
      if (e.key.toLowerCase() === "f") {setOverview(false);viewControl.recenter++;viewControl.launchView=false;}
      if (["1", "2", "3", "4"].includes(e.key))
        setSelectedSlot(Number(e.key) - 1);
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key);
      if (e.key.toLowerCase() === "e") net.stopInputs();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    const timer = setInterval(() => {
      if (
        document.hidden ||
        matchMedia("(max-width: 600px) and (orientation: portrait)").matches
      )
        return;
      const k = keys.current;
      let dx =
          stick.current.dx +
          ((k.has("d") || k.has("ArrowRight") ? 1 : 0) -
            (k.has("a") || k.has("ArrowLeft") ? 1 : 0)) *
            1000,
        dz =
          stick.current.dz +
          ((k.has("s") || k.has("ArrowDown") ? 1 : 0) -
            (k.has("w") || k.has("ArrowUp") ? 1 : 0)) *
            1000;
      const movement=screenMovement(dx/1000,dz/1000);
      if (dx || dz) {viewControl.resync=false;net.move(movement.x*1000,movement.z*1000);}
      else net.move(0,0);
      net.holding();
    }, 100);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  async function enter(mode: "create" | "join" | "recent", id?: string) {
    setBusy(true);
    setResultHidden(false);
    setSelected(null);
    setPanel(null);
    try {
      localStorage.setItem("orbit:name", name);
      await net.guestLogin(name);
      if (mode === "create") {
        const r = await net.create(roomName, planned);
        setSecretKey(r.ownerRecoveryKey);
        await net.connect(r.roomId, r.code);
      } else if (mode === "recent") await net.connect(id!);
      else {
        const r = await net.api("/api/rooms/resolve", { roomCode: joinCode });
        await net.connect(r.id, joinCode);
      }
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function copyCode() {
    if (world)
      void navigator.clipboard
        .writeText(location.origin + "/?code=" + world.code)
        .then(() => setError("초대 링크를 복사했습니다."));
  }
  const close = () => closePanel();
  const title = selected?.startsWith("crate:")
    ? "현장 회수상자"
    : selected?.startsWith("bag:")
      ? "팀원에게 전달"
      : machineName(world?.machines[selected ?? ""]?.type ?? selected ?? "");
  function inventoryRows(
    inv: Inventory | undefined,
    from: string,
    to: string,
    action: string,
  ) {
    if (!inv) return <p>재고가 없습니다.</p>;
    const nonzero = ITEMS.filter((i) => count(inv, i));
    return nonzero.length ? (
      nonzero.map((i) => (
        <div className="inventory-row" key={i}>
          <Resource item={i} />
          <span>
            {itemName(i)}
            <small>{count(inv, i)}개</small>
          </span>
          <button
            disabled={portrait}
            onClick={() =>
              void send("TAKE_MAX", { from, to, itemId: i, quantity })
            }
          >
            {action}
          </button>
        </div>
      ))
    ) : (
      <div className="empty-state">
        <Symbol name="box" size={30} />
        <p>아직 담긴 자원이 없습니다.</p>
      </div>
    );
  }
  function workButton(payload: any, label: string) {
    return (
      <button
        className={"primary wide " + (net.hold ? "working" : "")}
        disabled={portrait || !net.connected}
        onClick={() => void startWork(payload)}
      >
        <Symbol name={net.hold ? "close" : "tools"} />
        {net.hold ? "작업 멈추기" : label}
      </button>
    );
  }
  function openBuild(type: string) {
    net.stopInputs();
    setPanel(null);
    setGhost({
      type,
      x: Math.floor((me?.position.x ?? 12000) / UNIT),
      z: Math.floor((me?.position.z ?? 19000) / UNIT) - 2,
      rotation: 2,
    });
  }
  const rows = world ? Object.values(world.members) : [];
  return (
    <div className="app-shell">
      <WorldView
        world={world}
        member={net.member}
        selected={selected}
        ghost={ghost}
        low={low}
        overview={overview || !world}
        onSelect={select}
        onGround={(p) => setGhost((g) => (g ? { ...g, ...p } : g))}
        onError={showError}
      />
      {!world ? (
        <>
          <div className="landing-shade" />
          <header className="landing-header">
            <a className="brand" href="/">
              <span className="brand-symbol">
                <Symbol size={28} />
              </span>
              <span>
                SCRAP <i>to</i> ORBIT<small>작은 고철, 함께 만드는 큰 꿈</small>
              </span>
            </a>
            <span className="edition">CO-OP WORKSHOP · 01</span>
          </header>
          <main className="landing-content">
            <div className="eyebrow">
              <span /> 1–6인 온라인 협동 작업장
            </div>
            <h1>
              고철로
              <br />
              <em>우주까지.</em>
            </h1>
            <p className="hero-copy">
              손에 쥔 고철 하나가 로켓이 되는 곳.
              <br />
              모으고, 만들고, 연결하세요.
              <br />
              우리의 첫 발사를 함께 준비해요.
            </p>
            <div className="hero-tags">
              <span>
                <Symbol name="users" size={17} />
                혼자부터 여섯 명까지
              </span>
              <span>
                <Symbol name="link" size={17} />
                수작업에서 자동화까지
              </span>
            </div>
            {landing === "home" ? (
              <>
                <button
                  className="primary hero-button"
                  onClick={() => setLanding("create")}
                >
                  새 작업장 만들기 <Symbol name="arrow" />
                </button>
                <button
                  className="secondary hero-button"
                  onClick={() => setLanding("join")}
                >
                  초대 코드로 참여하기
                </button>
                {recent.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => void enter("recent", recent[0].id)}
                  >
                    최근 작업장 이어하기 →
                  </button>
                )}
              </>
            ) : (
              <div className="entry-form">
                <button
                  className="text-button"
                  onClick={() => setLanding("home")}
                >
                  ← 돌아가기
                </button>
                <label>
                  작업자 닉네임
                  <input
                    maxLength={16}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="2~16자의 닉네임"
                  />
                </label>
                {landing === "create" ? (
                  <>
                    <label>
                      작업장 이름
                      <input
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        maxLength={40}
                      />
                    </label>
                    <label>
                      계획 인원 <span>시작 후 건설량이 고정돼요</span>
                    </label>
                    <div className="party-select">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          className={planned === n ? "chosen" : ""}
                          onClick={() => setPlanned(n)}
                        >
                          {n}명
                        </button>
                      ))}
                    </div>
                    <small className="muted">
                      건설량{" "}
                      {(B.planned_players.scales as any)[planned].numerator /
                        (B.planned_players.scales as any)[planned].denominator}
                      배 · 완주 목표{" "}
                      {(B.target_session_minutes as any)[planned].join("–")}분
                      <br />
                      플레이시간은 목표값이며 실제 진행에 따라 달라집니다.
                    </small>
                  </>
                ) : (
                  <label>
                    초대 코드
                    <input
                      value={joinCode}
                      onChange={(e) =>
                        setJoinCode(e.target.value.toUpperCase())
                      }
                      maxLength={8}
                      placeholder="8자리 초대 코드"
                    />
                  </label>
                )}
                <button
                  className="primary wide"
                  disabled={busy || name.trim().length < 2}
                  onClick={() => void enter(landing)}
                >
                  {busy
                    ? "연결을 확인하고 있습니다…"
                    : landing === "create"
                      ? "작업장 열기"
                      : "친구들과 합류하기"}
                  <Symbol name="arrow" />
                </button>
              </div>
            )}
            <details className="recovery-entry">
              <summary>복구 키로 내 작업장 찾기</summary>
              <label>
                닉네임
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={16}
                />
              </label>
              <label>
                작업장 ID
                <input
                  value={recoveryRoom}
                  onChange={(e) => setRecoveryRoom(e.target.value)}
                />
              </label>
              <label>
                복구 키
                <input
                  type="password"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await net.guestLogin(name);
                    const r = await net.api(
                      "/api/rooms/" + recoveryRoom + "/recover-owner",
                      { ownerRecoveryKey: recoveryInput },
                    );
                    setRecoveryInput("");
                    setSecretKey(r.ownerRecoveryKey);
                    await net.connect(recoveryRoom);
                  } catch (e) {
                    showError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                소유권 복구
              </button>
            </details>
          </main>
          <footer className="landing-footer">
            <span>BUILD SOMETHING BIG. TOGETHER.</span>
            <span>채집 → 가공 → 자동화 → 발사</span>
          </footer>
          <div className="world-caption">
            <span className="live-dot" /> 우리의 이야기는 여기서 시작됩니다{" "}
            <small>48 × 32 · 작은 우주 공장</small>
          </div>
        </>
      ) : (
        <>
          <header className="game-header">
            <div className="workshop-brand">
              <span className="brand-symbol">
                <Symbol />
              </span>
              <div>
                <strong>{world.name}</strong>
                <small>
                  <span
                    className={"live-dot " + (!net.connected ? "off" : "")}
                  />
                  {status} · 저장 v{world.version}
                </small>
              </div>
            </div>
            <div className="header-actions">
              <button className="pill" onClick={() => setPanel("crew")}>
                <Symbol name="users" size={18} />
                {rows.filter((m) => m.connected).length} / 6
              </button>
              <button className="pill code-pill" onClick={copyCode}>
                {world.code}
                <span>초대</span>
              </button>
              <button
                className="icon-button"
                onClick={() => setPanel("settings")}
                aria-label="설정"
              >
                <Symbol name="settings" />
              </button>
            </div>
          </header>
          {world.phase === "LOBBY" ? (
            <div className="lobby-card">
              <span className="eyebrow">PRE-FLIGHT CREW</span>
              <h1>함께 만들 준비됐나요?</h1>
              <p>모두 준비하면 첫 고철을 모으러 떠납니다.</p>
              <div className="crew-grid">
                {[0, 1, 2, 3, 4, 5].map((i) => {
                  const m = rows.filter((m) => m.connected)[i];
                  return (
                    <div className={"crew-card " + (m ? "active" : "")} key={i}>
                      <span
                        className="avatar"
                        style={{ background: colors[i] }}
                      >
                        {i + 1}
                      </span>
                      <strong>{m?.name ?? "친구를 기다리는 중"}</strong>
                      <small>
                        {m
                          ? m.ready
                            ? "✓ 준비 완료"
                            : m.id === world.leader
                              ? "진행자 · 준비 대기"
                              : "준비 대기"
                          : "초대 코드로 참여"}
                      </small>
                    </div>
                  );
                })}
              </div>
              <div className="lobby-details">
                <span>
                  계획 인원 <strong>{world.planned}명</strong>
                </span>
                <span>참가자가 바뀌어도 시작 후 건설량 유지</span>
                {me?.id === world.leader && (
                  <select
                    aria-label="계획 인원"
                    value={world.planned}
                    onChange={(e) =>
                      void send("SET_LOBBY_SETTINGS", {
                        plannedPlayers: Number(e.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}인 계획
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="lobby-buttons">
                <button
                  className={me?.ready ? "secondary" : "primary"}
                  onClick={() => void send("READY_SET", { ready: !me?.ready })}
                >
                  {me?.ready ? "준비 취소" : "준비 완료"}
                  <Symbol name="check" />
                </button>
                {me?.id === world.leader && (
                  <button
                    className="primary"
                    disabled={
                      !rows.filter((m) => m.connected).every((m) => m.ready)
                    }
                    onClick={() =>
                      void send("START_SESSION", {
                        settingsRevision: world.settingsRevision,
                      })
                    }
                  >
                    작업 시작 <Symbol name="arrow" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <section className="objective-card">
                <div className="objective-top">
                  <span className="eyebrow">OUR NEXT STEP</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected("rocket");
                      setPanel("rocket");
                    }}
                  >
                    전체 보기 ↗
                  </button>
                </div>
                <h2>
                  <span>{stage?.id ?? "GO"}</span>
                  {stage
                    ? B.milestones[world.stage].name_ko
                    : world.phase === "LAUNCHED"
                      ? "우주로 향한 우리"
                      : "마지막 발사 점검"}
                </h2>
                {stage ? (
                  <>
                    <div className="goal-chips">
                      {Object.entries(stage.required).map(([i, q]) => (
                        <span key={i}>
                          <Resource item={i} />
                          <b>{stage.delivered[i as Item] ?? 0}</b>/{q}
                          <small>{itemName(i)}</small>
                        </span>
                      ))}
                    </div>
                    <div className="progress">
                      <i
                        style={{
                          width:
                            (100 *
                              Object.entries(stage.required).reduce(
                                (n, [i, q]) =>
                                  n + (stage.delivered[i as Item] ?? 0),
                                0,
                              )) /
                              Object.values(stage.required).reduce(
                                (n, q) => n + q,
                                0,
                              ) +
                            "%",
                        }}
                      />
                    </div>
                    <p>
                      {Object.entries(stage.required).every(
                        ([i, q]) => stage.delivered[i as Item] === q,
                      )
                        ? "자재가 준비됐어요. 로켓 앞에서 조립해 주세요."
                        : "필요한 부품을 만들어 로켓 앞에 납품하세요."}
                    </p>
                  </>
                ) : (
                  <p>
                    {world.phase === "LAUNCHED"
                      ? "우리의 작업이 우주에 닿았습니다."
                      : "구조 · 추진 · 항법을 확인하고 모두 준비해 주세요."}
                  </p>
                )}
              </section>
              <button
                className={
                  "power-widget " + (world.power.ratio < FP ? "limited" : "")
                }
                onClick={() => setPanel("power")}
              >
                <span className="power-symbol">
                  <Symbol name="bolt" />
                </span>
                <span>
                  <small>작업장 전력</small>
                  <strong>
                    {world.power.demand / 10}{" "}
                    <i>/ {world.power.supply / 10} U</i>
                  </strong>
                  <small>
                    {world.power.ratio < FP
                      ? Math.floor(world.power.ratio / 100) + "% 속도로 가동"
                      : "안정적으로 공급 중"}
                  </small>
                </span>
              </button>
              {tutorial && world.stage === 0 && !panel && (
                <div className="tutorial-tip">
                  <button
                    onClick={() => setTutorial(false)}
                    aria-label="안내 숨기기"
                  >
                    ×
                  </button>
                  <span>작은 시작, 첫 번째 로켓</span>
                  <p>
                    {!me?.tutorial.includes("gather")
                      ? "WASD로 폐품 구역의 밝은 원에 다가가 E를 누르세요."
                      : !me?.tutorial.includes("craft")
                        ? "수동 작업대에서 재료를 넣고 주괴·전선·기어·금속판을 만들어 보세요."
                        : "완성품은 작업대 출력에서 직접 수거해 로켓 앞에 납품하세요."}
                  </p>
                </div>
              )}
              <nav className="tool-rail">
                <button
                  onClick={() => {
                    net.stopInputs();
                    setPanel("build");
                  }}
                  disabled={portrait}
                >
                  <Symbol name="tools" />
                  <span>건설</span>
                  <kbd>B</kbd>
                </button>
                <button
                  onClick={() => setPanel("logistics")}
                  disabled={portrait}
                >
                  <Symbol name="link" />
                  <span>물류</span>
                </button>
                <button
                  onClick={() => {
                    setSelected("rocket");
                    setPanel("rocket");
                  }}
                >
                  <Symbol />
                  <span>로켓</span>
                </button>
                <button onClick={() => setOverview(!overview)}>
                  <Symbol name="map" />
                  <span>{overview ? "돌아가기" : "둘러보기"}</span>
                  <kbd>F</kbd>
                </button>
                <button onClick={() => setPanel("help")}>
                  <Symbol name="help" />
                  <span>도움말</span>
                </button>
              </nav>
              <div className="bottom-hud">
                <div className="inventory-label">
                  <Symbol name="box" size={16} />내 가방{" "}
                  <span>
                    {me?.upgrades.includes("carry_tier_2")
                      ? 40
                      : me?.upgrades.includes("carry_tier_1")
                        ? 30
                        : 20}
                    개 / 슬롯
                  </span>
                </div>
                <div className="inventory-slots">
                  {bag?.kind === "PLAYER" &&
                    bag.slots.map((slot, i) => (
                      <button
                        key={i}
                        className={selectedSlot === i ? "selected" : ""}
                        onClick={() => setSelectedSlot(i)}
                      >
                        <kbd>{i + 1}</kbd>
                        {slot ? (
                          <>
                            <Resource item={slot.item} />
                            <strong>{slot.quantity}</strong>
                            <small>{itemName(slot.item)}</small>
                          </>
                        ) : (
                          <span className="empty-slot">—</span>
                        )}
                      </button>
                    ))}
                </div>
                <div className="movement-hint">
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd>
                  <span>이동</span>
                  <kbd>E</kbd>
                  <span>상호작용</span>
                </div>
              </div>
              <div className="touch-controls">
                <div
                  className="joystick"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const b = e.currentTarget.getBoundingClientRect();
                    stick.current = {
                      dx:
                        ((e.clientX - b.left - b.width / 2) / (b.width / 2)) *
                        1000,
                      dz:
                        ((e.clientY - b.top - b.height / 2) / (b.height / 2)) *
                        1000,
                    };
                    net.stopInputs();
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    const b = e.currentTarget.getBoundingClientRect();
                    stick.current = {
                      dx:
                        ((e.clientX - b.left - b.width / 2) / (b.width / 2)) *
                        1000,
                      dz:
                        ((e.clientY - b.top - b.height / 2) / (b.height / 2)) *
                        1000,
                    };
                  }}
                  onPointerUp={() => {
                    stick.current = { dx: 0, dz: 0 };
                    net.move(0, 0);
                  }}
                  onPointerCancel={() => {
                    stick.current = { dx: 0, dz: 0 };
                    net.move(0, 0);
                  }}
                >
                  <span>✥</span>
                </div>
                <button className="interact-touch" onClick={interact}>
                  <Symbol name="tools" />
                  <span>작업</span>
                </button>
              </div>
            </>
          )}
          {portrait && world.phase !== "LOBBY" && (
            <div className="portrait-message">
              <Symbol name="map" size={32} />
              <strong>가로로 돌리면 직접 플레이할 수 있습니다</strong>
              <p>현재 자리와 진행 상황은 유지됩니다.</p>
              <button onClick={() => setPanel("rocket")}>로켓 상태 보기</button>
            </div>
          )}
          {ghost && (
            <div className="build-confirm">
              <strong>{machineName(ghost.type)}</strong>
              <small>
                지면을 선택해 위치를 정한 뒤 설치하세요 · 현재 {ghost.x},{" "}
                {ghost.z}
              </small>
              <div>
                <button
                  onClick={() =>
                    setGhost({ ...ghost, rotation: (ghost.rotation + 1) % 4 })
                  }
                >
                  회전 R
                </button>
                <button
                  className="primary"
                  onClick={async () => {
                    const payload = ghost.moveId
                      ? {
                          entityId: ghost.moveId,
                          x: ghost.x,
                          z: ghost.z,
                          rotation: ghost.rotation,
                          expectedEntityVersion:
                            world.machines[ghost.moveId].version,
                        }
                      : {
                          machineType: ghost.type,
                          x: ghost.x,
                          z: ghost.z,
                          rotation: ghost.rotation,
                        };
                    const a = await send(
                      ghost.moveId ? "MOVE_MACHINE" : "PLACE_MACHINE",
                      payload,
                    );
                    if (a) setGhost(null);
                  }}
                >
                  설치 확정
                </button>
                <button onClick={() => setGhost(null)}>취소</button>
              </div>
            </div>
          )}
          {panel && (
            <Panel
              title={
                panel === "build"
                  ? "작업장 확장"
                  : panel === "logistics"
                    ? "배송망"
                    : panel === "power"
                      ? "전력 관리"
                      : panel === "rocket"
                        ? "우리의 로켓"
                        : panel === "settings"
                          ? "작업장 설정"
                          : panel === "crew"
                            ? "함께하는 작업자"
                            : panel === "help"
                              ? "작업장 안내"
                              : panel === "source"
                                ? (M.source_zones.find((s) => s.id === selected)
                                    ?.name_ko ?? "채집장")
                                : title
              }
              onClose={close}
            >
              {panel === "source" &&
                (() => {
                  const src = M.source_zones.find((s) => s.id === selected)!;
                  const cfg = B.sources[src.item_id as keyof typeof B.sources];
                  return (
                    <>
                      <div className="panel-illustration">
                        <Resource item={src.item_id} />
                      </div>
                      <p>
                        한 번에 <b>{cfg.manual_yield}개</b> ·{" "}
                        <b>
                          {(cfg.manual_action_ticks *
                            R.timers_ms.simulation_tick) /
                            1000}
                          초
                        </b>
                      </p>
                      <p className="muted">
                        밝은 원 가까이에서 작업하세요. 원료는 고갈되지 않습니다.
                        이동하거나 탭을 떠나면 작업이 멈춥니다.
                      </p>
                      {!unlocked(world, cfg.unlock) ? (
                        <div className="notice">
                          {cfg.unlock} 조립을 마치면 채집할 수 있습니다.
                        </div>
                      ) : (
                        workButton(
                          { kind: "GATHER", sourceId: src.id },
                          "채집 켜기",
                        )
                      )}
                      <p className="muted">
                        켜기 버튼은 접근성용 반복 작업입니다. 다시 누르면
                        멈춥니다.
                      </p>
                    </>
                  );
                })()}
              {panel === "machine" &&
                (() => {
                  const id =
                      selected === "starter_workbench"
                        ? "channel:" + net.member
                        : selected!,
                    mac = world.machines[id];
                  if (!mac) return null;
                  const input = world.inventories[id + ":in"],
                    output = world.inventories[id + ":out"],
                    isManual = mac.type === "channel",
                    rs = RECIPES.filter(
                      (k) => isManual || B.recipes[k].machine === mac.type,
                    ),
                    current = mac.recipe ? B.recipes[mac.recipe] : null;
                  return (
                    <>
                      <div className="machine-status">
                        <span className="live-dot" />
                        {reasons(world, mac)
                          .map((x) => statusWords[x] ?? x)
                          .join(" · ")}
                      </div>
                      {mac.job && (
                        <>
                          <div className="progress">
                            <i
                              style={{
                                width:
                                  (mac.job.progress / mac.job.required) * 100 +
                                  "%",
                              }}
                            />
                          </div>
                          <small>
                            진행{" "}
                            {Math.floor(
                              (mac.job.progress / mac.job.required) * 100,
                            )}
                            % · 제작 중 원료는 안전하게 보관됩니다
                          </small>
                        </>
                      )}
                      {rs.length > 0 && (
                        <>
                          <label>
                            제조법
                            <select
                              value={recipe}
                              onChange={(e) =>
                                setRecipe(e.target.value as Recipe)
                              }
                            >
                              {rs.map((r) => (
                                <option
                                  key={r}
                                  value={r}
                                  disabled={
                                    !unlocked(world, B.recipes[r].unlock)
                                  }
                                >
                                  {itemName(
                                    Object.keys(B.recipes[r].output)[0],
                                  )}
                                  {!unlocked(world, B.recipes[r].unlock)
                                    ? " · " + B.recipes[r].unlock + " 필요"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Cost cost={B.recipes[recipe].input} />
                          <p className="recipe-arrow">
                            ↓{" "}
                            {((B.recipes[recipe].duration_ticks *
                              R.timers_ms.simulation_tick) /
                              1000) *
                              (isManual ? 1.5 : 1)}
                            초
                          </p>
                          <Cost cost={B.recipes[recipe].output} />
                          <button
                            className="secondary wide"
                            disabled={portrait}
                            onClick={() =>
                              void send("SET_MACHINE_RECIPE", {
                                entityId: id,
                                recipeId: recipe,
                                expectedEntityVersion: mac.version,
                              })
                            }
                          >
                            제조법 적용
                          </button>
                        </>
                      )}
                      <div className="notice">
                        {isManual
                          ? "내 전용 채널 · 전력 없이 작업합니다."
                          : mac.source
                            ? itemName(mac.source) +
                              "을 지정된 채집 패드에서 자동 수거합니다."
                            : mac.type === "solar_array"
                              ? "전력 8U를 공급합니다. 낮과 밤, 연료 제한이 없습니다."
                              : mac.type === "logistics_hub"
                                ? "연결된 배송망의 새 화물 출발을 관리합니다."
                                : "입력을 넣으면 전력에 따라 자동 생산합니다."}
                      </div>
                      {(rs.length > 0 || mac.source) && (
                        <TransferQuantity
                          value={quantity}
                          onChange={setQuantity}
                        />
                      )}
                      {rs.length > 0 && <h3>내 가방 → 입력</h3>}
                      {ITEMS.filter(
                        (i) =>
                          rs.length > 0 &&
                          bag &&
                          count(bag, i) > 0 &&
                          (!current || !!(current.input as Counts)[i]),
                      ).map((i) => (
                        <div className="inventory-row" key={i}>
                          <Resource item={i} />
                          <span>
                            {itemName(i)}
                            <small>
                              가방 {count(bag!, i)} · 입력 {count(input, i)}
                            </small>
                          </span>
                          <button
                            disabled={portrait}
                            onClick={() =>
                              void send("TAKE_MAX", {
                                from: "bag:" + net.member,
                                to: id + ":in",
                                itemId: i,
                                quantity,
                              })
                            }
                          >
                            투입
                          </button>
                        </div>
                      ))}
                      {(rs.length > 0 || mac.source) && (
                        <h3>출력 · 직접 수거</h3>
                      )}
                      {inventoryRows(
                        output,
                        id + ":out",
                        "bag:" + net.member,
                        "수거",
                      )}
                      {isManual ? (
                        workButton(
                          {
                            kind: "MANUAL_CRAFT",
                            channelId: id,
                            recipeId: recipe,
                          },
                          "제작 켜기",
                        )
                      ) : (
                        <button
                          className="primary wide"
                          disabled={portrait}
                          onClick={() =>
                            void send("SET_MACHINE_ENABLED", {
                              entityId: id,
                              enabled: !mac.enabled,
                              expectedEntityVersion: mac.version,
                            })
                          }
                        >
                          {mac.enabled
                            ? "새 제작 및 작업 정지"
                            : "자동 생산 켜기"}
                        </button>
                      )}
                      <details>
                        <summary>입력 수거 · 취소 · 설비 관리</summary>
                        {inventoryRows(
                          input,
                          id + ":in",
                          "bag:" + net.member,
                          "회수",
                        )}
                        <button
                          className="secondary wide"
                          disabled={!mac.job || portrait}
                          onClick={() =>
                            void send("CANCEL_JOB", {
                              entityId: id,
                              expectedEntityVersion: mac.version,
                            })
                          }
                        >
                          진행 중 제작 취소 / 원료 반환
                        </button>
                        {!isManual && (
                          <>
                            <button
                              className="secondary wide"
                              onClick={() => setPanel("logistics")}
                            >
                              이 설비에서 배송 연결
                            </button>
                            <button
                              className="secondary wide"
                              disabled={
                                portrait ||
                                mac.tier === 2 ||
                                ["solar_array", "logistics_hub"].includes(
                                  mac.type,
                                )
                              }
                              onClick={() =>
                                void send("UPGRADE_MACHINE", {
                                  entityId: id,
                                  upgradeId:
                                    mac.type === "extractor"
                                      ? "extractor_mk2"
                                      : "machine_mk2",
                                  expectedEntityVersion: mac.version,
                                })
                              }
                            >
                              MK2 강화
                            </button>
                            <button
                              className="secondary wide"
                              disabled={portrait}
                              onClick={() => {
                                setPanel(null);
                                setGhost({
                                  type: mac.type,
                                  x: mac.geometry.top_left.x,
                                  z: mac.geometry.top_left.z,
                                  rotation: mac.geometry.rotation_degrees / 90,
                                  moveId: id,
                                });
                              }}
                            >
                              빈 설비 무료 이동
                            </button>
                            <button
                              className="danger wide"
                              disabled={portrait}
                              onClick={() => {
                                if (
                                  confirm(
                                    "재고와 배송을 모두 비운 설비를 철거할까요? 지불한 비용은 현장 상자에 반환됩니다.",
                                  )
                                )
                                  void send("DISMANTLE_MACHINE", {
                                    entityId: id,
                                    expectedEntityVersion: mac.version,
                                  });
                              }}
                            >
                              설비 철거
                            </button>
                          </>
                        )}
                      </details>
                      {isManual && (
                        <p className="muted">
                          연결이 끊기면 최대 2분 보관합니다. 자리가 필요하면
                          작업대 옆 공용 상자로 옮겨집니다.
                        </p>
                      )}
                    </>
                  );
                })()}
              {panel === "storage" && selected && (
                <>
                  <div className="notice">
                    공용 재고와 내 가방은 별도입니다. 가까이서 직접 옮겨 주세요.
                  </div>
                  <h3>보관된 자원</h3>
                  {inventoryRows(
                    world.inventories[selected],
                    selected,
                    "bag:" + net.member,
                    "수거",
                  )}
                  {selected === "shared_warehouse" && (
                    <>
                      <h3>내 가방</h3>
                      {inventoryRows(
                        bag,
                        "bag:" + net.member,
                        selected,
                        "보관",
                      )}
                      <details>
                        <summary>공용으로 임시 보관</summary>
                        <p>
                          창고 앞 상자에 담습니다. 팀원도 수령할 수 있습니다.
                        </p>
                        {ITEMS.filter((i) => bag && count(bag, i) > 0).map(
                          (i) => (
                            <button
                              className="secondary wide"
                              key={i}
                              onClick={() =>
                                void send("STASH_OVERFLOW", {
                                  itemId: i,
                                  quantity: Math.min(quantity, count(bag!, i)),
                                })
                              }
                            >
                              {itemName(i)} 공용으로 보관
                            </button>
                          ),
                        )}
                      </details>
                      <button
                        className="secondary wide"
                        onClick={() => setPanel("logistics")}
                      >
                        창고에서 배송 연결
                      </button>
                    </>
                  )}
                  <TransferQuantity value={quantity} onChange={setQuantity} />
                </>
              )}
              {panel === "transfer" && selected && (
                <>
                  <p>가까운 팀원에게 자원을 전달합니다.</p>
                  <TransferQuantity value={quantity} onChange={setQuantity} />
                  {selected !== "bag:" + net.member ? (
                    inventoryRows(bag, "bag:" + net.member, selected, "전달")
                  ) : (
                    <p>다른 팀원을 선택해 주세요.</p>
                  )}
                </>
              )}
              {panel === "build" && (
                <>
                  <p className="muted">
                    가방에 재료를 챙겨 생산 구역으로 이동하세요. 설치는
                    캐릭터에서 3타일 이내입니다.
                  </p>
                  {Object.entries(B.machines)
                    .filter(([id]) => id !== "manual_workbench")
                    .map(([id, m]) => (
                      <div className="build-card" key={id}>
                        <div>
                          <span className="build-icon">
                            <Symbol
                              name={
                                id === "solar_array"
                                  ? "bolt"
                                  : id === "logistics_hub"
                                    ? "link"
                                    : "tools"
                              }
                            />
                          </span>
                          <h3>{m.name_ko}</h3>
                          <small>
                            {id === "solar_array"
                              ? "+8U 공급"
                              : m.power_deci_units / 10 + "U 사용"}
                          </small>
                        </div>
                        <Cost cost={m.paid_cost} />
                        <button
                          className="secondary wide"
                          disabled={!unlocked(world, m.unlock) || portrait}
                          onClick={() => openBuild(id)}
                        >
                          {unlocked(world, m.unlock)
                            ? "위치 선택"
                            : m.unlock + " 완료 후 해금"}
                        </button>
                      </div>
                    ))}
                </>
              )}
              {panel === "power" && (
                <>
                  <div className="big-number">
                    {world.power.supply / 10}
                    <span>U 공급</span>
                  </div>
                  <div className="metrics">
                    <span>
                      현재 유효 수요 <b>{world.power.demand / 10}U</b>
                    </span>
                    <span>
                      생산 속도 <b>{(world.power.ratio / 100).toFixed(1)}%</b>
                    </span>
                  </div>
                  <p>
                    기본 발전기 6U와 태양광 설비가 공용 전력을 공급합니다.
                    부족하면 자동 생산과 새 배송이 같은 비율로 느려집니다.
                  </p>
                  <div className="notice">
                    수동 제작과 이미 출발한 화물의 비행 속도는 전력의 영향을
                    받지 않습니다.
                  </div>
                  <button
                    className="primary wide"
                    disabled={!unlocked(world, "M1")}
                    onClick={() => openBuild("solar_array")}
                  >
                    태양광 설치
                  </button>
                  <Cost cost={B.machines.solar_array.paid_cost} />
                </>
              )}
              {panel === "logistics" &&
                (() => {
                  const from =
                    selected === "shared_warehouse"
                      ? "shared_warehouse"
                      : selected && world.machines[selected]
                        ? selected + ":out"
                        : null;
                  const destinations = [
                    "shared_warehouse",
                    "rocket",
                    ...Object.values(world.machines)
                      .filter((m) => m.type !== "channel" && m.recipe)
                      .map((m) => m.id + ":in"),
                  ];
                  const linkDistance =
                    from && destinations.includes(linkTo)
                      ? Math.hypot(
                          geometry(world, from).delivery_distance_anchor.x -
                            geometry(world, linkTo).delivery_distance_anchor.x,
                          geometry(world, from).delivery_distance_anchor.z -
                            geometry(world, linkTo).delivery_distance_anchor.z,
                        )
                      : Infinity;
                  return (
                    <>
                      <div className="notice">
                        출발 시설을 먼저 선택하세요. 한 링크는 한 품목을 최대
                        24타일 거리로 배송합니다.
                      </div>
                      {from && (
                        <div className="link-form">
                          <label>
                            출발 <strong>{machineName(selected!)}</strong>
                          </label>
                          <label>
                            자원
                            <select
                              value={linkItem}
                              onChange={(e) =>
                                setLinkItem(e.target.value as Item)
                              }
                            >
                              {ITEMS.map((i) => (
                                <option key={i} value={i}>
                                  {itemName(i)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            도착
                            <select
                              value={linkTo}
                              onChange={(e) => setLinkTo(e.target.value)}
                            >
                              {destinations.map((d) => (
                                <option key={d} value={d}>
                                  {d === "rocket"
                                    ? "로켓"
                                    : d === "shared_warehouse"
                                      ? "공용 창고"
                                      : machineName(
                                          world.machines[d.slice(0, -3)].type,
                                        ) +
                                        " · " +
                                        d.slice(0, -3)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p>
                            중심 거리{" "}
                            {Number.isFinite(linkDistance)
                              ? linkDistance.toFixed(2)
                              : "—"}{" "}
                            / {B.delivery.max_distance_tiles}타일
                          </p>
                          <Cost cost={B.delivery.paid_cost_per_link} />
                          <button
                            className="primary wide"
                            disabled={
                              portrait ||
                              linkDistance > B.delivery.max_distance_tiles
                            }
                            onClick={() =>
                              void send("CREATE_LINK", {
                                from,
                                to: linkTo,
                                itemId: linkItem,
                              })
                            }
                          >
                            배송 연결
                          </button>
                        </div>
                      )}
                      <h3>
                        연결 {Object.keys(world.links).length} /{" "}
                        {B.delivery.max_links}
                      </h3>
                      {Object.values(world.links).map((l) => (
                        <div className="link-card" key={l.id}>
                          <strong>
                            <Resource item={l.item} />
                            {itemName(l.item)}
                          </strong>
                          <small>
                            {l.from} → {l.to}
                          </small>
                          <p>
                            {l.draining ? "새 배송 정지" : "배송 활성"} · 비행{" "}
                            {
                              Object.values(world.cargo).filter(
                                (c) => c.link === l.id,
                              ).length
                            }{" "}
                            / 4
                          </p>
                          <div className="row">
                            <button
                              onClick={() =>
                                void send("DRAIN_LINK", {
                                  entityId: l.id,
                                  expectedEntityVersion: l.version,
                                })
                              }
                            >
                              송신 중지
                            </button>
                            <button
                              onClick={() =>
                                void send("EDIT_LINK", {
                                  entityId: l.id,
                                  expectedEntityVersion: l.version,
                                  from: l.from,
                                  to: linkTo,
                                  itemId: linkItem,
                                })
                              }
                            >
                              선택값 적용
                            </button>
                            <button
                              className="danger"
                              onClick={() =>
                                void send("REMOVE_LINK", {
                                  entityId: l.id,
                                  expectedEntityVersion: l.version,
                                })
                              }
                            >
                              철거
                            </button>
                          </div>
                        </div>
                      ))}
                      {!Object.keys(world.links).length && (
                        <div className="empty-state">
                          <Symbol name="link" size={32} />
                          <p>
                            M2를 완성하고 배송 허브를 세우면
                            <br />
                            운반을 자동화할 수 있습니다.
                          </p>
                        </div>
                      )}
                    </>
                  );
                })()}
              {panel === "rocket" && (
                <>
                  <div className="stage-track">
                    {B.milestones.map((s, i) => (
                      <span
                        key={s.id}
                        className={
                          i < world.stage
                            ? "done"
                            : i === world.stage
                              ? "current"
                              : ""
                        }
                      >
                        {i < world.stage ? "✓" : s.id}
                      </span>
                    ))}
                  </div>
                  {stage ? (
                    <>
                      <h3>
                        {stage.id} · {B.milestones[world.stage].name_ko}
                      </h3>
                      {Object.entries(stage.required).map(([i, q]) => (
                        <div className="rocket-row" key={i}>
                          <Resource item={i} />
                          <div>
                            <strong>{itemName(i)}</strong>
                            <small>
                              {stage.delivered[i as Item] ?? 0} / {q} · 배송
                              예약{" "}
                              {
                                Object.values(world.cargo).filter(
                                  (c) => c.to === "rocket" && c.item === i,
                                ).length
                              }
                            </small>
                          </div>
                          <button
                            disabled={
                              portrait ||
                              !bag ||
                              !count(bag, i as Item) ||
                              rocketFree(world, i as Item) <= 0
                            }
                            onClick={() =>
                              void send("CONTRIBUTE_ROCKET", {
                                itemId: i,
                                quantity: 1000,
                              })
                            }
                          >
                            납품
                          </button>
                        </div>
                      ))}
                      <div className="progress">
                        <i
                          style={{
                            width:
                              Math.min(
                                100,
                                (stage.progress /
                                  (B.construction.assembly_base_ticks[
                                    stage.id as keyof typeof B.construction.assembly_base_ticks
                                  ] *
                                    FP)) *
                                  100,
                              ) + "%",
                          }}
                        />
                      </div>
                      {workButton(
                        { kind: "ASSEMBLY", stageId: stage.id },
                        "로켓 조립 켜기",
                      )}
                      <p className="muted">
                        모든 자재가 도착하면 로켓 앞에서 조립합니다. 여럿이
                        함께하면 더 빨라집니다.
                      </p>
                    </>
                  ) : (
                    <>
                      <h3>마지막 발사 점검</h3>
                      {B.construction.inspection_ids.map((id, i) => (
                        <div className="inventory-row" key={id}>
                          <Symbol name={world.checks[id] ? "check" : "tools"} />
                          <span>
                            {["구조 고정", "추진 연결", "항법 확인"][i]}
                            <small>
                              {world.checks[id]
                                ? "점검 완료"
                                : "2초 · 로켓 앞에서 작업"}
                            </small>
                          </span>
                          <button
                            disabled={world.checks[id] || portrait}
                            onClick={() =>
                              void startWork({
                                kind: "INSPECTION",
                                checkId: id,
                              })
                            }
                          >
                            점검
                          </button>
                        </div>
                      ))}
                      <button
                        className="primary wide"
                        disabled={
                          !Object.values(world.checks).every(Boolean) ||
                          world.leader !== net.member ||
                          world.phase !== "RUNNING"
                        }
                        onClick={() => void send("PROPOSE_LAUNCH")}
                      >
                        모두에게 발사 준비 요청
                      </button>
                    </>
                  )}
                  <details>
                    <summary>앞으로 만들 로켓</summary>
                    {B.milestones.map((m, i) => (
                      <div key={m.id}>
                        <h3>
                          {m.id} {m.name_ko}
                        </h3>
                        <Cost cost={world.stages[i].required} />
                      </div>
                    ))}
                  </details>
                </>
              )}
              {panel === "crew" && (
                <>
                  {rows.map((m, i) => (
                    <div className="crew-row" key={m.id}>
                      <span
                        className="avatar"
                        style={{ background: colors[i % 6] }}
                      >
                        {i + 1}
                      </span>
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {m.connected ? "접속 중" : "재접속 대기"}
                          {world.owner === m.id ? " · 소유자" : ""}
                          {world.leader === m.id ? " · 진행자" : ""}
                        </small>
                      </span>
                    </div>
                  ))}
                  <button className="secondary wide" onClick={copyCode}>
                    초대 링크 복사
                  </button>
                  {world.owner === net.member &&
                    world.leader !== net.member && (
                      <button onClick={() => void send("CLAIM_LEADER")}>
                        진행자 가져오기
                      </button>
                    )}
                  <h3>함께 만든 기록</h3>
                  <p>
                    자동 생산 {world.stats.automaticProduced}개<br />
                    자동 배송 {world.stats.delivered}개<br />
                    유효 작업 시간{" "}
                    {Math.floor((Number(world.tick) * 0.05) / 60)}분
                  </p>
                </>
              )}
              {panel === "settings" && (
                <>
                  <label className="switch">
                    <span>저사양 그래픽</span>
                    <input
                      type="checkbox"
                      checked={low}
                      onChange={(e) => setLow(e.target.checked)}
                    />
                  </label>
                  <label className="switch"><span>내 작업자 자동 따라가기</span><input type="checkbox" defaultChecked={viewControl.follow} onChange={e=>{viewControl.follow=e.target.checked;localStorage.setItem('orbit:follow',String(e.target.checked));}} /></label>
                  <label className="switch"><span>움직임 줄이기</span><input type="checkbox" defaultChecked={viewControl.reduced} onChange={e=>{viewControl.reduced=e.target.checked;localStorage.setItem('orbit:reduced',String(e.target.checked));}} /></label>
                  <div className="button-row"><button onClick={()=>viewControl.zoom--}>화면 확대</button><button onClick={()=>viewControl.zoom++}>화면 축소</button><button onClick={()=>{viewControl.recenter++;setOverview(false);setPanel(null);}}>내 작업자 · F</button><button onClick={()=>{viewControl.launchView=!viewControl.launchView;setPanel(null);}}>발사대 고정 시점</button></div>
                  <label className="switch">
                    <span>효과음 켜기</span>
                    <input
                      type="checkbox"
                      checked={!mute}
                      onChange={(e) => setMute(!e.target.checked)}
                    />
                  </label>
                  <label className="switch">
                    <span>초반 도움말 표시</span>
                    <input
                      type="checkbox"
                      checked={tutorial}
                      onChange={(e) => setTutorial(e.target.checked)}
                    />
                  </label>
                  <h3>개인 장비 강화</h3>
                  {(
                    ["carry_tier_1", "move_tier_1", "carry_tier_2"] as const
                  ).map((id, i) => (
                    <div className="upgrade" key={id}>
                      <strong>
                        {
                          [
                            "가방 30개 / 슬롯",
                            "이동 속도 4.5타일/초",
                            "가방 40개 / 슬롯",
                          ][i]
                        }
                      </strong>
                      <Cost cost={B.upgrades[id].cost} />
                      <button
                        disabled={
                          me?.upgrades.includes(id) ||
                          !unlocked(world, B.upgrades[id].unlock) ||
                          portrait
                        }
                        onClick={() =>
                          void send("UPGRADE_PLAYER", { upgradeId: id })
                        }
                      >
                        {me?.upgrades.includes(id)
                          ? "적용됨"
                          : "작업대에서 강화"}
                      </button>
                    </div>
                  ))}
                  {world.leader === net.member && world.phase === "RUNNING" && (
                    <button
                      className="secondary wide"
                      onClick={() =>
                        void send("SET_ROOM_PAUSE", {
                          paused: !world.pauses.includes("MANUAL"),
                        })
                      }
                    >
                      {world.pauses.includes("MANUAL")
                        ? "작업장 재개"
                        : "작업장 일시정지"}
                    </button>
                  )}
                  <button
                    className="secondary wide"
                    onClick={() =>
                      void send("SAVE_BARRIER").then(
                        (a) =>
                          a &&
                          setError("저장 확인 완료 · v" + a.durableVersion),
                      )
                    }
                  >
                    저장 확인
                  </button>
                  {world.owner === net.member && (
                    <details>
                      <summary>소유자 관리</summary>
                      <button
                        className="secondary wide"
                        onClick={() => void send("ROTATE_ROOM_CODE")}
                      >
                        초대 코드 새로 만들기
                      </button>
                      <button
                        className="secondary wide"
                        onClick={() => void send("ROTATE_RECOVERY_KEY")}
                      >
                        복구 키 새로 만들기
                      </button>
                      {rows
                        .filter((m) => m.connected && m.id !== net.member)
                        .map((m) => (
                          <button
                            key={m.id}
                            className="secondary wide"
                            onClick={() =>
                              void send("TRANSFER_OWNERSHIP", {
                                targetMemberId: m.id,
                              })
                            }
                          >
                            {m.name}님에게 소유권 이전 제안
                          </button>
                        ))}
                      <button
                        className="danger wide"
                        onClick={() => {
                          const code = prompt(
                            "저장된 작업장을 삭제합니다. 방 코드를 입력해 확인하세요.",
                          );
                          if (code)
                            void send("DELETE_SAVED_ROOM", {
                              code,
                              version: world.version,
                            }).then((a) => {
                              if (a) {
                                void net.leave();
                                setWorld(null);
                                setPanel(null);
                              }
                            });
                        }}
                      >
                        저장된 작업장 삭제
                      </button>
                    </details>
                  )}
                  <button
                    className="secondary wide"
                    onClick={async () => {
                      await net.leave();
                      setWorld(null);
                      setPanel(null);
                    }}
                  >
                    작업장 나가기
                  </button>
                  <small className="muted">
                    진행은 보존됩니다. 들고 있던 자원은 마지막 위치의 공용
                    상자에 남습니다.
                  </small>
                </>
              )}
              {panel === "help" && (
                <>
                  <h3>고철 하나부터 시작해요</h3>
                  <ol>
                    <li>밝은 채집 지점 근처에서 E를 눌러 원료를 모읍니다.</li>
                    <li>수동 작업대에 원료를 넣고 제조법을 골라 작업합니다.</li>
                    <li>완성품을 가방으로 수거해 로켓 앞에 납품합니다.</li>
                    <li>자재를 모두 채운 다음 조립하면 새 설비가 열립니다.</li>
                    <li>자동 가공기 → 배송 허브 → 수거기로 공장을 키웁니다.</li>
                  </ol>
                  <p>
                    WASD / 방향키 이동 · E 작업 · B 건설 · R 회전 · F 카메라
                    복귀 · 휠 확대
                  </p>
                  <div className="notice">
                    제작과 채집 켜기 버튼은 누르고 있지 않아도 반복합니다.
                    이동·패널 전환·숨김 탭에서 멈춥니다.
                  </div>
                  <h3>가방이 가득 찼다면</h3>
                  <p>
                    창고 앞에서 ‘공용으로 임시 보관’을 사용하고 작업대
                    입력·출력을 직접 비우세요.
                  </p>
                  <h3>배송을 바꾸려면</h3>
                  <p>
                    송신 중지 → 남은 화물 도착 → 수정 또는 철거. 설비 이동은
                    재고를 모두 수거하고 링크를 제거한 뒤 가능합니다.
                  </p>
                </>
              )}
            </Panel>
          )}
          {world.offer?.to === net.member && (
            <div className="center-modal">
              <h2>소유권 이전 제안</h2>
              <p>이 작업장의 소유자가 되시겠습니까?</p>
              <button
                className="primary"
                onClick={() =>
                  void send("ACCEPT_OWNERSHIP", { offerId: world.offer!.id })
                }
              >
                수락
              </button>
            </div>
          )}
          {world.phase === "LAUNCH_VOTE" && world.vote && (
            <div className="center-modal">
              <span className="eyebrow">READY FOR LIFT-OFF</span>
              <h2>우주로 떠날 준비됐나요?</h2>
              <p>현재 참여자 모두의 동의가 필요합니다.</p>
              <div className="vote-list">
                {world.vote.eligible.map((id) => (
                  <span key={id}>
                    {world.vote!.yes.includes(id) ? "✓" : "○"}{" "}
                    {world.members[id].name}
                  </span>
                ))}
              </div>
              <button
                className="primary wide"
                onClick={() =>
                  void send("CAST_VOTE", { voteId: world.vote!.id, yes: true })
                }
              >
                발사에 동의
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void send("CANCEL_LAUNCH", { attemptId: world.vote!.id })
                }
              >
                잠깐, 아직 준비 중이에요
              </button>
            </div>
          )}
          {world.phase === "COUNTDOWN" && (
            <div className="countdown-overlay">
              <span>모두의 꿈이 이륙합니다</span>
              <strong>
                {Math.ceil(
                  (world.countdown * R.timers_ms.simulation_tick) / 1000,
                )}
              </strong>
              <button
                onClick={() =>
                  void send("CANCEL_LAUNCH", { attemptId: world.attempt })
                }
              >
                발사 취소
              </button>
            </div>
          )}
          {world.phase === "LAUNCHED" && world.result && !resultHidden && (
            <div className="result-card">
              <span className="eyebrow">MISSION ACCOMPLISHED</span>
              <Symbol size={58} />
              <h1>고철이 우주에 닿았어요.</h1>
              <p>
                {world.result.members.join(" · ")}
                <br />
                함께 만든 첫 번째 로켓
              </p>
              <div className="result-metrics">
                <span>
                  <b>{Math.floor((Number(world.result.tick) * 0.05) / 60)}</b>
                  분의 작업
                </span>
                <span>
                  <b>{world.result.maxPlayers}</b>명의 동료
                </span>
                <span>
                  <b>{world.result.delivered}</b>번의 자동 배송
                </span>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setResultHidden(true);
                  setOverview(true);
                }}
              >
                완성된 작업장 둘러보기
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  await net.leave();
                  setWorld(null);
                  setLanding("create");
                }}
              >
                새 로켓 만들기
              </button>
            </div>
          )}
        </>
      )}
      {secretKey && (
        <div className="secret-backdrop">
          <div className="secret-card">
            <span className="eyebrow">KEEP YOUR WORKSHOP SAFE</span>
            <h2>작업장 복구 키</h2>
            <p>
              브라우저를 바꿔도 소유권을 되찾을 수 있는 키입니다. 따로 안전하게
              보관해 주세요.
            </p>
            <p>
              작업장 ID: <code>{net.roomId}</code>
            </p>
            <textarea readOnly value={secretKey} aria-label="복구 키" />
            <button
              className="primary wide"
              onClick={() => void navigator.clipboard.writeText(secretKey)}
            >
              복구 키 복사
            </button>
            <button className="secondary wide" onClick={() => setSecretKey("")}>
              보관했어요 · 닫기
            </button>
            <small>
              이 키는 초대 코드와 다릅니다. 다른 사람에게 공유하지 마세요.
            </small>
          </div>
        </div>
      )}
      {error && (
        <div className="toast" role="status">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="알림 닫기">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
