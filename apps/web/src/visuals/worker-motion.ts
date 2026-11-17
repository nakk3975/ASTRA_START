import * as T from "three";

/** Ground-relative gait and two-bone arm placement for the local human rigs. */
export class WorkerMotion {
  private bones = new Map<string, T.Bone>();
  private rest = new Map<string, T.Quaternion>();
  private poses = new Map<string, T.Quaternion>();
  private phase = 0;
  private weight = 0;
  private carry = 0;
  private hipsY = 0;
  private footY = 0;
  constructor(private model: T.Object3D) {
    model.traverse((o) => {
      if (o instanceof T.Bone) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, o.quaternion.clone());
        this.poses.set(o.name, o.quaternion.clone());
      }
    });
    if (this.supported) {
      this.hipsY = this.bones.get("hips")!.position.y;
      model.updateWorldMatrix(true, true);
      this.footY = Math.min(
        ...["foot_left", "foot_right"].map(
          (n) =>
            model.worldToLocal(
              this.bones.get(n)!.getWorldPosition(new T.Vector3()),
            ).y,
        ),
      );
    }
  }
  get supported() {
    return this.bones.has("forearm_left") && this.bones.has("hand_right");
  }
  update(
    dt: number,
    distance: number,
    carrying: boolean,
    working = false,
    celebrating = false,
  ) {
    if (!this.supported) return;
    const moving = distance > dt * 0.05;
    this.weight += ((moving ? 1 : 0) - this.weight) * (1 - Math.exp(-dt * 16));
    this.carry += ((carrying ? 1 : 0) - this.carry) * (1 - Math.exp(-dt * 18));
    // Match the stride to distance, including slow heavy loads and stopped walls.
    this.phase += (Math.min(distance, dt * 6) / 1.45) * Math.PI * 2;
    if ((working && !moving && !carrying) || celebrating) {
      for (const [name, b] of this.bones)
        this.poses.set(name, b.quaternion.clone());
      return;
    }
    this.bones.get("hips")!.position.y = this.hipsY;
    for (const [name, b] of this.bones) {
      if (name === "root" || name === "head" || name === "neck") continue;
      const side = name.endsWith("left") ? 1 : -1;
      const wave = Math.sin(this.phase) * side * this.weight;
      let x = 0,
        y = 0,
        z = 0;
      if (name.startsWith("thigh")) x = 0.58 * wave;
      if (name.startsWith("shin")) x = Math.max(0, -wave) * 0.78;
      if (name.startsWith("foot")) x = -0.2 * wave - Math.max(0, -wave) * 0.25;
      if (name.startsWith("upperarm")) x = -0.26 * wave * (1 - this.carry);
      if (name.startsWith("forearm")) x = -0.1 * this.weight * (1 - this.carry);
      if (name === "hips") y = Math.sin(this.phase) * 0.025 * this.weight;
      if (name === "chest") {
        x = -0.025 * this.weight;
        y = -Math.sin(this.phase) * 0.018 * this.weight;
      }
      const target = this.rest
        .get(name)!
        .clone()
        .multiply(new T.Quaternion().setFromEuler(new T.Euler(x, y, z)));
      // Do not freeze on a mid-stride frame when a carried item comes to rest.
      const previous = this.poses.get(name)!;
      previous.slerp(target, 1 - Math.exp(-dt * 22));
      b.quaternion.copy(previous);
    }
    this.model.updateWorldMatrix(true, true);
    const planted = Math.min(
      ...["foot_left", "foot_right"].map(
        (n) =>
          this.model.worldToLocal(
            this.bones.get(n)!.getWorldPosition(new T.Vector3()),
          ).y,
      ),
    );
    this.bones.get("hips")!.position.y += this.footY - planted;
    this.model.updateWorldMatrix(true, true);
    if (this.carry > 0.001)
      for (const side of ["left", "right"] as const) this.arm(side, this.carry);
    this.model.updateWorldMatrix(true, true);
  }
  private arm(side: "left" | "right", amount: number) {
    const upper = this.bones.get(`upperarm_${side}`)!,
      lower = this.bones.get(`forearm_${side}`)!,
      hand = this.bones.get(`hand_${side}`)!;
    const sign = side === "left" ? 1 : -1;
    const shoulder = upper.getWorldPosition(new T.Vector3());
    const target = this.model.localToWorld(
      new T.Vector3(sign * 0.22, 1.04, 0.36),
    );
    const pole = this.model.localToWorld(new T.Vector3(sign * 0.44, 0.98, 0.1));
    const length1 = shoulder.distanceTo(
      lower.getWorldPosition(new T.Vector3()),
    );
    const length2 = lower
      .getWorldPosition(new T.Vector3())
      .distanceTo(hand.getWorldPosition(new T.Vector3()));
    const direction = target.clone().sub(shoulder),
      distance = Math.min(direction.length(), length1 + length2 - 0.0001);
    direction.normalize();
    const along =
      (length1 * length1 - length2 * length2 + distance * distance) /
      (2 * distance);
    const bend = pole
      .sub(shoulder)
      .addScaledVector(direction, -pole.dot(direction))
      .normalize();
    const elbow = shoulder
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(
        bend,
        Math.sqrt(Math.max(0, length1 * length1 - along * along)),
      );
    const aim = (bone: T.Bone, child: T.Bone, point: T.Vector3) => {
      const desired = bone
        .parent!.worldToLocal(point.clone())
        .sub(bone.position)
        .normalize();
      const rest = this.rest.get(bone.name)!;
      const from = child.position.clone().normalize().applyQuaternion(rest);
      const q = new T.Quaternion()
        .setFromUnitVectors(from, desired)
        .multiply(rest);
      bone.quaternion.slerp(q, amount);
      bone.updateWorldMatrix(true, true);
    };
    aim(upper, lower, elbow);
    aim(lower, hand, target);
  }
  grip(target = new T.Vector3()): T.Vector3 | null {
    if (!this.supported) return null;
    this.model.updateWorldMatrix(true, true);
    const left = this.bones.get("hand_left")!.getWorldPosition(new T.Vector3());
    const right = this.bones
      .get("hand_right")!
      .getWorldPosition(new T.Vector3());
    return target.copy(left).add(right).multiplyScalar(0.5);
  }
}
