import React, { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { viewControl } from "./visuals/camera";
import { manifestHash } from "./visuals/assets";
import {
  REVIEW_STORAGE_KEY,
  restoreReview,
  reviewReady,
  type ReviewRecord,
} from "./visuals/review-state";
import "./style.css";
import catalog from "../../../design/asset_catalog_v1_1.json";
export default function Pilot({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const [saved] = useState(() => {
    try {
      return restoreReview(localStorage.getItem(REVIEW_STORAGE_KEY));
    } catch {
      return restoreReview(null);
    }
  });
  const [size, setSize] = useState([1366, 768]),
    [low, setLow] = useState(false),
    [error, setError] = useState(""),
    [clip, setClip] = useState("idle"),
    [count, setCount] = useState(1),
    [rotation, setRotation] = useState(0),
    [assetId, setAssetId] = useState("processor"),
    [metrics, setMetrics] = useState<Record<string, any> | null>(null),
    [notes, setNotes] = useState(saved.notes),
    [records, setRecords] = useState<ReviewRecord[]>(saved.records),
    [saveError, setSaveError] = useState("");
  const held = useRef(new Set<string>());
  function updateMovement() {
    const keys = held.current;
    const pressed = (...names: string[]) =>
      names.some((name) => keys.has(name)) ? 1 : 0;
    viewControl.pilotInput = {
      x: pressed("KeyD", "ArrowRight") - pressed("KeyA", "ArrowLeft"),
      z: pressed("KeyS", "ArrowDown") - pressed("KeyW", "ArrowUp"),
    };
  }
  function stopMovement() {
    held.current.clear();
    viewControl.pilotInput = { x: 0, z: 0 };
  }
  useEffect(() => {
    const keys = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ]);
    const down = (e: KeyboardEvent) => {
      if (
        !keys.has(e.code) ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      if (!viewControl.graphicsReady) return;
      e.preventDefault();
      held.current.add(e.code);
      updateMovement();
    };
    const up = (e: KeyboardEvent) => {
      held.current.delete(e.code);
      updateMovement();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stopMovement);
    document.addEventListener("visibilitychange", stopMovement);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stopMovement);
      document.removeEventListener("visibilitychange", stopMovement);
      stopMovement();
    };
  }, []);
  useEffect(() => {
    if (error) stopMovement();
  }, [error]);
  useEffect(() => {
    try {
      localStorage.setItem(
        REVIEW_STORAGE_KEY,
        JSON.stringify({ version: 2, records, notes }),
      );
      setSaveError("");
    } catch {
      setSaveError(
        "이 브라우저에 기록을 저장하지 못했습니다. 내려받기로 보관해 주세요.",
      );
    }
  }, [records, notes]);
  useEffect(() => {
    const timer = setInterval(() => {
      const raw =
        document.querySelector<HTMLElement>(".world-canvas")?.dataset.metrics;
      setMetrics(raw ? JSON.parse(raw) : null);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  const settings = { size, low, clip, count, rotation, assetId };
  const ready = reviewReady(metrics, settings);
  function record(result: "VISUALLY_REVIEWED" | "NEEDS_REVISION") {
    const raw =
      document.querySelector<HTMLElement>(".world-canvas")?.dataset.metrics;
    const current = raw ? JSON.parse(raw) : null;
    if (!reviewReady(current, settings) || !manifestHash) return;
    setRecords((old) => [
      ...old,
      {
        capturedAt: new Date().toISOString(),
        result,
        notes,
        requestedCanvas: [...size],
        quality: low ? "low" : "standard",
        clip,
        count,
        rotation,
        assetId,
        measurements: structuredClone(current),
        manifestHash,
      },
    ]);
    setNotes("");
  }
  function downloadReport() {
    const raw =
      document.querySelector<HTMLElement>(".world-canvas")?.dataset.metrics;
    const measurements = raw
      ? JSON.parse(raw)
      : { webgl: false, loaded: false };
    const report = {
      capturedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      devicePixelRatio,
      requestedCanvas: size,
      quality: low ? "low" : "standard",
      measurements,
      error,
      manifestHash,
      records,
      recordSchemaVersion: 2,
      reviewStatus:
        measurements.webgl && measurements.loaded
          ? "REQUIRES_VISUAL_REVIEW"
          : "BLOCKED",
      note: "실행 환경과 측정값 기록입니다. 시각 품질·FPS·조작감의 통과 판정은 별도입니다.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "scrap-to-orbit-asset-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="pilot-page">
      <header>
        <h1>고철로 우주까지 · 모델 둘러보기</h1>
        <p>
          실제 3D 모델 26종과 작업자 이동을 확인하는 공간입니다. 고도 55°·방위
          45°의 고정 정사영 카메라를 사용합니다.
        </p>
        <nav>
          <label>
            살펴볼 모델{" "}
            <select
              aria-label="살펴볼 모델"
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                stopMovement();
                viewControl.pilotReset++;
              }}
            >
              {catalog.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name_ko}
                </option>
              ))}
            </select>
          </label>
          {[
            [1366, 768],
            [3840, 2160],
            [800, 360],
          ].map((s) => (
            <button key={s.join()} onClick={() => setSize(s)}>
              {s.join(" × ")}
            </button>
          ))}
          <button onClick={() => setLow(!low)}>
            {low ? "저사양" : "표준"} 품질
          </button>
          <button onClick={() => viewControl.zoom--}>확대</button>
          <button onClick={() => viewControl.zoom++}>축소</button>
          <label>
            작업자 동작{" "}
            <select
              aria-label="작업자 동작"
              value={clip}
              onChange={(e) => setClip(e.target.value)}
            >
              {[
                ["idle", "대기"],
                ["locomotion", "이동"],
                ["work_loop", "작업"],
                ["carry_locomotion", "운반"],
                ["celebrate", "축하"],
                ["independent", "서로 다른 동작"],
              ].map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setCount(count === 1 ? 6 : 1)}>
            작업자 {count}명
          </button>
          <button onClick={() => setRotation((rotation + 1) % 4)}>
            시설 방향 {rotation * 90}°
          </button>
          <button onClick={downloadReport}>검수 기록 내려받기</button>
          {!standalone && <a href="/">게임으로</a>}
        </nav>
        <p role="status">
          {error ||
            "WASD · 방향키로 작업자 1을 이동하세요. 화면 버튼으로도 움직일 수 있습니다."}
        </p>
        {error && (
          <details className="graphics-help" open>
            <summary>3D 화면이 나오지 않을 때</summary>
            <p>
              내 PC의 Chrome·Edge에서 그래픽 가속을 켜고 브라우저를 다시 시작한
              뒤 이 페이지를 열어 주세요. 그래도 안 되면 그래픽 드라이버를
              확인해 주세요.
            </p>
            <p>
              원격 검수 브라우저에서 WebGL이 제공되지 않는 경우에는 내 PC 설정을
              바꿔도 원격 화면에는 적용되지 않습니다. 이때는 아래 기록을
              내려받아 오류 상태를 확인할 수 있습니다.
            </p>
            <p>
              현재 상태: {metrics?.reason ?? "확인 중"}. WebGL 2가 시작돼야 3D
              이동이 가능합니다.
            </p>
            {metrics?.detail && (
              <pre className="graphics-detail">{metrics.detail}</pre>
            )}
          </details>
        )}
      </header>
      <aside className="pilot-review-tools">
        <strong>
          {ready ? "3D 모델 표시 중" : error || "3D 화면 준비 중"}
        </strong>
        <span>
          {size.join(" × ")} · {low ? "저사양" : "표준"} · 기록 {records.length}
          개
        </span>
        <span>메모와 기록은 이 브라우저에 자동 보관됩니다.</span>
        {saveError && <p role="alert">{saveError}</p>}
        {ready && (
          <span>
            삼각형 {Number(metrics?.triangles).toLocaleString()} · 그리기{" "}
            {metrics?.drawCalls}회
          </span>
        )}
        <p>
          모델의 크기·색·앞뒤 방향·발 접지를 살펴보고, 다섯 동작과 작업자 6명의
          독립 동작을 확인하세요. 각 화면 크기와 품질을 바꿔 기록할 수 있습니다.
        </p>
        <label>
          검수 메모
          <input
            aria-label="검수 메모"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="예: 작업자 발 접지, 시설 크기, 수정할 부분"
          />
        </label>
        <button disabled={!ready} onClick={() => record("VISUALLY_REVIEWED")}>
          현재 화면 확인 기록
        </button>
        <button disabled={!ready} onClick={() => record("NEEDS_REVISION")}>
          수정 필요 기록
        </button>
        {standalone && (
          <p>
            모델 확인·이동 연습 전용 화면입니다. 협동 게임의 방 생성·채집·제작은
            게임 서버에서 이용합니다.
          </p>
        )}
      </aside>
      <div className="pilot-controls" aria-label="작업자 이동 조작">
        <strong>작업자 1 이동</strong>
        {(
          [
            ["ArrowUp", "위", "↑"],
            ["ArrowLeft", "왼쪽", "←"],
            ["ArrowDown", "아래", "↓"],
            ["ArrowRight", "오른쪽", "→"],
          ] as const
        ).map(([key, name, icon]) => (
          <button
            key={key}
            aria-label={`${name}로 이동`}
            disabled={!metrics?.webgl || !metrics?.loaded}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              held.current.add(key);
              updateMovement();
            }}
            onPointerUp={() => {
              held.current.delete(key);
              updateMovement();
            }}
            onPointerCancel={stopMovement}
            onLostPointerCapture={() => {
              held.current.delete(key);
              updateMovement();
            }}
          >
            {icon}
          </button>
        ))}
        <button
          onClick={() => {
            stopMovement();
            viewControl.pilotReset++;
          }}
        >
          시작 위치로
        </button>
        <span>
          {metrics?.webgl && metrics?.loaded
            ? "WASD · 방향키 / 버튼을 누르고 있으면 이동"
            : "3D 화면을 시작하면 이동할 수 있습니다"}
        </span>
      </div>
      {error && (
        <figure className="model-poster">
          <img
            key={assetId}
            src={`/assets/visuals/1.1.0/previews/${assetId}.webp`}
            alt={`${catalog.assets.find((a) => a.id === assetId)?.name_ko} 생성 모델 미리보기`}
          />
          <figcaption>
            생성된 3D 모델의 미리보기 이미지 · 현재 브라우저에서는 3D 렌더링을
            시작하지 못했습니다.
          </figcaption>
        </figure>
      )}
      <section
        style={{ width: size[0], height: size[1], position: "relative" }}
      >
        <WorldView
          world={null}
          member=""
          selected={null}
          ghost={null}
          low={low}
          overview={false}
          pilot
          review={{ clip, count, rotation, assetId, interactive: true }}
          onSelect={() => {}}
          onGround={() => {}}
          onError={setError}
        />
      </section>
    </main>
  );
}
