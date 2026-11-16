import P from '../../../../design/presentation_v1_1.json';
export { P };
export const E = 55 * Math.PI / 180, S = Math.sin(E), C = Math.cos(E), Q = Math.SQRT1_2;
export type XZ = { x: number; z: number };
export function screenMovement(x: number, down: number): XZ {
  const n = Math.max(1, Math.hypot(x, down));
  return { x: (x + down) * Q / n, z: (-x + down) * Q / n };
}
export function drawingSize(w: number, h: number, dpr: number, low: boolean) {
  const q = low ? P.quality.low : P.quality.standard;
  const ratio = Math.min(dpr, q.dpr_cap, Math.sqrt(q.max_render_pixels / (w * h)));
  return { width: Math.floor(w * ratio), height: Math.floor(h * ratio), ratio };
}
export function spanHeight(height: number, coarse: boolean, step: number) {
  const profile = height < 600 || coarse ? P.span_height_profiles.small_landscape : P.span_height_profiles.desktop;
  return [profile.near, profile.default, profile.wide][step]!;
}
export class FixedCamera {
  x = 24; z = 16; vx = 0; vz = 0; step = 1;
  follow = true; detached = false; held = false;
  clamp() { this.x = Math.max(-4, Math.min(52, this.x)); this.z = Math.max(-4, Math.min(36, this.z)); }
  recenter(p: XZ) { this.x = p.x; this.z = p.z; this.vx = this.vz = 0; this.detached = false; this.clamp(); }
  pan(right: number, up: number) {
    this.x += (right - up / S) * Q; this.z += (-right - up / S) * Q;
    this.detached = true; this.vx = this.vz = 0; this.clamp();
  }
  advance(p: XZ, dt: number, width: number, height: number) {
    if (!this.follow || this.detached || this.held || dt > .25 || dt < 0) { this.vx = this.vz = 0; return; }
    const count = Math.max(1, Math.ceil(dt / .05)), d = dt / count;
    for (let i = 0; i < count; i++) {
      const dx = p.x - this.x, dz = p.z - this.z;
      const u = (dx - dz) * Q, v = -(dx + dz) * S * Q;
      const eu = u - Math.max(-width * .15, Math.min(width * .15, u));
      const ev = v - Math.max(-height * .14, Math.min(height * .14, v));
      const ex = (eu - ev / S) * Q, ez = (-eu - ev / S) * Q;
      if (Math.hypot(ex, ez) < 1e-8) { this.vx = this.vz = 0; continue; }
      const n = Math.hypot(ex, ez), speed = Math.min(5.5, n * 10);
      const tx = ex / n * speed, tz = ez / n * speed;
      const diff = Math.hypot(tx - this.vx, tz - this.vz), a = Math.min(1, 12 * d / (diff || 1));
      this.vx += (tx - this.vx) * a; this.vz += (tz - this.vz) * a;
      // A reversal cannot carry the camera away from its current deadzone error.
      if (this.vx * ex + this.vz * ez < 0) this.vx = this.vz = 0;
      const scale = Math.min(1, n / (Math.hypot(this.vx, this.vz) * d || 1));
      this.x += this.vx * d * scale; this.z += this.vz * d * scale; this.clamp();
    }
  }
}
export const viewControl = {
  input: { x: 0, z: 0 }, inputAt: 0, panel: false, overview: false,
  recenter: 0, zoom: 0, launchView: false, resync: false,
  follow: true, reduced: false,
};
if (typeof localStorage !== 'undefined') {
  const os = matchMedia('(prefers-reduced-motion: reduce)').matches;
  viewControl.reduced = localStorage.getItem('orbit:reduced') === null ? os : localStorage.getItem('orbit:reduced') === 'true';
  viewControl.follow = localStorage.getItem('orbit:follow') === null ? !os : localStorage.getItem('orbit:follow') === 'true';
}
