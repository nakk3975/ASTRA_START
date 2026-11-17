export type ReviewSettings = {
  size: number[];
  low: boolean;
  clip: string;
  count: number;
  rotation: number;
  assetId?: string;
};
export type ReviewMetrics = {
  webgl?: boolean;
  loaded?: boolean;
  css?: number[];
  quality?: string;
  review?: {
    clip?: string;
    count?: number;
    rotation?: number;
    assetId?: string;
  };
  triangles?: number;
  drawCalls?: number;
};
export type ReviewRecord = {
  capturedAt: string;
  result: "VISUALLY_REVIEWED" | "NEEDS_REVISION";
  notes: string;
  requestedCanvas: number[];
  quality: string;
  clip: string;
  count: number;
  rotation: number;
  assetId?: string;
  measurements: ReviewMetrics;
  manifestHash: string;
};
export const REVIEW_STORAGE_KEY = "orbit:pilot-review:v2";
export function reviewReady(
  metrics: ReviewMetrics | null,
  settings: ReviewSettings,
) {
  return !!(
    metrics?.webgl &&
    metrics.loaded &&
    metrics.css?.[0] === settings.size[0] &&
    metrics.css?.[1] === settings.size[1] &&
    metrics.quality === (settings.low ? "low" : "standard") &&
    metrics.review?.clip === settings.clip &&
    metrics.review.count === settings.count &&
    metrics.review.rotation === settings.rotation &&
    (metrics.review.assetId ?? "processor") ===
      (settings.assetId ?? "processor")
  );
}
export function restoreReview(raw: string | null): {
  records: ReviewRecord[];
  notes: string;
} {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 2 || !Array.isArray(data.records))
      return { records: [], notes: "" };
    const records = data.records.filter(
      (r: ReviewRecord) =>
        r &&
        (r.result === "VISUALLY_REVIEWED" || r.result === "NEEDS_REVISION") &&
        typeof r.capturedAt === "string" &&
        typeof r.notes === "string" &&
        /^[a-f0-9]{64}$/.test(r.manifestHash) &&
        Array.isArray(r.requestedCanvas) &&
        r.requestedCanvas.length === 2 &&
        r.requestedCanvas.every(Number.isFinite) &&
        ["standard", "low"].includes(r.quality) &&
        typeof r.clip === "string" &&
        [1, 6].includes(r.count) &&
        [0, 1, 2, 3].includes(r.rotation) &&
        r.measurements &&
        reviewReady(r.measurements, {
          size: r.requestedCanvas,
          low: r.quality === "low",
          clip: r.clip,
          count: r.count,
          rotation: r.rotation,
          assetId: r.assetId,
        }),
    );
    return {
      records: records.slice(-500),
      notes: typeof data.notes === "string" ? data.notes : "",
    };
  } catch {
    return { records: [], notes: "" };
  }
}
