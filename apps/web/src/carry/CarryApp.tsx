import { CarryAudio } from "./audio";
import { ZOOM } from "./zoom";
import { workProgress, progressText } from "./work-progress";
import { WorkshopPanel, CharacterPicker } from "./WorkshopPanel";
import { APP_VERSION } from "../../../../packages/carry-core/src/version.ts";
import React, { useEffect, useRef, useState } from "react";
import { CarryConnection } from "./network";
import { CarryView, type Mode, type Settings } from "./view";
import {
  ITEM,
  automaticRecipe,
  recipe,
  type Kind,
  machineCapacity,
  machineSpeed,
  machineKind,
  itemValue,
  level,
  startingFunds,
  SOURCES,
  VEIN_UNLOCKS,
  veinUnlocked,
  recipeAvailable,
  researchCost,
  INSTALL_VALUE,
  type MachineKind,
  RECIPES,
  REWARDS,
  PROFILES,
  UPGRADES,
  hands,
  carryCapacity,
  deviceUnlocked,
  COLORS,
  MAP,
  machinePort,
  targets,
  reachable,
  currentStage,
  placementReason,
  type World,
  type DeviceKind,
  type Command,
  type V3,
} from "../../../../packages/carry-core/src/index.ts";
import { screenMovement } from "../visuals/camera";
import "./carry.css";
const devices: [DeviceKind, string][] = [
  ["straight", "직선"],
  ["corner", "↱ 코너"],
  ["crane", "크레인"],
  ["tray", "트레이"],
  ["miner", "채굴기"],
  ["installer", "설치기"],
];
const defaults: Settings = {
  low: false,
  renderScale: 1,
  lock: false,
  distance: ZOOM.initial,
};
export default function CarryApp() {
  const host = useRef<HTMLDivElement>(null),
    net = useRef(new CarryConnection()),
    view = useRef<CarryView | null>(null),
    keys = useRef(new Set<string>()),
    world = useRef<World | null>(null),
    modeRef = useRef<Mode>(null),
    modalRef = useRef(""),
    audio = useRef(new CarryAudio());
  const [hud, setHud] = useState<World | null>(null),
    [mode, setMode] = useState<Mode>(null),
    [modal, setModal] = useState(""),
    [status, setStatus] = useState(""),
    [graphics, setGraphics] = useState(""),
    [metrics, setMetrics] = useState<any>(null),
    [name, setName] = useState("작업자"),
    [avatar, setAvatar] = useState("worker"),
    [code, setCode] = useState(""),
    [planned, setPlanned] = useState(1),
    [profile, setProfile] = useState("campaign"),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<Settings>(defaults),
    [sound, setSound] = useState(true),
    [volume, setVolume] = useState(0.45),
    [ui, setUi] = useState(1),
    [attempt, setAttempt] = useState(0);
  const stop = () => {
    keys.current.clear();
    net.current.setInput({ x: 0, z: 0 });
    if (view.current) view.current.localInput = { x: 0, z: 0 };
  };
  const changeMode = (m: Mode) => {
    stop();
    modeRef.current = m;
    setMode(m);
    if (view.current) view.current.mode = m;
  };
  const openModal = (m: string) => {
    stop();
    modalRef.current = m;
    setModal(m);
  };
  useEffect(() => {
    const unlock = () => {
      void audio.current.unlock();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      audio.current.dispose();
    };
  }, []);
  useEffect(() => {
    audio.current.configure(sound, volume);
  }, [sound, volume]);
  useEffect(() => {
    const n = net.current;
    n.onWorld = (w, rtt) => {
      world.current = w;
      audio.current.observe(w, n.session?.member ?? "");
      if (view.current) {
        view.current.receive(w, n.session!.member, rtt);
      }
    };
    n.onStatus = (s) => {
      if (n.stopped) stop();
      setStatus(s);
    };
    n.onAck = (r) => {
      setStatus(r.message);
      audio.current.ack(r);
      if (r.ok && ["설비 설치 완료", "기계 설치 완료"].includes(r.message))
        changeMode(null);
    };
    const t = setInterval(() => {
      setHud(n.world);
    }, 250);
    return () => {
      clearInterval(t);
      stop();
      void n.stop();
    };
  }, []);
  useEffect(() => {
    const v = new CarryView(host.current!);
    view.current = v;
    v.motion = net.current.movement;
    v.onError = (s) => {
      setGraphics(s);
      if (s) stop();
    };
    v.onMetrics = setMetrics;
    v.onZoom = (distance) => setSettings((s) => ({ ...s, distance }));
    v.canZoom = () => !modalRef.current;
    v.onStep = () => audio.current.play("step");
    if (world.current)
      v.receive(
        world.current,
        net.current.session?.member ?? "",
        net.current.rtt,
      );
    v.member = net.current.session?.member ?? "";
    v.applySettings(settings);
    setGraphics(v.error);
    v.onGround = (p) => {
      if (!v.ready || modalRef.current || net.current.stopped) return;
      const m = modeRef.current;
      if (m?.kind === "ping") {
        net.current.command("PING", { x: p.x, z: p.z });
        changeMode(null);
      } else if (m) {
        changeMode({ ...m, x: p.x, z: p.z });
        place(p);
      }
    };
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    view.current?.applySettings(settings);
  }, [settings]);
  function place(at?: V3) {
    const m = modeRef.current,
      w = world.current,
      member = net.current.session?.member ?? "",
      p = w?.players[member] ? net.current.movement.player(w, member) : null;
    if (!m || m.kind === "ping" || !p) return;
    const reach = m.kind === "machine" ? 2.5 : 1.4,
      x = at?.x ?? m.x ?? Math.round((p.pos.x + p.facing.x * reach) * 2) / 2,
      z = at?.z ?? m.z ?? Math.round((p.pos.z + p.facing.z * reach) * 2) / 2;
    net.current.command(m.kind === "machine" ? "PLACE_MACHINE" : "PLACE", {
      ...(m.kind === "machine" ? { machine: m.machine } : { device: m.device }),
      x,
      z,
      rotation: m.rotation,
    });
  }
  function placeHeld() {
    const w = world.current,
      p = w?.players[net.current.session?.member ?? ""],
      item = p?.hand ? w?.items[p.hand] : null;
    if (!item?.kind.startsWith("kit_")) return;
    const key = item.kind.slice(4);
    changeMode(
      machineKind(key)
        ? { kind: "machine", machine: key, rotation: 0 }
        : { kind: "place", device: key as DeviceKind, rotation: 0 },
    );
  }
  function act(type: Command["type"]) {
    const n = net.current,
      w = world.current;
    if (!w || !view.current?.ready || n.stopped || modalRef.current) return;
    const p = n.movement.player(w, n.session!.member);
    if (type === "INTERACT") {
      if (modeRef.current && modeRef.current.kind !== "ping") {
        place();
        return;
      }
      if (modeRef.current) return;
      if (p.hand && w.items[p.hand].kind.startsWith("kit_")) {
        placeHeld();
        return;
      }
      const t = targets(w, p)[0];
      if (t) n.command("INTERACT", { target: t.id });
      else
        setStatus(
          p.hand
            ? "가까운 입력 받침대나 설치 소켓으로 이동하세요."
            : "광맥 가까이에서 E를 누르면 쉽게 캘 수 있습니다.",
        );
    } else if (!modeRef.current) n.command(type);
  }
  useEffect(() => {
    const editable = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      !!el.closest("input,textarea,select,[contenteditable=true]");
    const updateInput = () => {
      const k = keys.current,
        held = (a: string, b: string) => Number(k.has(a) || k.has(b));
      const next =
        modalRef.current || !view.current?.ready || net.current.stopped
          ? { x: 0, z: 0 }
          : screenMovement(
              held("KeyD", "ArrowRight") - held("KeyA", "ArrowLeft"),
              held("KeyS", "ArrowDown") - held("KeyW", "ArrowUp"),
            );
      net.current.setInput(next);
      if (view.current) view.current.localInput = next;
    };
    const down = (e: KeyboardEvent) => {
      if (editable(e.target)) return;
      if (e.code === "Escape") {
        e.preventDefault();
        if (e.repeat) return;
        if (modalRef.current) openModal("");
        else if (modeRef.current) changeMode(null);
        else openModal("menu");
        return;
      }
      if (modalRef.current || !view.current?.ready || net.current.stopped)
        return;
      const gameKeys = [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowLeft",
        "ArrowDown",
        "ArrowRight",
        "KeyE",
        "KeyF",
        "Space",
        "KeyC",
        "KeyG",
        "KeyR",
        "Digit1",
        "Digit2",
        "Digit3",
        "Digit4",
        "Digit5",
        "Digit6",
        "KeyQ",
        "Slash",
      ];
      if (!gameKeys.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat || keys.current.has(e.code)) return;
      keys.current.add(e.code);
      updateInput();
      if (e.code === "KeyE") act("INTERACT");
      if (e.code === "KeyQ") act("SELECT_HAND");
      if (e.code === "Space") act("DROP");
      if (e.code === "KeyF") act("THROW");
      if (e.code === "KeyC") view.current.recenter();
      if (e.code === "KeyG")
        changeMode(modeRef.current?.kind === "ping" ? null : { kind: "ping" });
      if (e.code === "Slash") openModal("help");
      if (e.code.startsWith("Digit")) {
        const d = devices[Number(e.code.slice(-1)) - 1];
        if (d) {
          const w = world.current;
          if (w && !deviceUnlocked(w, d[0]))
            setStatus("팀 업그레이드에서 자동화를 먼저 해금하세요.");
          else changeMode({ kind: "place", device: d[0], rotation: 0 });
        }
      }
      if (
        e.code === "KeyR" &&
        modeRef.current &&
        modeRef.current.kind !== "ping"
      )
        changeMode({
          ...modeRef.current,
          rotation:
            (modeRef.current.rotation + 1) %
            (modeRef.current.kind === "place" &&
            modeRef.current.device === "corner"
              ? 8
              : 4),
        });
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      updateInput();
    };
    const focus = (e: FocusEvent) => {
      if (editable(e.target)) stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("focusin", focus);
    const t = setInterval(() => {
      if (document.hidden) stop();
      else updateInput();
    }, 40);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("focusin", focus);
    };
  }, []);
  useEffect(() => {
    const resize = () => {
      const base = Math.max(
        1,
        Math.min(1.8, innerWidth / 1440, innerHeight / 900),
      );
      document.documentElement.style.setProperty(
        "--carry-scale",
        String(base * ui),
      );
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [ui]);
  async function enter(action: "create" | "join" | "resume") {
    setBusy(true);
    setStatus("작업장에 연결하는 중…");
    try {
      if (action === "resume") await net.current.resume();
      else
        await net.current.start(action, name, code, planned, profile, avatar);
      setHud(net.current.world);
      openModal("");
      view.current?.recenter();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const member = net.current.session?.member ?? "",
    me = hud?.players[member]
      ? net.current.movement.player(hud, member)
      : undefined,
    held = me?.hand ? hud?.items[me.hand] : null,
    stage = hud ? currentStage(hud) : -1,
    stageData = hud ? PROFILES[hud.profile].stages[stage] : null,
    sockets = hud?.sockets.filter((s) => s.stage === stage) ?? [],
    done = hud?.sockets.filter((s) => s.item).length ?? 0,
    total = hud?.sockets.length ?? 1,
    near = me && hud ? targets(hud, me)[0] : null;
  const machine =
    me && hud
      ? Object.values(hud.machines).find((m) =>
          [machinePort(m), machinePort(m, true)].some((p) =>
            reachable(hud, me.pos, p),
          ),
        )
      : null;
  const mm = (x: number, z: number) => ({
    x: ((x - MAP.minX) / (MAP.maxX - MAP.minX)) * 200,
    y: ((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * 100,
  });
  const actionDisabled = !view.current?.ready || net.current.stopped;
  return (
    <main className="carry-game">
      <div ref={host} className="carry-world" />
      {!hud && (
        <div className="carry-lobby">
          <div className="carry-brand">
            FROM SCRAP TO SPACE{" "}
            <span>CO-OP WORKSHOP / 01—06 · v{APP_VERSION}</span>
          </div>
          <h1>
            고철에서
            <br />
            <em>우주까지.</em>
          </h1>
          <p>
            한 사람의 손에서, 모두의 로켓으로.
            <br />
            낡은 작업대 하나에서, 내 손으로 우주까지.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void enter("create");
            }}
          >
            <label>
              작업자 이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={18}
                required
              />
            </label>
            <CharacterPicker value={avatar} onSelect={setAvatar} />
            <small>
              캐릭터 능력은 동일합니다 · 시작 {startingFunds(planned)} 코인 ·
              낡은 작업대 1대 · 철광석부터
            </small>
            <div className="carry-form-row">
              <label>
                난이도 기준 인원
                <select
                  value={planned}
                  onChange={(e) => setPlanned(+e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                진행 규칙
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="campaign">본편 · 여섯 조립 단계</option>
                  <option value="lab">개발 검증 · 철판 4개</option>
                </select>
              </label>
            </div>
            <button className="primary" disabled={busy}>
              새 협동 작업장
            </button>
          </form>
          <div className="carry-join">
            <input
              aria-label="방 코드"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="방 코드 8자리"
              maxLength={8}
            />
            <button
              disabled={busy || code.length !== 8}
              onClick={() => void enter("join")}
            >
              참가
            </button>
          </div>
          <button disabled={busy} onClick={() => void enter("resume")}>
            최근 작업장 이어하기
          </button>
          <small>
            진행 중 입퇴장해도 목표량은 유지됩니다. 기존 v1 저장은 별도로
            보존됩니다. <a href="/legacy">이전 규칙 열기</a>
          </small>
          <p role="status">{status}</p>
        </div>
      )}
      {hud && (
        <>
          <div className="carry-crew hud-panel">
            <div className="carry-room">
              <span className="eyebrow">
                WORKSHOP / {hud.profile === "lab" ? "개발 검증" : "본편"}
              </span>
              <button
                title="방 코드 복사"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(hud.code)
                    .then(() => setStatus("방 코드를 복사했습니다."))
                    .catch(() =>
                      setStatus(
                        "복사하지 못했습니다. 방 코드를 직접 선택해 주세요.",
                      ),
                    )
                }
              >
                {hud.code} ⧉
              </button>
            </div>
            {Object.values(hud.players)
              .filter((p) => p.connected)
              .map((p) => (
                <div className="crew-row" key={p.id}>
                  <b style={{ background: COLORS[p.seat] }}>{p.seat + 1}</b>
                  <span>
                    {p.name}
                    {p.id === me?.id ? " · 나" : ""}
                  </span>
                  <small>
                    {hands(p).length ? `${hands(p).length}개 운반` : "빈손"}
                  </small>
                </div>
              ))}
            <small>
              기준 {hud.planned}명 · 현재{" "}
              {Object.values(hud.players).filter((p) => p.connected).length}/6명
            </small>
            <button
              className="economy-button"
              onClick={() => openModal("upgrades")}
            >
              {hud.economy.coins} ◈ · {hud.economy.xp} XP · 성장
            </button>
            <div className="crew-shop">
              <button onClick={() => openModal("shop")}>설비 구매</button>
              <button onClick={() => openModal("characters")}>캐릭터</button>
            </div>
          </div>
          <section className="carry-progress hud-panel">
            <div className="progress-title">
              <span className="eyebrow">BUILD TOGETHER</span>
              <time>
                {Math.floor(hud.time / 60)
                  .toString()
                  .padStart(2, "0")}
                :
                {Math.floor(hud.time % 60)
                  .toString()
                  .padStart(2, "0")}
              </time>
            </div>
            <strong>
              {stageData?.name ??
                (hud.phase === "LAUNCHED" ? "발사 성공!" : "발사 준비 완료")}
            </strong>
            <div className="stage-parts">
              {[...new Set(sockets.map((s) => s.kind))].map((k) => (
                <span key={k}>
                  {ITEM[k].name}{" "}
                  <b>
                    {sockets.filter((s) => s.kind === k && s.item).length}/
                    {sockets.filter((s) => s.kind === k).length}
                  </b>
                </span>
              ))}
            </div>
            <div className="progress-track">
              <i style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <small>전체 준비도 {Math.round((done / total) * 100)}%</small>
          </section>
          <aside className="carry-map hud-panel">
            <svg viewBox="0 0 200 100" aria-label="작업장 미니맵">
              <rect width="200" height="100" rx="8" fill="#27313b" />
              <path
                d="M66 4V96M140 4V96"
                stroke="#61717a"
                strokeDasharray="3 4"
              />
              <text x="16" y="13">
                채굴장
              </text>
              <text x="82" y="13">
                가공장
              </text>
              <text x="152" y="13">
                발사대
              </text>
              {Object.values(hud.machines).map((m) => {
                const p = mm(m.pos.x, m.pos.z);
                return (
                  <rect
                    key={m.id}
                    x={p.x - 3}
                    y={p.y - 3}
                    width="6"
                    height="6"
                    fill="#c4d3ce"
                  />
                );
              })}
              {hud.pings.map((q) => {
                const p = mm(q.pos.x, q.pos.z);
                return (
                  <circle
                    key={q.id}
                    cx={p.x}
                    cy={p.y}
                    r="7"
                    fill="none"
                    stroke="#f59e0b"
                  />
                );
              })}
              {Object.values(hud.players)
                .filter((p) => p.connected)
                .map((p) => {
                  const a = mm(p.pos.x, p.pos.z);
                  return (
                    <circle
                      key={p.id}
                      cx={a.x}
                      cy={a.y}
                      r="3"
                      fill={COLORS[p.seat]}
                    />
                  );
                })}
            </svg>
            <div className="map-actions">
              <button
                aria-label="핑 모드"
                onClick={() =>
                  changeMode(mode?.kind === "ping" ? null : { kind: "ping" })
                }
              >
                G 핑
              </button>
              <button
                aria-label="음향 토글"
                onClick={() => {
                  setSound(!sound);
                  audio.current.configure(!sound, volume);
                  if (!sound) void audio.current.unlock();
                }}
              >
                {sound ? "♪ ON" : "♪ OFF"}
              </button>
              <button aria-label="도움말" onClick={() => openModal("help")}>
                ?
              </button>
              <button aria-label="설정" onClick={() => openModal("settings")}>
                ⚙
              </button>
            </div>
          </aside>
          <div className="zoom-controls hud-panel" aria-label="화면 거리 조절">
            <button
              aria-label="화면 확대"
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  distance: Math.max(ZOOM.min, s.distance - 2),
                }))
              }
            >
              ＋
            </button>
            <span>
              휠 줌 · {Math.round((ZOOM.initial / settings.distance) * 100)}%
            </span>
            <button
              aria-label="화면 축소"
              onClick={() =>
                setSettings((s) => ({
                  ...s,
                  distance: Math.min(ZOOM.max, s.distance + 2),
                }))
              }
            >
              −
            </button>
            <button
              aria-label="기본 화면 거리"
              onClick={() =>
                setSettings((s) => ({ ...s, distance: ZOOM.initial }))
              }
            >
              기본
            </button>
          </div>
          <div className="carry-hand hud-panel">
            <div className="hand-main">
              <div
                className="hand-icon"
                style={{
                  borderColor: held ? ITEM[held.kind].color : "#738186",
                }}
              >
                {held ? (held.kind.startsWith("kit_") ? "▣" : "◆") : "✋"}
              </div>
              <div>
                <span className="eyebrow">
                  CARRY · {me ? hands(me).length : 0}/
                  {hud ? carryCapacity(hud) : 1}
                </span>
                <strong>{held ? ITEM[held.kind].name : "빈손"}</strong>
                <small>
                  {held && ITEM[held.kind].heavy
                    ? `무거운 짐 · 속도 -${20 - level(hud, "handling") * 4}%`
                    : "Q · 사용할 물건을 바꿉니다"}
                </small>
              </div>
              <button
                disabled={actionDisabled}
                className="primary"
                onClick={() => act("INTERACT")}
              >
                {mode && mode.kind !== "ping"
                  ? "E 설비 설치"
                  : held?.kind.startsWith("kit_")
                    ? "E 설치 모드"
                    : (near?.label ?? "E 상호작용")}
              </button>
            </div>
            {me && carryCapacity(hud) > 1 && (
              <div className="carry-slots">
                {Array.from({ length: carryCapacity(hud) }, (_, n) => {
                  const id = hands(me)[n],
                    i = id ? hud.items[id] : null;
                  return (
                    <button
                      key={n}
                      disabled={!i || n === 0}
                      onClick={() =>
                        net.current.command("SELECT_HAND", { target: id })
                      }
                    >
                      <b>{n + 1}</b>{" "}
                      <span>{i ? ITEM[i.kind].name : "빈 칸"}</span>
                      {n === 0 ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="hand-actions">
              <button
                disabled={!held || actionDisabled}
                onClick={() => act("DROP")}
              >
                Space 내려놓기
              </button>
              <button
                disabled={!held || actionDisabled}
                onClick={() => act("THROW")}
              >
                F 짧게 던지기
              </button>
              <button onClick={() => view.current?.recenter()}>C 재중앙</button>
            </div>
            <div className="quickslots">
              {devices.map(([id, title], n) => (
                <button
                  key={id}
                  disabled={!deviceUnlocked(hud, id)}
                  title={
                    deviceUnlocked(hud, id)
                      ? "제작한 설비 상자를 들고 배치"
                      : "팀 업그레이드에서 해금"
                  }
                  aria-pressed={mode?.kind === "place" && mode.device === id}
                  onClick={() =>
                    changeMode({ kind: "place", device: id, rotation: 0 })
                  }
                >
                  <kbd>{n + 1}</kbd> {title}
                </button>
              ))}
            </div>
          </div>
          {mode && (
            <div className="carry-mode hud-panel">
              {mode.kind === "ping"
                ? "핑을 남길 바닥을 클릭하세요"
                : `${ITEM[`kit_${mode.kind === "machine" ? mode.machine : mode.device}`].name} · R 회전 · E/클릭 설치`}
              <button onClick={() => changeMode(null)}>Esc 취소</button>
            </div>
          )}
          {machine && !mode && (
            <div className="carry-machine hud-panel">
              <h3>재료에 맞춰 자동 가공</h3>
              {(() => {
                const held =
                  hud.players[net.current.session?.member ?? ""]?.hand;
                const input = held && hud.items[held];
                const selected = input
                  ? automaticRecipe(hud, machine, input.kind)
                  : machine.recipe;
                const r = selected ? recipe(hud, selected) : null;
                return (
                  <div className="recipe-flow">
                    <b>
                      {r
                        ? Object.entries(r.input)
                            .map(([k, n]) => `${ITEM[k as Kind].name} ${n}개`)
                            .join(" + ") + ` → ${r.name} 1개`
                        : "현재 재료를 넣을 수 없습니다"}
                    </b>
                    <span>금색 받침대에 E 투입 · 청록 받침대에서 E 받기</span>
                    {r && (
                      <span>
                        가공{" "}
                        {(r.seconds / machineSpeed(hud, machine)).toFixed(1)}초
                        · 설치 +{INSTALL_VALUE[r.output] ?? 0}코인
                      </span>
                    )}
                    <span>
                      철광석 → 철 주괴 → 철판 · 주괴를 다시 넣으면 철판을
                      만듭니다.
                    </span>
                    <span>
                      {machine.type === "workbench"
                        ? "자동화 상자는 보유 수량이 적은 설비부터 가공합니다. 원하는 상자는 설비 메뉴에서 바로 구매할 수도 있습니다."
                        : "같은 재료로 여러 부품을 만들 수 있으면 현재 로켓 단계에서 부족한 부품을 우선합니다."}
                    </span>
                    {!!machine.input.length && (
                      <span>
                        추가 재료 대기:{" "}
                        {Object.entries(recipe(hud, machine.recipe).input)
                          .map(
                            ([k, n]) =>
                              [
                                k,
                                n -
                                  machine.input.filter(
                                    (id) => hud.items[id]?.kind === k,
                                  ).length,
                              ] as const,
                          )
                          .filter(([, n]) => n > 0)
                          .map(([k, n]) => `${ITEM[k as Kind].name} ${n}개`)
                          .join(" + ") || "재료 준비 완료"}
                      </span>
                    )}
                  </div>
                );
              })()}
              {workProgress(hud)
                .filter((row) => row.id === machine.id)
                .map((row) => (
                  <div
                    className="machine-work"
                    key={row.id}
                    role="progressbar"
                    aria-label={row.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(row.ratio * 100)}
                  >
                    <div className="work-track">
                      <i style={{ width: `${row.ratio * 100}%` }} />
                    </div>
                    <b>{progressText(row)}</b>
                  </div>
                ))}
              <small>
                {machine.job
                  ? machine.job.remaining > 0
                    ? `가공 중 · ${Math.ceil(machine.job.remaining / machineSpeed(hud!, machine))}초`
                    : "완료 · 출력 공간 대기"
                  : `입력 ${machine.input.length}개 · 출력 ${machine.output.length}/${machineCapacity(machine)}`}
              </small>
              <small>
                {machine.recipe === "lab_plate"
                  ? "철광석 1개"
                  : Object.entries(RECIPES[machine.recipe]?.input ?? {})
                      .map(
                        ([k, n]) =>
                          `${ITEM[k as keyof typeof ITEM].name} ${n}개`,
                      )
                      .join(" + ")}
              </small>
              <button onClick={() => openModal("machines")}>
                이 설비 강화·회수
              </button>
            </div>
          )}
          {stage === -1 && hud.phase !== "LAUNCHED" && (
            <button
              className="carry-launch primary"
              onClick={() => act("LAUNCH")}
            >
              발사대에서 최종 발사
            </button>
          )}
          {hud.profile === "campaign" &&
            !machine &&
            !mode &&
            !veinUnlocked(hud, "cable_scrap") && (
              <div className="first-steps hud-panel">
                <b>철에서 시작하는 공방</b>
                <span>① 철광석에서 E 채굴</span>
                <span>
                  ② 작업대 금색 받침대에 투입 → 청록 받침대에서 주괴 들기
                </span>
                <span>
                  ③ 주괴를 작업대에 다시 투입 → 철판을 로켓에 설치 +1코인
                </span>
                <button onClick={() => openModal("veins")}>
                  구리 무료 해금 · {VEIN_UNLOCKS.cable_scrap.xp} XP
                </button>
              </div>
            )}
          {hud.profile === "campaign" &&
            !machine &&
            !mode &&
            veinUnlocked(hud, "cable_scrap") &&
            SOURCES.some((s) => !veinUnlocked(hud, s.kind)) && (
              <button
                className="first-steps hud-panel"
                onClick={() => openModal("veins")}
              >
                다음 광맥:{" "}
                {
                  ITEM[SOURCES.find((s) => !veinUnlocked(hud, s.kind))!.kind]
                    .name
                }{" "}
                · 해금 조건 보기
              </button>
            )}
          <div className="carry-toast" role="status">
            {status !== "연결됨" ? status : ""}
          </div>
          {net.current.stopped && (
            <button
              className="carry-reconnect primary"
              onClick={() => void enter("resume")}
            >
              작업장 다시 연결
            </button>
          )}
        </>
      )}
      {graphics && (
        <div className="carry-graphics hud-panel" role="alert">
          <strong>
            {graphics.startsWith("SCENE_UPDATE_FAILED")
              ? "화면 갱신 중 오류가 발생했습니다"
              : "3D 화면을 시작하지 못했습니다"}
          </strong>
          <p>
            {graphics.startsWith("SCENE_UPDATE_FAILED")
              ? "저장된 작업장은 유지됩니다. 3D 다시 시작으로 화면을 복구하세요."
              : graphics.startsWith("MODEL_LOAD")
                ? "모델 파일을 불러오지 못했습니다."
                : "브라우저에서 WebGL 2를 제공하지 않습니다. 실제 3D 화면과 이동을 표시할 수 없습니다."}
          </p>
          <details>
            <summary>오류 상세</summary>
            <pre>{graphics}</pre>
          </details>
          <button
            onClick={() => {
              setGraphics("");
              setAttempt((n) => n + 1);
            }}
          >
            3D 다시 시작
          </button>
        </div>
      )}
      {modal && (
        <div className="carry-modal-shade">
          <section
            className="carry-modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "help"
                ? "조작 도움말"
                : modal === "settings"
                  ? "설정"
                  : [
                        "upgrades",
                        "shop",
                        "machines",
                        "veins",
                        "characters",
                      ].includes(modal)
                    ? "공방 성장"
                    : "메뉴"
            }
          >
            <button className="modal-close" onClick={() => openModal("")}>
              닫기 ×
            </button>
            <h2>
              {modal === "help"
                ? "손에서 손으로, 우주까지"
                : modal === "settings"
                  ? "작업 환경"
                  : [
                        "upgrades",
                        "shop",
                        "machines",
                        "veins",
                        "characters",
                      ].includes(modal)
                    ? "내 손으로 키우는 공방"
                    : "작업장 메뉴"}
            </h2>
            <p className="carry-version">현재 버전 {APP_VERSION}</p>
            {modal === "help" ? (
              <>
                <p>
                  새 작업장은 0코인·낡은 작업대 1대·철광석으로 시작합니다. 광맥
                  개발에서 구리·규석·석탄을 순서대로 해금하세요. 광맥에서 E로
                  쉽게 채굴한 뒤 가공기 입력 받침대 → 출력 부품 → 발사대 소켓
                  순서로 옮깁니다. 단계가 높은 부품을 만들수록 가공 XP와 로켓
                  설치 보상을 더 받습니다. 기본 철 부품은 1코인부터 시작합니다.
                  회로·선체·연료는 24 XP, 엔진·항법 부품은 50 XP에서 열립니다.
                  설비 강화는 속도를 높입니다. 기계 가까이에서 제작 항목을 바꿀
                  수 있습니다.
                </p>
                <dl>
                  {[
                    ["WASD / 방향키", "화면 기준 이동"],
                    ["E", "채굴 · 물건 들기 · 투입 · 설치"],
                    ["Q", "사용할 운반물 변경"],
                    ["Space / F", "내려놓기 / 짧게 던지기"],
                    ["1—6 / R", "설비 청사진 / 배치 회전"],
                    ["C / G", "카메라 재중앙 / 팀 핑"],
                    ["마우스 휠", "위로 확대 · 아래로 축소"],
                    ["Esc", "모드 취소 · 창 닫기"],
                  ].map(([a, b]) => (
                    <div key={a}>
                      <dt>{a}</dt>
                      <dd>{b}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  팀 자금으로 자동화를 해금한 뒤 작업대에서 설비 상자를 제작하고
                  직접 들고 설치합니다. 컨베이어가 막히면 멈추고, 크레인이 든
                  물건은 내려놓을 때까지 집을 수 없습니다.
                </p>
                <p>
                  입퇴장해도 처음 선택한 기준 인원과 소켓 수량은 유지됩니다.
                  동료와는 통과하며 기계·벽에는 막힙니다.
                </p>
              </>
            ) : [
                "upgrades",
                "shop",
                "machines",
                "veins",
                "characters",
              ].includes(modal) &&
              hud &&
              me ? (
              <WorkshopPanel
                key={modal}
                world={hud}
                player={me}
                initial={modal === "upgrades" ? "research" : modal}
                send={(type, data) => net.current.command(type, data)}
              />
            ) : modal === "settings" ? (
              <>
                <label>
                  효과음 음량 · {Math.round(volume * 100)}%
                  <input
                    aria-label="효과음 음량"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={volume}
                    onChange={(e) => setVolume(+e.target.value)}
                  />
                </label>
                <label>
                  UI 크기
                  <input
                    aria-label="UI 크기"
                    type="range"
                    min=".85"
                    max="1.6"
                    step=".05"
                    value={ui}
                    onChange={(e) => setUi(+e.target.value)}
                  />
                </label>
                <label>
                  3D 내부 렌더 해상도
                  <input
                    aria-label="렌더 해상도"
                    type="range"
                    min=".5"
                    max="1"
                    step=".1"
                    value={settings.renderScale}
                    onChange={(e) =>
                      setSettings({ ...settings, renderScale: +e.target.value })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.low}
                    onChange={(e) =>
                      setSettings({ ...settings, low: e.target.checked })
                    }
                  />
                  저사양 모델·그림자 축소
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.lock}
                    onChange={(e) =>
                      setSettings({ ...settings, lock: e.target.checked })
                    }
                  />
                  현재 작업 구역에 카메라 고정
                </label>
                <label>
                  카메라 거리 · 휠 위로 확대 / 아래로 축소
                  <input
                    aria-label="카메라 거리"
                    type="range"
                    min={ZOOM.min}
                    max={ZOOM.max}
                    step=".5"
                    value={settings.distance}
                    onChange={(e) =>
                      setSettings({ ...settings, distance: +e.target.value })
                    }
                  />
                </label>
                <details>
                  <summary>실행 측정값</summary>
                  <pre>{JSON.stringify(metrics, null, 2)}</pre>
                </details>
              </>
            ) : (
              <>
                <button onClick={() => openModal("help")}>조작 도움말</button>
                <button onClick={() => openModal("settings")}>화면 설정</button>
                <button
                  onClick={() => {
                    stop();
                    void net.current.stop().then(() => {
                      setHud(null);
                      world.current = null;
                      if (view.current) view.current.world = null;
                      openModal("");
                    });
                  }}
                >
                  저장된 작업장 나가기
                </button>
                <small>
                  서버가 반영한 물건과 가공 상태는 자동 저장됩니다. 들고 있던
                  물건은 안전한 바닥에 반환합니다.
                </small>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
