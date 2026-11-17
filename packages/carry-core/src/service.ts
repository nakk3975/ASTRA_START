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
  validAvatar,
  type World,
  type Command,
  type MovePacket,
  movePosition,
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
    let dt = Math.min(1, Math.max(0, (now - s.at) / 1000));
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
    avatar = "worker",
  ) {
    this.name(name);
    if (!validAvatar(avatar)) throw Error("캐릭터를 선택하세요.");
    if (!["campaign", "lab"].includes(profile))
      throw Error("지원하지 않는 규칙입니다.");
    const id = crypto.randomUUID(),
      member = crypto.randomUUID(),
      key = token(),
      code = token().slice(0, 8).toUpperCase();
    const world = createCarryWorld(id, code, planned, profile);
    joinCarry(world, member, name, this.now()).avatar = avatar;
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
  async join(code: string, name: string, avatar = "worker") {
    this.name(name);
    if (!validAvatar(avatar)) throw Error("캐릭터를 선택하세요.");
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
      joinCarry(s.world, member, name, this.now()).avatar = avatar;
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
    input?: MovePacket,
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
        if (input.actionAfter !== undefined &&
            (!Number.isSafeInteger(input.actionAfter) || input.actionAfter < 0 || !input.frames))
          throw Error("잘못된 행동 이동 순번");
        if (
          !Number.isFinite(input.x) ||
          !Number.isFinite(input.z) ||
          Math.abs(input.x) > 1 ||
          Math.abs(input.z) > 1
        )
          throw Error("잘못된 이동 입력");
        if (p.epoch !== input.epoch)
          throw Error("다른 창에서 이어하기를 시작했습니다.");
        if (input.frames !== undefined) {
          if (
            !Array.isArray(input.frames) ||
            input.frames.length > 40 ||
            !Number.isSafeInteger(input.control) ||
            input.control! < 0
          )
            throw Error("잘못된 이동 묶음");
          for (const frame of input.frames)
            if (
              !Number.isSafeInteger(frame.seq) ||
              frame.seq < 1 ||
              !Number.isFinite(frame.dt) ||
              frame.dt <= 0 ||
              frame.dt > 0.05 ||
              !Number.isFinite(frame.x) ||
              !Number.isFinite(frame.z) ||
              Math.abs(frame.x) > 1 ||
              Math.abs(frame.z) > 1
            )
              throw Error("잘못된 이동 구간");
          const at = this.now();
          p.motion ??= { ack: 0, control: -1, budget: 0.25, at };
          const m = p.motion;
          m.budget = Math.min(1, m.budget + Math.max(0, (at - m.at) / 1000));
          m.at = at;
          // Replay only a contiguous unacknowledged prefix. Budget is real server time.
          for (const frame of input.frames) {
            if (frame.seq <= m.ack) continue;
            if (frame.seq !== m.ack + 1 || frame.dt > m.budget + 1e-8) break;
            if (input.actionAfter !== undefined && frame.seq > input.actionAfter) break;
            if (s.world.phase !== "LAUNCHED")
              p.pos = movePosition(s.world, p, p.pos, frame, frame.dt);
            // Released input may arrive first. Preserve the facing of the last
            // applied movement instead of an older direction from a prior request.
            const length = Math.hypot(frame.x, frame.z);
            if (length > 0)
              p.facing = { x: frame.x / length, z: frame.z / length };
            m.budget = Math.max(0, m.budget - frame.dt);
            m.ack = frame.seq;
          }
          // An older concurrent request must never restore movement after key release.
          if (input.control! >= m.control) {
            m.control = input.control!;
            setInput(s.world, member, input.x, input.z);
          }
        } else if (!p.motion) setInput(s.world, member, input.x, input.z);
      }
      p.lastSeen = this.now();
      if (command && input?.actionAfter !== undefined &&
          (p.motion?.ack ?? 0) < input.actionAfter &&
          !s.world.receipts[member]?.some((r) => r.id === command.id))
        return null;
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
