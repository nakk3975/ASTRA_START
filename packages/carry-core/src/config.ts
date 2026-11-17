export const RULES = "mining-2.1.0";
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
  inputExpiry: 0.35,
  disconnectSeconds: 12,
};
export const ITEM = {
  metal_scrap: { name: "고철", heavy: true, shape: "scrap", color: "#8797a5" },
  cable_scrap: {
    name: "폐전선",
    heavy: false,
    shape: "coil",
    color: "#e8a847",
  },
  plastic_scrap: {
    name: "폐플라스틱",
    heavy: false,
    shape: "plastic",
    color: "#c0dcdd",
  },
  energy_shard: {
    name: "동력석",
    heavy: false,
    shape: "crystal",
    color: "#06b6d4",
  },
  ingot: { name: "주괴", heavy: true, shape: "ingot", color: "#9caebd" },
  wire: { name: "전선", heavy: false, shape: "coil", color: "#f59e0b" },
  polymer: { name: "수지", heavy: false, shape: "plastic", color: "#e9ead3" },
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
    name: "추진 탱크",
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
    name: "주괴",
    machine: "processor",
    input: { metal_scrap: 1 },
    output: "ingot",
    seconds: 5,
  },
  draw_wire: {
    name: "전선",
    machine: "processor",
    input: { cable_scrap: 1 },
    output: "wire",
    seconds: 4,
  },
  recycle_polymer: {
    name: "수지",
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
    name: "추진 탱크",
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
export const UPGRADES = {
  carry2: {
    name: "운반량 2개",
    cost: 12,
    xp: 10,
    requires: null,
    description: "모든 작업자가 한 번에 2개 운반",
  },
  carry3: {
    name: "운반량 3개",
    cost: 45,
    xp: 60,
    requires: "carry2",
    description: "운반량을 2개에서 3개로 증가",
  },
  belts: {
    name: "컨베이어 해금",
    cost: 20,
    xp: 20,
    requires: null,
    description: "직선·코너 컨베이어 상자 제작",
  },
  mining: {
    name: "자동 채굴 해금",
    cost: 45,
    xp: 40,
    requires: "belts",
    description: "광맥에서 직접 캐는 자동 채굴기",
  },
  crane: {
    name: "크레인 해금",
    cost: 65,
    xp: 75,
    requires: "belts",
    description: "출력물과 트레이를 집어 옮기는 크레인",
  },
  installer: {
    name: "자동 설치 해금",
    cost: 90,
    xp: 120,
    requires: "crane",
    description: "현재 로켓 소켓에 맞는 부품을 자동 설치",
  },
  processing: {
    name: "가공 속도 +25%",
    cost: 50,
    xp: 70,
    requires: null,
    description: "모든 가공기의 처리 속도 증가",
  },
} as const;
export type UpgradeKey = keyof typeof UPGRADES;
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
