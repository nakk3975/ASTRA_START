import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AssetCache,
  sha256,
  type Manifest,
} from "../apps/web/src/visuals/asset-cache.ts";

const bytes = new TextEncoder().encode("verified model").buffer;
const hash = await sha256(bytes);
const manifest: Manifest = {
  version: "1.1.0",
  status: "PILOT",
  assets: [
    {
      id: "worker",
      boundsMax: { x: 1, y: 1.8, z: 1 },
      clips: [],
      lods: [0, 1].map((level) => ({
        level,
        url: `/assets/visuals/1.1.0/worker-lod${level}.glb`,
        sha256: hash,
        bytes: bytes.byteLength,
        triangles: 1,
        materials: 1,
      })),
    },
  ],
};
test("the shipped manifest and all 58 LOD files pass the production cache path", async () => {
  const root = new URL("../apps/web/public/", import.meta.url);
  const cache = new AssetCache(
    async (data) => data.byteLength,
    () => {},
    async (url) => {
      const data = await readFile(new URL(String(url).slice(1), root));
      return new Response(data);
    },
  );
  const loaded = await cache.load();
  const catalog = JSON.parse(
    await readFile(
      new URL("../design/asset_catalog_v1_1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    loaded.assets.map((a) => a.id).sort(),
    [
      ...catalog.assets.map((a: { id: string }) => a.id),
      "worker-engineer",
      "worker-mechanic",
      "worker-pilot",
    ].sort(),
  );
  assert.equal(cache.values.size, 58);
  assert.ok(cache.values.get("rocket_lower_hull:0"));
});
function source(m = manifest): typeof fetch {
  return async (url) =>
    String(url).endsWith("manifest.json")
      ? new Response(JSON.stringify(m))
      : new Response(bytes);
}
test("a partial GLB 404 disposes staged models and a retry publishes the complete set", async () => {
  let failing = true,
    decoded = 0;
  const disposed: number[] = [];
  const cache = new AssetCache(
    async () => ++decoded,
    (n) => disposed.push(n),
    async (url, init) => {
      if (failing && String(url).endsWith("lod1.glb"))
        return new Response("missing", { status: 404 });
      return source()(url, init);
    },
    500,
  );
  await assert.rejects(cache.load(), /HTTP 404/);
  assert.equal(cache.values.size, 0);
  assert.equal(cache.manifest, null);
  assert.deepEqual(disposed, [1]);
  failing = false;
  const [a, b] = await Promise.all([cache.load(), cache.load()]);
  assert.equal(a, b);
  assert.equal(decoded, 3, "concurrent consumers must share one load");
  assert.equal(cache.values.size, 2);
  assert.equal(cache.error, "");
  assert.equal(
    cache.manifestHash,
    await sha256(new TextEncoder().encode(JSON.stringify(manifest)).buffer),
  );
});
test("a stalled request is aborted and the next request can recover", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let failing = true,
    aborted = false;
  const cache = new AssetCache(
    async () => 1,
    () => {},
    (url, init) => {
      if (!failing) return source()(url, init);
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(init.signal!.reason);
          },
          { once: true },
        ),
      );
    },
    20,
  );
  const pending = assert.rejects(cache.load(), /시간이 초과/);
  t.mock.timers.tick(20);
  await pending;
  assert.equal(aborted, true);
  failing = false;
  await cache.load();
  assert.equal(cache.values.size, 2);
});
test("a late decoder cannot replace the result of a successful retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let decoding!: () => void;
  const started = new Promise<void>((resolve) => {
    decoding = resolve;
  });
  let release!: (n: number) => void,
    first = true;
  const disposed: number[] = [];
  const cache = new AssetCache(
    async () => {
      if (first) {
        first = false;
        return new Promise<number>((r) => {
          release = r;
          decoding();
        });
      }
      return 2;
    },
    (n) => disposed.push(n),
    source(),
    20,
  );
  const pending = assert.rejects(cache.load(), /시간이 초과/);
  await started;
  t.mock.timers.tick(20);
  await pending;
  await cache.load();
  release(1);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(disposed, [1]);
  assert.deepEqual([...cache.values.values()], [2, 2]);
});
test("corrupt bytes and expired or external manifest paths are rejected before decode", async () => {
  let decoded = 0;
  const corrupt = structuredClone(manifest);
  corrupt.assets[0].lods[0].sha256 = "0".repeat(64);
  const cache = new AssetCache(
    async () => ++decoded,
    () => {},
    source(corrupt),
  );
  await assert.rejects(cache.load(), /무결성/);
  const external = structuredClone(manifest);
  external.assets[0].lods[0].url = "https://example.com/expired.glb";
  await assert.rejects(
    new AssetCache(
      async () => ++decoded,
      () => {},
      source(external),
    ).load(),
    /경로/,
  );
  assert.equal(decoded, 0);
});
