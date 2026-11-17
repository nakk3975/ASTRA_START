import React, { useEffect, useState } from "react";
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
    [metrics, setMetrics] = useState<Record<string, any> | null>(null),
    [notes, setNotes] = useState(saved.notes),
    [records, setRecords] = useState<ReviewRecord[]>(saved.records),
    [saveError, setSaveError] = useState("");
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
  const settings = { size, low, clip, count, rotation };
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
        <h1>첫 3개 모델 · 게임 렌더러 검수</h1>
        <p>
          작업자 / 가공기 / 로켓 하부 선체 — 고도 55°, 방위 45°, 정사영. 검수
          결과는 자동으로 통과 처리되지 않습니다.
        </p>
        <nav>
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
            "같은 WorldView, 동일 GLB·카메라·품질 설정을 사용합니다. 실제 기기 FPS와 조작감은 별도 확인하세요."}
        </p>
        {error && (
          <details className="graphics-help">
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
            첫 세 모델을 살펴보는 전용 화면입니다. 게임의 저장 데이터나 Meshy
            생성 작업은 변경하지 않습니다.
          </p>
        )}
      </aside>
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
          review={{ clip, count, rotation }}
          onSelect={() => {}}
          onGround={() => {}}
          onError={setError}
        />
      </section>
    </main>
  );
}
