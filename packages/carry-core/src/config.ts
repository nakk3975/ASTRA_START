export const RULES = "quarry-3.4.0";
export const CFG = {
  speed: 3.5,
  radius: 0.36,
  reach: 1.75,
  gravity: 16,
  throwSpeed: 5,
  throwUp: 3.6,
  rawLimit: 24,
  refillSeconds: 5,
  outputSlots: 3,
  inputSlots: 6,
  deviceLimit: 120,
  inputExpiry: 0.75,
  disconnectSeconds: 12,
};
export const ITEM = {
  kit_workbench: {
    name: "설비 제작대 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  kit_assembler: {
    name: "기초 조립기 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  kit_refinery: {
    name: "기초 연료 혼합기 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  kit_fabricator: {
    name: "기초 부품 제작기 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  kit_processor: {
    name: "기초 제련기 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  kit_bench: {
    name: "낡은 작업대 상자",
    heavy: true,
    shape: "kit",
    color: "#cba478",
  },
  metal_scrap: { name: "철광석", heavy: true, shape: "ore", color: "#9b7155" },
  cable_scrap: {
    name: "구리광석",
    heavy: false,
    shape: "ore",
    color: "#ba8053",
  },
  plastic_scrap: {
    name: "규석",
    heavy: false,
    shape: "crystal",
    color: "#f3e9d2",
  },
  energy_shard: {
    name: "석탄",
    heavy: false,
    shape: "coal",
    color: "#454342",
  },
  ingot: { name: "철 주괴", heavy: true, shape: "ingot", color: "#9caebd" },
  wire: { name: "구리선", heavy: false, shape: "coil", color: "#f59e0b" },
  polymer: { name: "내열재", heavy: false, shape: "plastic", color: "#e9ead3" },
  plate: { name: "철판", heavy: true, shape: "plate", color: "#a9c1c8" },
  gear: { name: "기어", heavy: false, shape: "gear", color: "#d5aa62" },
  circuit: { name: "회로", heavy: false, shape: "circuit", color: "#059b95" },
  hull_panel: {
    name: "선체 패널",
    heavy: true,
    shape: "hull",
    color: "#f0e6c9",
  },
  fuel_cell: {
    name: "연료 카트리지",
    heavy: true,
    shape: "tank",
    color: "#d1e0dd",
  },
  engine_part: {
    name: "엔진 부품",
    heavy: true,
    shape: "engine",
    color: "#f59e0b",
  },
  control_part: {
    name: "항법 부품",
    heavy: false,
    shape: "control",
    color: "#06b6d4",
  },
  kit_straight: {
    name: "직선 컨베이어 상자",
    heavy: true,
    shape: "kit",
    color: "#e3b165",
  },
  kit_corner: {
    name: "코너 컨베이어 상자",
    heavy: true,
    shape: "kit",
    color: "#e3b165",
  },
  kit_crane: {
    name: "크레인 상자",
    heavy: true,
    shape: "kit",
    color: "#f59e0b",
  },
  kit_tray: {
    name: "대기 트레이 상자",
    heavy: true,
    shape: "kit",
    color: "#98c1c3",
  },
  kit_miner: {
    name: "자동 채굴기 상자",
    heavy: true,
    shape: "kit",
    color: "#d7aa51",
  },
  kit_installer: {
    name: "자동 설치기 상자",
    heavy: true,
    shape: "kit",
    color: "#06b6d4",
  },
} as const;
export type Kind = keyof typeof ITEM;
export type DeviceKind =
  | "straight"
  | "corner"
  | "crane"
  | "tray"
  | "miner"
  | "installer";
