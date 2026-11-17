import {
  CarryService,
  type CarryStore,
  type Save,
} from "../../packages/carry-core/src/service.ts";
import { APP_VERSION } from "../../packages/carry-core/src/version.ts";
type Statement = {
  bind(...args: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
};
type Env = {
  DB: { prepare(sql: string): Statement };
  ASSETS: { fetch(request: Request): Promise<Response> };
};
export class D1CarryStore implements CarryStore {
  constructor(private db: Env["DB"]) {}
  async create(s: Save) {
    await this.db
      .prepare(
        "INSERT INTO carry_worlds_v2(id,code,revision,state) VALUES(?,?,?,?)",
      )
      .bind(s.id, s.code, s.revision, JSON.stringify(s))
      .run();
  }
  async get(id: string): Promise<Save | null> {
    const row = await this.db
      .prepare("SELECT state FROM carry_worlds_v2 WHERE id=?")
      .bind(id)
      .first<{ state: string }>();
    return row ? JSON.parse(row.state) : null;
  }
  async byCode(code: string): Promise<Save | null> {
    const row = await this.db
      .prepare("SELECT state FROM carry_worlds_v2 WHERE code=?")
      .bind(code)
      .first<{ state: string }>();
    return row ? JSON.parse(row.state) : null;
  }
  async cas(s: Save, previous: number) {
    const r = await this.db
      .prepare(
        "UPDATE carry_worlds_v2 SET revision=?,state=? WHERE id=? AND revision=?",
      )
      .bind(s.revision, JSON.stringify(s), s.id, previous)
      .run();
    return r.meta.changes === 1;
  }
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const buckets = new Map<string, { at: number; n: number }>();
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname.startsWith("/legacy"))
        return new Response(
          "이전 규칙과 기존 저장은 원본 Node/PostgreSQL 서버에서 npm run dev로 실행할 수 있습니다. 새 서버에는 이전 저장을 가져오거나 덮어쓰지 않습니다.",
          { headers: { "Content-Type": "text/plain;charset=utf-8" } },
        );
      return env.ASSETS.fetch(request);
    }
    if (url.pathname === "/api/health")
      return json({
        ok: true,
        rules: "quarry-3.3.0",
        build: APP_VERSION,
        transport: "http",
        storage: "D1",
      });
    if (request.method !== "POST" || !url.pathname.startsWith("/api/carry/"))
      return json({ error: "NOT_FOUND" }, 404);
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== url.origin
    )
      return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "JSON_REQUIRED" }, 415);
    try {
      const action = url.pathname.slice("/api/carry/".length),
        now = Date.now(),
        entry = ["create", "join"].includes(action),
        ip = request.headers.get("CF-Connecting-IP") ?? "unknown",
        key = ip + ":" + (entry ? "entry" : "play");
      for (const [key, b] of buckets)
        if (now - b.at > 60000) buckets.delete(key);
      const b = buckets.get(key) ?? { at: now, n: 0 };
      buckets.set(key, b);
      if (++b.n > (entry ? 30 : 2400))
        return json(
          { error: "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요." },
          429,
        );
      const text = await request.text();
      if (text.length > 5000) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      const data = JSON.parse(text),
        s = new CarryService(new D1CarryStore(env.DB));
      let result;
      if (action === "create")
        result = await s.create(data.name, data.planned, data.profile, data.avatar);
      else if (action === "join")
        result = await s.join(String(data.code), data.name, data.avatar);
      else if (action === "resume")
        result = await s.resume(data.id, data.member, data.token);
      else if (action === "sync")
        result = await s.sync(
          data.id,
          data.member,
          data.token,
          data.input,
          data.command,
        );
      else if (action === "leave")
        result = await s.leave(data.id, data.member, data.token, data.epoch);
      else return json({ error: "알 수 없는 요청입니다." }, 404);
      return json({ ...result, transport: "http" });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  },
};
