export const ZOOM = { min: 12, max: 48, initial: 22 };
export const clampDistance = (n: number) =>
  Number.isFinite(n) ? Math.max(ZOOM.min, Math.min(ZOOM.max, n)) : ZOOM.initial;
export function wheelDistance(current: number, delta: number, mode = 0) {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? 600 : 1);
  return clampDistance(
    current * Math.exp(Math.max(-300, Math.min(300, pixels)) * 0.0015),
  );
}