export type Recipe = {
  name: string;
  machine: string;
  input: Partial<Record<Kind, number>>;
  output: Kind;
  seconds: number;
};
export const RECIPES: Record<string, Recipe> = {
  smelt_ingot: {
    name: "철 주괴",
    machine: "processor",
    input: { metal_scrap: 1 },
    output: "ingot",
    seconds: 5,
  },
  draw_wire: {
    name: "구리선",
    machine: "processor",
    input: { cable_scrap: 1 },
    output: "wire",
    seconds: 4,
  },
  recycle_polymer: {
    name: "내열재",
    machine: "processor",
    input: { plastic_scrap: 1 },
    output: "polymer",
    seconds: 4,
  },
  press_plate: {
    name: "철판",
    machine: "fabricator",
    input: { ingot: 1 },
    output: "plate",
    seconds: 5,
  },
  cut_gear: {
    name: "기어",
    machine: "fabricator",
    input: { ingot: 1 },
    output: "gear",
    seconds: 4,
  },
  assemble_circuit: {
    name: "회로",
    machine: "fabricator",
    input: { wire: 1, polymer: 1 },
    output: "circuit",
    seconds: 6,
  },
  assemble_hull: {
    name: "선체 패널",
    machine: "fabricator",
    input: { plate: 1, polymer: 1 },
    output: "hull_panel",
    seconds: 7,
  },
  blend_fuel: {
    name: "연료 카트리지",
    machine: "refinery",
    input: { energy_shard: 1, polymer: 1 },
    output: "fuel_cell",
    seconds: 7,
  },
  assemble_engine: {
    name: "엔진 부품",
    machine: "assembler",
    input: { plate: 1, gear: 1, circuit: 1 },
    output: "engine_part",
    seconds: 9,
  },
  assemble_control: {
    name: "항법 부품",
    machine: "assembler",
    input: { circuit: 1, wire: 1, plate: 1 },
    output: "control_part",
    seconds: 9,
  },
  kit_straight: {
    name: "직선 컨베이어 상자",
    machine: "workbench",
    input: { plate: 1 },
    output: "kit_straight",
    seconds: 5,
  },
  kit_corner: {
    name: "코너 컨베이어 상자",
    machine: "workbench",
    input: { plate: 1 },
    output: "kit_corner",
    seconds: 5,
  },
  kit_crane: {
    name: "크레인 상자",
    machine: "workbench",
    input: { plate: 1, gear: 1, wire: 1 },
    output: "kit_crane",
    seconds: 8,
  },
  kit_tray: {
    name: "대기 트레이 상자",
    machine: "workbench",
    input: { ingot: 1 },
    output: "kit_tray",
    seconds: 4,
  },
  kit_miner: {
    name: "자동 채굴기 상자",
    machine: "workbench",
    input: { plate: 1, gear: 1 },
    output: "kit_miner",
    seconds: 8,
  },
  kit_installer: {
    name: "자동 설치기 상자",
    machine: "workbench",
    input: { plate: 1, control_part: 1 },
    output: "kit_installer",
    seconds: 10,
  },
};
export type Upgrade = {
  name: string;
  cost: number;
  xp: number;
  requires: string | null;
  description: string;
  branch: string;
};
const branch = (
  prefix: string,
  title: string,
  costs: number[],
  xp: number[],
  description: (level: number) => string,
  start = 1,
  required: string | null = null,
): Record<string, Upgrade> =>
  Object.fromEntries(
    costs.map((cost, i) => {
      const level = i + start;
      return [
        `${prefix}${level}`,
        {
          name: `${title} ${level}`,
          cost: Math.max(1, Math.ceil(cost / 10)),
          xp: xp[i],
          requires: i ? `${prefix}${level - 1}` : required,
          description: description(level),
          branch: prefix,
        },
      ];
    }),
  );
