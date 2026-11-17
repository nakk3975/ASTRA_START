import { R } from "../../../../packages/content/src/index.ts";

export type AssetRecord = {
  id: string;
  boundsMax: { x: number; y: number; z: number };
  clips: string[];
  lods: {
    level: number;
    url: string;
    sha256: string;
    bytes: number;
    triangles: number;
    materials: number;
  }[];
};
export type Manifest = {
  version: string;
  status: string;
  assets: AssetRecord[];
};
const manifestUrl = "/assets/visuals/1.1.0/manifest.json";
export async function sha256(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function validateManifest(value: unknown): asserts value is Manifest {
  const m = value as Manifest;
  if (
    !m ||
    m.version !== "1.1.0" ||
    !Array.isArray(m.assets) ||
    !m.assets.length
  )
    throw Error(
      "3D 모델 목록의 버전 또는 형식이 올바르지 않습니다. 새로고침해 주세요.",
    );
  const ids = new Set<string>();
  for (const a of m.assets) {
    if (
      !a ||
      !/^[a-z_]+$/.test(a.id) ||
      ids.has(a.id) ||
      !a.boundsMax ||
      ![a.boundsMax.x, a.boundsMax.y, a.boundsMax.z].every(
        (n) => Number.isFinite(n) && n > 0,
      ) ||
      !Array.isArray(a.clips) ||
      !Array.isArray(a.lods) ||
      a.lods.length !== 2
    )
      throw Error("3D 모델 목록의 자산 정보가 올바르지 않습니다.");
    ids.add(a.id);
    const levels = new Set<number>();
    for (const l of a.lods) {
      if (
        ![0, 1].includes(l.level) ||
        levels.has(l.level) ||
        !Number.isSafeInteger(l.bytes) ||
        l.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(l.sha256) ||
        !/^\/assets\/visuals\/1\.1\.0\/[a-z0-9_.-]+\.glb$/.test(l.url)
      )
        throw Error(`3D 모델 경로 또는 검증 정보가 올바르지 않습니다: ${a.id}`);
      levels.add(l.level);
    }
  }
}

/** Publish only a complete verified set. Failed/cancelled attempts never poison a retry. */
export class AssetCache<T> {
  values = new Map<string, T>();
  manifest: Manifest | null = null;
  manifestHash = "";
  error = "";
  private pending: Promise<Manifest> | null = null;
  constructor(
    private decode: (data: ArrayBuffer) => Promise<T>,
    private dispose: (value: T) => void,
    private fetcher: typeof fetch = (...args) => fetch(...args),
    private timeoutMs = R.timers_ms.connect_ui_timeout,
  ) {}

  load(): Promise<Manifest> {
    if (this.manifest) return Promise.resolve(this.manifest);
    if (this.pending) return this.pending;
    const controller = new AbortController();
    const staged = new Map<string, T>();
    this.error = "";
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = Error(
          "모델 로드 시간이 초과됐습니다. 다시 시도해 주세요.",
        );
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });
    const load = async () => {
      const response = await this.fetcher(manifestUrl, {
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!response.ok) throw Error("3D 모델 목록을 불러올 수 없습니다.");
      const bytes = await response.arrayBuffer();
      controller.signal.throwIfAborted();
      const m: unknown = JSON.parse(new TextDecoder().decode(bytes));
      validateManifest(m);
      const manifestHash = await sha256(bytes);
      for (const a of m.assets)
        for (const l of a.lods) {
          controller.signal.throwIfAborted();
          const r = await this.fetcher(l.url, { signal: controller.signal });
          if (!r.ok) throw Error(`모델 로드 실패: ${a.id} (HTTP ${r.status})`);
          const data = await r.arrayBuffer();
          if (data.byteLength !== l.bytes || (await sha256(data)) !== l.sha256)
            throw Error(`모델 무결성 오류: ${a.id}`);
          controller.signal.throwIfAborted();
          const decoded = await this.decode(data);
          // Decoders cannot always be aborted. Dispose late results before they reach the live cache.
          if (controller.signal.aborted) {
            this.dispose(decoded);
            controller.signal.throwIfAborted();
          }
          staged.set(`${a.id}:${l.level}`, decoded);
        }
      controller.signal.throwIfAborted();
      this.values = staged;
      this.manifestHash = manifestHash;
      this.manifest = m;
      return m;
    };
    this.pending = Promise.race([load(), expired])
      .catch((e: unknown) => {
        controller.abort(e);
        staged.forEach(this.dispose);
        staged.clear();
        this.error = e instanceof Error ? e.message : String(e);
        throw e;
      })
      .finally(() => {
        clearTimeout(timer);
        this.pending = null;
      });
    return this.pending;
  }
}
