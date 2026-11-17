import React, { useState } from "react";
import {
  CHARACTERS,
  MACHINE_CATALOG,
  MACHINE_GRADES,
  MACHINE_UPGRADE_COST,
  MACHINE_UPGRADE_XP,
  MACHINE_TIER_SPEED,
  VEIN_UPGRADE_COST,
  VEIN_UPGRADE_XP,
  DEVICE_PRICE,
  UPGRADES,
  ITEM,
  SOURCES,
  level,
  hands,
  carryCapacity,
  deviceUnlocked,
  researchCost,
  reachable,
  machinePort,
  type World,
  type Player,
  type Command,
  type MachineKind,
  type DeviceKind,
} from "../../../../packages/carry-core/src/index.ts";
export function CharacterPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="character-grid" aria-label="캐릭터 선택">
      {CHARACTERS.map((c) => (
        <button
          type="button"
          key={c.id}
          aria-pressed={value === c.id}
          onClick={() => onSelect(c.id)}
        >
          <img
            src={`/assets/visuals/1.1.0/previews/${c.preview}`}
            alt={c.description}
          />
          <strong>{c.name}</strong>
          <small>{value === c.id ? "선택됨" : c.description}</small>
        </button>
      ))}
    </div>
  );
}
export function WorkshopPanel({
  world: w,
  player: p,
  initial = "shop",
  send,
}: {
  world: World;
  player: Player;
  initial?: string;
  send: (type: Command["type"], data?: Partial<Command>) => void;
}) {
  const [tab, setTab] = useState(initial),
    money = w.economy.coins,
    xp = w.economy.xp,
    space = hands(p).length < carryCapacity(w);
  const tabs = [
    ["shop", "설비 구매"],
    ["research", "성장 연구"],
    ["machines", "설비 강화"],
    ["veins", "광맥 개발"],
    ["characters", "캐릭터"],
  ];
  return (
    <div className="workshop-panel">
      <div className="shop-wallet">
        <b>{money.toLocaleString()} 코인</b>
        <span>{xp.toLocaleString()} XP · 팀 공유</span>
      </div>
      <nav aria-label="공방 메뉴">
        {tabs.map(([id, title]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {title}
          </button>
        ))}
      </nav>
      {tab === "shop" && (
        <>
          <p className="panel-intro">
            상자를 구매한 뒤 직접 들고 <b>설치 모드 → 바닥 클릭</b>으로
            놓으세요. R로 방향을 바꿉니다.{" "}
            {Object.keys(w.machines).length === 0
              ? "첫 설비는 40코인 낡은 작업대를 추천합니다."
              : ""}
          </p>
          {!space && (
            <p className="shop-note">
              운반 칸이 가득 찼습니다. 물건을 내려놓은 뒤 구매하세요.
            </p>
          )}
          <div className="shop-grid">
            {Object.entries(MACHINE_CATALOG).map(([id, m]) => (
              <article key={id}>
                <div className="shop-card-top">
                  <span>가공 설비</span>
                  <b>{m.price} ◈</b>
                </div>
                <h3>{m.name}</h3>
                <p>{m.description}</p>
                <small>기본 생산속도 55% · 출력 2칸 · 4등급까지 강화</small>
                <button
                  disabled={!space || money < m.price || xp < m.xp}
                  onClick={() =>
                    send("BUY_MACHINE", { machine: id as MachineKind })
                  }
                >
                  {xp < m.xp
                    ? `${m.xp} XP 필요`
                    : `${m.price} 코인 · 상자 구매`}
                </button>
              </article>
            ))}
          </div>
          <h3>자동화·운반 설비</h3>
          <div className="shop-grid">
            {Object.entries(DEVICE_PRICE).map(([id, price]) => (
              <article key={id}>
                <div className="shop-card-top">
                  <span>운반 설비</span>
                  <b>{price} ◈</b>
                </div>
                <h3>
                  {ITEM[`kit_${id as DeviceKind}`].name.replace(" 상자", "")}
                </h3>
                <p>
                  {id === "tray"
                    ? "공정 사이에 잠시 보관"
                    : id === "miner"
                      ? "광맥에서 1개씩 자동 채굴"
                      : id === "installer"
                        ? "현재 단계의 맞는 부품 자동 설치"
                        : id === "crane"
                          ? "기계 출력에서 다음 라인으로 수거"
                          : "재료를 한 칸씩 전달 · 막히면 안전하게 대기"}
                </p>
                <button
                  disabled={
                    !space ||
                    money < price ||
                    !deviceUnlocked(w, id as DeviceKind)
                  }
                  onClick={() =>
                    send("BUY_DEVICE", { device: id as DeviceKind })
                  }
                >
                  {!deviceUnlocked(w, id as DeviceKind)
                    ? "성장 연구에서 해금"
                    : `${price} 코인 · 상자 구매`}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "research" && (
        <>
          <p className="panel-intro">
            운반량은 <b>1→8개</b>까지 한 칸씩 늘어납니다. 후반 비용과 XP 조건이
            높아지며, 이동속도는 최대 +30%입니다. XP는 소비하지 않습니다.
          </p>
          <div className="research-grid">
            {[
              ["carry", "운반량"],
              ["speed", "이동속도"],
              ["handling", "무거운 짐 운반"],
              ["tool", "채굴 도구"],
              ["rail", "레일 모터"],
              ["processing", "가공 조율"],
              ["automation", "자동화 해금"],
            ].map(([branch, title]) => {
              const entries = Object.entries(UPGRADES).filter(
                ([, u]) => u.branch === branch,
              );
              return (
                <section key={branch}>
                  <header>
                    <h3>{title}</h3>
                    <span>
                      {
                        entries.filter(([k]) => w.economy.upgrades.includes(k))
                          .length
                      }
                      /{entries.length}
                    </span>
                  </header>
                  <div className="research-track">
                    {entries.map(([key, u]) => {
                      const owned = w.economy.upgrades.includes(key),
                        cost = researchCost(w, u.cost),
                        prereq =
                          !u.requires ||
                          w.economy.upgrades.includes(u.requires);
                      return (
                        <article
                          key={key}
                          className={
                            owned ? "owned" : prereq ? "available" : ""
                          }
                        >
                          <div>
                            <strong>{u.name}</strong>
                            <p>{u.description}</p>
                            <small>
                              {cost} ◈ · {u.xp} XP
                              {u.requires && !prereq
                                ? ` · ${UPGRADES[u.requires].name} 먼저`
                                : ""}
                            </small>
                          </div>
                          <button
                            disabled={
                              owned || !prereq || money < cost || xp < u.xp
                            }
                            onClick={() => send("UPGRADE", { upgrade: key })}
                          >
                            {owned ? "완료" : !prereq ? "잠김" : "연구"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
      {tab === "machines" && (
        <>
          <p className="panel-intro">
            설비를 직접 강화합니다. 입출력을 비우고 가까이 이동하면 강화하거나
            상자로 회수할 수 있습니다. <b>낡은 → 개량 → 산업 → 정밀</b> 순서로
            생산속도와 출력 공간이 늘어납니다.
          </p>
          {!Object.keys(w.machines).length && (
            <p>먼저 설비 구매에서 작업대를 구입해 설치하세요.</p>
          )}
          <div className="shop-grid">
            {Object.values(w.machines).map((m) => {
              const near = [machinePort(m), machinePort(m, true)].some((a) =>
                  reachable(w, p.pos, a),
                ),
                empty = !m.job && !m.input.length && !m.output.length,
                cost =
                  m.tier < 3
                    ? researchCost(w, MACHINE_UPGRADE_COST[m.tier])
                    : 0;
              return (
                <article key={m.id}>
                  <div className="shop-card-top">
                    <span>
                      {MACHINE_GRADES[m.tier]} · {m.tier + 1}/4등급
                    </span>
                    <b>
                      {m.pos.x}, {m.pos.z}
                    </b>
                  </div>
                  <h3>
                    {MACHINE_CATALOG[m.type as MachineKind]?.name ?? m.type}
                  </h3>
                  <p>
                    생산속도 {Math.round(MACHINE_TIER_SPEED[m.tier] * 100)}% ·
                    출력 {2 + m.tier}칸
                    {m.tier < 3
                      ? ` → ${Math.round(MACHINE_TIER_SPEED[m.tier + 1] * 100)}% · ${3 + m.tier}칸`
                      : ""}
                  </p>
                  {m.type === "bench" && (
                    <small>
                      {m.tier === 0
                        ? "다음: 회로·선체·연료·설비 상자 해금"
                        : m.tier === 1
                          ? "다음: 엔진·항법 부품 해금"
                          : "모든 공정 사용 가능"}
                    </small>
                  )}
                  <button
                    disabled={
                      !near ||
                      !empty ||
                      m.tier >= 3 ||
                      money < cost ||
                      xp < MACHINE_UPGRADE_XP[m.tier]
                    }
                    onClick={() => send("UPGRADE_MACHINE", { target: m.id })}
                  >
                    {!near
                      ? "기계 가까이 이동"
                      : !empty
                        ? "입출력을 비워 주세요"
                        : m.tier >= 3
                          ? "최고 등급"
                          : `${cost} 코인 · ${MACHINE_UPGRADE_XP[m.tier]} XP · 강화`}
                  </button>
                  <button
                    disabled={!near || !empty || !space}
                    onClick={() => send("PACK_MACHINE", { target: m.id })}
                  >
                    강화 상태 유지하고 회수
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
      {tab === "veins" && (
        <>
          <p className="panel-intro">
            각 광맥을 별도로 개발합니다. 수량은 1개로 유지하고{" "}
            <b>품질과 채굴 속도</b>를 올립니다. 혼합 부품은 가장 낮은 재료
            품질을 이어받으므로 한 광맥만 올려도 모든 부품 값이 오르지는
            않습니다.
          </p>
          <div className="shop-grid">
            {SOURCES.map((s) => {
              const v = w.veins[s.kind]!,
                cost = researchCost(w, VEIN_UPGRADE_COST[v.level] ?? 0);
              return (
                <article key={s.kind}>
                  <div className="shop-card-top">
                    <span>광맥 {v.level + 1}/5등급</span>
                    <b>{v.extracted}개 채굴</b>
                  </div>
                  <h3>{ITEM[s.kind].name} 광맥</h3>
                  <p>
                    품질 판매가 +{v.level * 15}% · 채굴 시간 ÷
                    {(1 + v.level * 0.12).toFixed(2)}
                  </p>
                  <small>
                    다음 등급: 판매가 +{Math.min(4, v.level + 1) * 15}% · 수량
                    증가 없음
                  </small>
                  <button
                    disabled={
                      v.level >= 4 ||
                      money < cost ||
                      xp < VEIN_UPGRADE_XP[v.level]
                    }
                    onClick={() => send("UPGRADE_VEIN", { target: s.kind })}
                  >
                    {v.level >= 4
                      ? "최고 등급"
                      : `${cost} 코인 · ${VEIN_UPGRADE_XP[v.level]} XP · 개발`}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
      {tab === "characters" && (
        <>
          <p className="panel-intro">
            모든 캐릭터의 능력은 같습니다. 각 플레이어가 따로 선택하며 작업장에
            함께 표시됩니다.
          </p>
          <CharacterPicker
            value={p.avatar}
            onSelect={(avatar) => send("AVATAR", { avatar })}
          />
        </>
      )}
    </div>
  );
}
