import P from "../../../../design/presentation_v1_1.json";
export { P };
export const E = (P.projection.elevation_from_ground_degrees * Math.PI) / 180,
  S = Math.sin(E),
  C = Math.cos(E),
  Q = Math.SQRT1_2;
export type XZ = { x: number; z: number };
export function screenMovement(x: number, down: number): XZ {
  const n = Math.max(1, Math.hypot(x, down));
  return { x: ((x + down) * Q) / n, z: ((-x + down) * Q) / n };
}
export function drawingSize(w: number, h: number, dpr: number, low: boolean) {
  const q = low ? P.quality.low : P.quality.standard;
  const ratio = Math.min(
    dpr,
    q.dpr_cap,
    Math.sqrt(q.max_render_pixels / (w * h)),
  );
  return { width: Math.floor(w * ratio), height: Math.floor(h * ratio), ratio };
}
export function spanHeight(height: number, coarse: boolean, step: number) {
  const profile =
    height < 600 || coarse
      ? P.span_height_profiles.small_landscape
      : P.span_height_profiles.desktop;
  return [profile.near, profile.default, profile.wide][step]!;
}
export class FixedCamera {
  x = 24;
  z = 16;
  vx = 0;
  vz = 0;
  step = 1;
  follow = true;
  detached = false;
  held = false;
  clamp() {
    const b = P.follow.camera_target_bounds_xz;
    this.x = Math.max(b.x_min, Math.min(b.x_max, this.x));
    this.z = Math.max(b.z_min, Math.min(b.z_max, this.z));
  }
  recenter(p: XZ) {
    this.x = p.x;
    this.z = p.z;
    this.vx = this.vz = 0;
    this.detached = false;
    this.clamp();
  }
  pan(right: number, up: number) {
    this.x += (right - up / S) * Q;
    this.z += (-right - up / S) * Q;
    this.detached = true;
    this.vx = this.vz = 0;
    this.clamp();
  }
  advance(p: XZ, dt: number, width: number, height: number) {
    if (
      !this.follow ||
      this.detached ||
      this.held ||
      !Number.isFinite(dt) ||
      dt > P.follow.max_continuous_visible_frame_dt_seconds ||
      dt <= 0
    ) {
      this.vx = this.vz = 0;
      return;
    }
    const count = Math.max(
        1,
        Math.ceil(dt / P.follow.max_integration_step_seconds),
      ),
      d = dt / count;
    for (let i = 0; i < count; i++) {
      const dx = p.x - this.x,
        dz = p.z - this.z;
      const u = (dx - dz) * Q,
        v = -(dx + dz) * S * Q;
      const zone = P.follow.deadzone_ndc01;
      const eu =
        u -
        Math.max(
          width * (zone.left - 0.5),
          Math.min(width * (zone.right - 0.5), u),
        );
      const ev =
        v -
        Math.max(
          height * (0.5 - zone.bottom),
          Math.min(height * (0.5 - zone.top), v),
        );
      const ex = (eu - ev / S) * Q,
        ez = (-eu - ev / S) * Q;
      if (Math.hypot(ex, ez) < 1e-8) {
        this.vx = this.vz = 0;
        continue;
      }
      const n = Math.hypot(ex, ez),
        speed = Math.min(
          P.follow.max_speed_tiles_per_second,
          n * P.follow.error_to_velocity_per_second,
        );
      const tx = (ex / n) * speed,
        tz = (ez / n) * speed;
      const diff = Math.hypot(tx - this.vx, tz - this.vz),
        a = Math.min(
          1,
          (P.follow.max_velocity_change_tiles_per_second_squared * d) /
            (diff || 1),
        );
      this.vx += (tx - this.vx) * a;
      this.vz += (tz - this.vz) * a;
      // A reversal cannot carry the camera away from its current deadzone error.
      if (this.vx * ex + this.vz * ez < 0) this.vx = this.vz = 0;
      // Clamp each ground axis, including during diagonal direction changes.
      // A vector-length clamp alone can still move one axis away from its target.
      const previousX = this.x,
        previousZ = this.z;
      const bounded = (velocity: number, error: number) =>
        velocity * error > 0
          ? Math.sign(error) * Math.min(Math.abs(velocity * d), Math.abs(error))
          : 0;
      this.x += bounded(this.vx, ex);
      this.z += bounded(this.vz, ez);
      this.clamp();
      this.vx = (this.x - previousX) / d;
      this.vz = (this.z - previousZ) / d;
    }
  }
}
export const viewControl = {
  pilotInput: { x: 0, z: 0 },
  pilotReset: 0,
  graphicsReady: false,
  input: { x: 0, z: 0 },
  inputAt: 0,
  panel: false,
  overview: false,
  recenter: 0,
  zoom: 0,
  launchView: false,
  resync: false,
  follow: true,
  reduced: false,
};
if (typeof localStorage !== "undefined") {
  const os = matchMedia("(prefers-reduced-motion: reduce)").matches;
  viewControl.reduced =
    localStorage.getItem("orbit:reduced") === null
      ? os
      : localStorage.getItem("orbit:reduced") === "true";
  viewControl.follow =
    localStorage.getItem("orbit:follow") === null
      ? !os
      : localStorage.getItem("orbit:follow") === "true";
}