export const UPGRADES: Record<string, Upgrade> = {
  ...branch(
    "carry",
    "운반량",
    [18, 38, 70, 115, 180, 270, 390],
    [8, 25, 55, 95, 155, 240, 350],
    (n) => `한 번에 ${n}개 · 한 단계씩 증가`,
    2,
  ),
  ...branch(
    "speed",
    "이동속도",
    [25, 55, 105, 180, 280],
    [15, 45, 90, 160, 260],
    (n) => `기본 이동속도 +${n * 6}% · 최대 +30%`,
  ),
  ...branch(
    "handling",
    "운반 자세",
    [40, 90, 170],
    [35, 90, 180],
    (n) => `무거운 짐 속도 손실 ${20 - n * 4}% · 최대 8%`,
  ),
  ...branch(
    "rail",
    "레일 모터",
    [50, 100, 180, 300],
    [45, 100, 190, 320],
    (n) => `레일 한 칸 이동 ${[1.8, 1.5, 1.25, 1.05, 0.9][n]}초`,
    1,
    "belts",
  ),
  ...branch(
    "tool",
    "채굴 도구",
    [28, 65, 130, 230],
    [20, 55, 115, 210],
    (n) => `직접 채굴 ${(0.8 / (1 + n * 0.18)).toFixed(2)}초 · 산출 수량은 1개`,
  ),
  ...branch(
    "processing",
    "가공 조율",
    [60, 130, 240],
    [60, 130, 250],
    (n) => `모든 설비 가공 속도 +${n * 8}%`,
  ),
  belts: {
    name: "운반 레일 해금",
    cost: 3,
    xp: 25,
    requires: null,
    description: "직선·코너 레일 구매와 제작",
    branch: "automation",
  },
  mining: {
    name: "자동 채굴 해금",
    cost: 5,
    xp: 65,
    requires: "belts",
    description: "광맥 가까이에 자동 채굴기 설치",
    branch: "automation",
  },
  crane: {
    name: "크레인 해금",
    cost: 7,
    xp: 100,
    requires: "belts",
    description: "출력 부품을 집어 다음 공정으로 전달",
    branch: "automation",
  },
  installer: {
    name: "자동 설치 해금",
    cost: 12,
    xp: 200,
    requires: "crane",
    description: "발사대의 맞는 소켓에 자동 설치",
    branch: "automation",
  },
};
export type UpgradeKey = string;
export const CHARACTERS = [
  {
    id: "worker",
    name: "현장 반장",
    description: "노란 안전모 · 주황 작업복",
    preview: "worker.webp",
  },
  {
    id: "worker-engineer",
    name: "엔지니어",
    description: "흰 안전모 · 청록 작업복",
    preview: "worker-engineer.webp",
  },
  {
    id: "worker-mechanic",
    name: "정비 전문가",
    description: "주황 안전모 · 파란 작업복",
    preview: "worker-mechanic.webp",
  },
  {
    id: "worker-pilot",
    name: "우주 비행사",
    description: "보라색 비행복",
    preview: "worker-pilot.webp",
  },
] as const;
export const MACHINE_CATALOG = {
  bench: {
    name: "낡은 작업대",
    price: 2,
    xp: 0,
    recipe: "smelt_ingot",
    description: "느린 수동 공방. 철 주괴·구리선·내열재·철판·기어부터 시작",
  },
  processor: {
    name: "기초 제련기",
    price: 6,
    xp: 35,
    recipe: "smelt_ingot",
    description: "광맥 원재료를 철 주괴·구리선·내열재로 가공",
  },
  fabricator: {
    name: "기초 부품 제작기",
    price: 8,
    xp: 70,
    recipe: "press_plate",
    description: "철판·기어부터 회로·선체까지",
  },
  refinery: {
    name: "기초 연료 혼합기",
    price: 10,
    xp: 110,
    recipe: "blend_fuel",
    description: "석탄과 내열재를 연료 카트리지로",
  },
  assembler: {
    name: "기초 조립기",
    price: 12,
    xp: 160,
    recipe: "assemble_engine",
    description: "엔진·항법 부품의 전용 조립",
  },
  workbench: {
    name: "설비 제작대",
    price: 5,
    xp: 45,
    recipe: "kit_tray",
    description: "운반·채굴·설치 설비 상자 제작",
  },
} as const;
export type MachineKind = keyof typeof MACHINE_CATALOG;
export const MACHINE_GRADES = ["낡은", "개량", "산업", "정밀"] as const;
export const MACHINE_TIER_SPEED = [0.55, 0.8, 1.1, 1.4];
export const MACHINE_UPGRADE_COST = [3, 8, 16];
export const MACHINE_UPGRADE_XP = [30, 75, 180];
export const VEIN_UPGRADE_COST = [3, 6, 12, 20];
export const VEIN_UPGRADE_XP = [55, 130, 260, 450];
export const DEVICE_PRICE: Record<DeviceKind, number> = {
  straight: 1,
  corner: 1,
  tray: 1,
  miner: 6,
  crane: 5,
  installer: 10,
};
/** Coins are awarded only when a rocket socket receives a part. */
export const INSTALL_VALUE: Partial<Record<Kind, number>> = {
  ingot: 1,
  plate: 1,
  gear: 1,
  wire: 2,
  polymer: 3,
  circuit: 4,
  hull_panel: 4,
  fuel_cell: 5,
  engine_part: 6,
  control_part: 7,
};
export const DEVICE_UNLOCK: Partial<Record<DeviceKind, UpgradeKey>> = {
  straight: "belts",
  corner: "belts",
  miner: "mining",
  crane: "crane",
  installer: "installer",
};
export const REWARDS: Partial<Record<Kind, { coins: number; xp: number }>> = {
  ingot: { coins: 2, xp: 2 },
  wire: { coins: 1, xp: 2 },
  polymer: { coins: 1, xp: 2 },
  plate: { coins: 4, xp: 4 },
  gear: { coins: 3, xp: 4 },
  circuit: { coins: 7, xp: 7 },
  hull_panel: { coins: 8, xp: 8 },
  fuel_cell: { coins: 9, xp: 9 },
  engine_part: { coins: 20, xp: 16 },
  control_part: { coins: 18, xp: 15 },
};
export const STAGES: {
  name: string;
  required: Partial<Record<Kind, number>>;
}[] = [
  { name: "M1 · 기초 프레임", required: { plate: 4 } },
  { name: "M2 · 하부 선체", required: { hull_panel: 2 } },
  { name: "M3 · 추진 장치", required: { engine_part: 2 } },
  { name: "M4 · 연료 탱크", required: { fuel_cell: 2 } },
  { name: "M5 · 항법 장치", required: { control_part: 2 } },
  { name: "M6 · 상부 캡과 안정판", required: { hull_panel: 2, plate: 2 } },
];
export const PROFILES = {
  campaign: {
    name: "본편",
    stages: STAGES,
    firstInstallTargetSeconds: [60, 120],
    firstAutomationTargetMinutes: [5, 10],
  },
  lab: {
    name: "개발용 작은 루프",
    stages: [{ name: "시험 · 철판 4개 설치", required: { plate: 4 } }],
    firstInstallTargetSeconds: null,
    firstAutomationTargetMinutes: null,
  },
};
export const COLORS = [
  "#f59e0b",
  "#06b6d4",
  "#a78bfa",
  "#f472b6",
  "#84cc16",
  "#fb7185",
];
/** Frozen when a room is created; joining/leaving never rewrites sockets. */
export const plannedQuantity = (
  base: number,
  planned: number,
  profile: "campaign" | "lab",
) => (profile === "lab" ? base : Math.ceil(base * (1 + 0.35 * (planned - 1))));

/** One prerequisite chain; XP is a threshold, coins are spent once. */
export const VEIN_UNLOCKS = {
  metal_scrap: { cost: 0, xp: 0, requires: null },
  cable_scrap: { cost: 0, xp: 12, requires: "metal_scrap" },
  plastic_scrap: { cost: 0, xp: 24, requires: "cable_scrap" },
  energy_shard: { cost: 0, xp: 60, requires: "plastic_scrap" },
} as const;
export type OreKind = keyof typeof VEIN_UNLOCKS;
