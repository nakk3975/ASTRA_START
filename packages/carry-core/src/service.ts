import {
  createCarryWorld,
  joinCarry,
  leaveCarry,
  tickCarry,
  commandCarry,
  setInput,
  assertCarry,
  publicWorld,
  migrateCarry,
  CFG,
  type World,
  type Command,
} from "./index.ts";
export type Save = {
  id: string;
  code: string;
  revision: number;
  at: number;
  world: World;
  credentials: Record<string, string>;
};
export interface CarryStore {
  create(row: Save): Promise<void>;
  get(id: string): Promise<Save | null>;
  byCode(code: string): Promise<Save | null>;
  cas(row: Save, expected: number): Promise<boolean>;
}
const digest = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
export class CarryService {
  constructor(
    public store: CarryStore,
    public now = () => Date.now(),
  ) {}
  async update<T>(
    id: string,
    fn: (s: Save) => T | Promise<T>,
  ): Promise<{ result: T; world: World; revision: number }> {
    for (let retry = 0; retry < 12; retry++) {
      const s = await this.store.get(id);
      if (!s) throw Error("작업장을 찾지 못했습니다.");
      migrateCarry(s.world);
      assertCarry(s.world);
      const previous = s.revision;
      this.advance(s);
      const result = await fn(s);
      assertCarry(s.world);
      s.revision++;
      if (await this.store.cas(s, previous))
        return { result, world: publicWorld(s.world), revision: s.revision };
    }
    throw Error("동시 작업이 많습니다. 같은 명령으로 다시 시도해 주세요.");
  }
  advance(s: Save) {
    const now = this.now();
    for (const p of Object.values(s.world.players))
      if (p.connected && now - p.lastSeen > CFG.disconnectSeconds * 1000)
        leaveCarry(s.world, p.id);
    let dt = Math.min(0.25, Math.max(0, (now - s.at) / 1000));
    while (dt > 0.00001) {
      const part = Math.min(0.05, dt);
      tickCarry(s.world, part);
      dt -= part;
    }
    s.at = now;
  }
  async auth(s: Save, member: string, key: string) {
    if (!s.credentials[member] || (await digest(key)) !== s.credentials[member])
      throw Error("접속 인증이 만료됐습니다.");
  }
  async create(
    name: string,
    planned: number,
    profile: "campaign" | "lab" = "campaign",
  ) {
    this.name(name);
    if (!["campaign", "lab"].includes(profile))
      throw Error("지원하지 않는 규칙입니다.");
    const id = crypto.randomUUID(),
      member = crypto.randomUUID(),
      key = token(),
      code = token().slice(0, 8).toUpperCase();
    const world = createCarryWorld(id, code, planned, profile);
    joinCarry(world, member, name, this.now());
    const row = {
      id,
      code,
      revision: 0,
      at: this.now(),
      world,
      credentials: { [member]: await digest(key) },
    };
    assertCarry(world);
    await this.store.create(row);
    return {
      roomId: id,
      code,
      member,
      token: key,
      world: publicWorld(world),
      revision: 0,
    };
  }
  name(name: string) {
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 18)
      throw Error("이름은 1~18자로 입력해 주세요.");
  }
  async join(code: string, name: string) {
    this.name(name);
    const existing = await this.store.byCode(code.toUpperCase());
    if (!existing) throw Error("방 코드를 확인해 주세요.");
    const member = crypto.randomUUID(),
      key = token(),
      hash = await digest(key);
    const r = await this.update(existing.id, (s) => {
      if (Object.keys(s.world.players).length >= 64)
        throw Error(
          "이 저장본의 방문자 한도입니다. 기존 접속 정보로 이어 주세요.",
        );
      joinCarry(s.world, member, name, this.now());
      s.credentials[member] = hash;
    });
    return {
      roomId: existing.id,
      code: existing.code,
      member,
      token: key,
      world: r.world,
      revision: r.revision,
    };
  }
  async resume(id: string, member: string, key: string) {
    return this.update(id, async (s) => {
      await this.auth(s, member, key);
      return joinCarry(
        s.world,
        member,
        s.world.players[member].name,
        this.now(),
      ).epoch;
    });
  }
  async sync(
    id: string,
    member: string,
    key: string,
    input?: { x: number; z: number; epoch: number },
    command?: Command,
  ) {
    return this.update(id, async (s) => {
      await this.auth(s, member, key);
      const p = s.world.players[member];
      if (!p.connected)
        throw Error("연결이 끊어졌습니다. 이어하기를 눌러 주세요.");
      if (command && !input)
        throw Error("행동에는 현재 접속 세대가 필요합니다.");
      if (input) {
        if (
          !Number.isFinite(input.x) ||
          !Number.isFinite(input.z) ||
          Math.abs(input.x) > 1 ||
          Math.abs(input.z) > 1
        )
          throw Error("잘못된 이동 입력");
        if (p.epoch !== input.epoch)
          throw Error("다른 창에서 이어하기를 시작했습니다.");
        setInput(s.world, member, input.x, input.z);
      }
      p.lastSeen = this.now();
      return command ? commandCarry(s.world, member, command) : null;
    });
  }
  async leave(id: string, member: string, key: string, epoch?: number) {
    return this.update(id, async (s) => {
      await this.auth(s, member, key);
      if (epoch === undefined || s.world.players[member].epoch === epoch)
        leaveCarry(s.world, member);
    });
  }
  async pulse(id: string) {
    return this.update(id, () => null);
  }
}
export class MemoryCarryStore implements CarryStore {
  rows = new Map<string, Save>();
  async create(r: Save) {
    if (this.rows.has(r.id)) throw Error("DUPLICATE");
    this.rows.set(r.id, structuredClone(r));
  }
  async get(id: string) {
    return structuredClone(this.rows.get(id) ?? null);
  }
  async byCode(code: string) {
    return structuredClone(
      [...this.rows.values()].find((s) => s.code === code) ?? null,
    );
  }
  async cas(r: Save, v: number) {
    if (this.rows.get(r.id)?.revision !== v) return false;
    this.rows.set(r.id, structuredClone(r));
    return true;
  }
}
