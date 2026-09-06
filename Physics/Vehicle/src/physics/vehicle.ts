import { RigidBody } from './body';
import { defaultConfig, frictionAtSpeed, rollAtSpeed, gripCurve, powerCurve, type VehicleConfig } from './config';
import { clamp, Quat, sampleCurve, Vec3 } from './math';
import { Terrain } from './terrain';

export const FIXED_DT = 1 / 120;
export const WHEEL_RADIUS = 0.32;
export interface DriverInput { throttle: number; brake: number; steer: number; handbrake: boolean }
export const neutralInput = (): DriverInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });
export interface WheelState {
  name: string; local: Vec3; front: boolean; anchor: Vec3; contact: Vec3; forcePoint: Vec3; lateralForcePoint: Vec3;
  grounded: boolean; length: number; compression: number; load: number;
  slip: number; grip: number; rollingSpeed: number; steer: number; spin: number;
  suspensionForce: Vec3; lateralForce: Vec3; driveForce: Vec3;
}
export class Vehicle {
  body: RigidBody;
  wheels: WheelState[];
  time = 0;
  stepIndex = 0;
  steer = 0;
  distance = 0;
  contactCount = 0;
  contactWork = 0;
  maxPenetration = 0;
  input = neutralInput();
  previousPosition = new Vec3();
  previousOrientation = new Quat();
  config: VehicleConfig;
  private samples: Vec3[] = [];
  constructor(public terrain = new Terrain(), config: VehicleConfig = { ...defaultConfig }) {
    this.config = { ...config };
    const m = config.mass;
    this.body = new RigidBody(m, new Vec3(m * (3.5 ** 2 + 0.7 ** 2) / 12, m * (3.5 ** 2 + 1.8 ** 2) / 12, m * (1.8 ** 2 + 0.7 ** 2) / 12));
    this.body.position.y = config.restLength + WHEEL_RADIUS - m * 9.81 / (4 * config.spring);
    this.previousPosition = this.body.position.clone();
    this.wheels = [
      // Right-handed world, +Y up and +Z forward: driver's left is +X.
      ['FL', 0.86, 1.25, true], ['FR', -0.86, 1.25, true],
      ['RL', 0.86, -1.25, false], ['RR', -0.86, -1.25, false],
    ].map(([name, x, z, front]) => ({
      name: name as string, local: new Vec3(x as number, 0, z as number), front: front as boolean,
      anchor: new Vec3(), contact: new Vec3(), forcePoint: new Vec3(), lateralForcePoint: new Vec3(), grounded: false, length: config.restLength,
      compression: 0, load: 0, slip: 0, grip: 0, rollingSpeed: 0, steer: 0, spin: 0,
      suspensionForce: new Vec3(), lateralForce: new Vec3(), driveForce: new Vec3(),
    }));
    for (const x of [-0.68, 0.68]) for (const y of [-0.08, 0.88]) for (const z of [-1.4, 0, 1.4]) this.samples.push(new Vec3(x, y, z));
    this.refreshContacts();
  }
  get forward() { return this.body.orientation.rotate(new Vec3(0, 0, 1)); }
  get speed() { return this.body.velocity.length(); }
  get forwardSpeed() { return this.body.velocity.dot(this.forward); }
  get groundedCount() { return this.wheels.filter(w => w.grounded).length; }
  get frictionCoefficient() { return frictionAtSpeed(this.config, Math.hypot(this.body.velocity.x, this.body.velocity.z)); }
  get rollCoefficient() { return rollAtSpeed(this.config, Math.hypot(this.body.velocity.x, this.body.velocity.z)); }
  get slip() { return Math.abs(this.body.velocity.dot(this.body.orientation.rotate(new Vec3(1, 0, 0)))) / Math.max(0.5, this.speed); }
  refreshContacts() {
    const up = this.body.orientation.rotate(new Vec3(0, 1, 0));
    for (const wheel of this.wheels) this.updateSuspension(wheel, up);
  }
  private updateSuspension(w: WheelState, up: Vec3) {
    const b = this.body, c = this.config;
    w.anchor = b.point(w.local);
    w.suspensionForce.set(0, 0, 0); w.lateralForce.set(0, 0, 0); w.driveForce.set(0, 0, 0);
    w.load = 0; w.compression = 0; w.slip = 0; w.grip = 0; w.rollingSpeed = 0;
    const ray = this.terrain.raycast(w.anchor, up.clone().scale(-1), c.restLength + WHEEL_RADIUS);
    w.grounded = !!ray && up.dot(ray.normal) > 0.15;
    w.length = w.grounded ? Math.max(0, ray!.distance - WHEEL_RADIUS) : c.restLength;
    w.forcePoint = w.anchor.clone().sub(up.clone().scale(w.length));
    // Arcade roll tuning changes the lateral force lever arm, not orientation.
    // 0 puts lateral forces at COM height; 1 uses the original wheel-center height.
    w.lateralForcePoint = w.anchor.clone().sub(up.clone().scale(w.length * this.rollCoefficient));
    w.contact = w.grounded ? ray!.point : w.anchor.clone().sub(up.clone().scale(c.restLength + WHEEL_RADIUS));
    if (!w.grounded) return null;
    w.compression = c.restLength - w.length;
    // Unilateral contact: a raycast tire cannot pull the ground toward the chassis.
    w.load = clamp(c.spring * w.compression - c.damping * b.pointVelocity(w.anchor).dot(up), 0, c.mass * 9.81 * 3);
    w.suspensionForce = up.clone().scale(w.load);
    return ray!.normal;
  }
  step(input: DriverInput = neutralInput()) {
    this.input = {
      throttle: clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1),
      brake: clamp(Number.isFinite(input.brake) ? input.brake : 0, 0, 1),
      steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1), handbrake: !!input.handbrake,
    };
    this.contactCount = 0; this.contactWork = 0;
    const start = this.body.position.clone();
    this.previousPosition = start.clone(); this.previousOrientation = this.body.orientation.clone();
    // Fixed two substeps: contact travel remains bounded at the configured road speeds.
    for (let i = 0; i < 2; i++) this.substep(FIXED_DT / 2);
    this.distance += this.body.position.clone().sub(start).length();
    this.stepIndex++; this.time = this.stepIndex * FIXED_DT;
    this.maxPenetration = this.penetration();
  }
  private substep(dt: number) {
    const b = this.body, c = this.config, input = this.input;
    const targetSteer = input.steer * c.steerAngle * Math.PI / 180;
    this.steer += clamp(targetSteer - this.steer, -2.4 * dt, 2.4 * dt);
    b.addForce(new Vec3(0, -9.81 * c.mass, 0));
    b.addForce(b.velocity.clone().scale(-c.drag * this.speed));
    const up = b.orientation.rotate(new Vec3(0, 1, 0));
    const curve = gripCurve(c);
    const friction = this.frictionCoefficient;
    for (const w of this.wheels) {
      // Positive driver input is right; in this right-handed frame that is -Y yaw.
      // Both the force direction and the rendered wheel use this physical angle.
      w.steer = w.front ? -this.steer : 0;
      const normal = this.updateSuspension(w, up);
      if (!normal) continue;
      // Evaluate each tire force's velocity at its own application point.
      // Longitudinal pitch retains wheel-center height; lateral roll is tunable.
      const pointVelocity = b.pointVelocity(w.forcePoint);
      const lateralPointVelocity = b.pointVelocity(w.lateralForcePoint);
      b.addForce(w.suspensionForce, w.anchor);
      const rolling = b.orientation.rotate(new Vec3(Math.sin(w.steer), 0, Math.cos(w.steer)));
      rolling.sub(normal.clone().scale(rolling.dot(normal))).unit();
      const lateral = normal.cross(rolling).unit();
      const vLat = lateralPointVelocity.dot(lateral), vLong = pointVelocity.dot(rolling);
      w.rollingSpeed = vLong;
      w.slip = Math.abs(vLat) / Math.max(0.5, Math.hypot(vLat, vLong));
      w.grip = sampleCurve(curve, w.slip) * (w.front ? c.frontGrip : c.rearGrip) * (input.handbrake && !w.front ? 0.08 : 1);
      // Grip is a fraction of lateral velocity removed per reference 60 Hz step.
      const fraction = 1 - (1 - clamp(w.grip, 0, 1)) ** (dt * 60);
      let lateralForce = -vLat * (c.mass / 4) * fraction / dt;
      const driven = c.drive === 'awd' || (c.drive === 'fwd' ? w.front : !w.front);
      const speedRatio = Math.max(0, this.forwardSpeed * Math.sign(input.throttle)) / (input.throttle < 0 ? c.topSpeed * 0.4 : c.topSpeed);
      let driveForce = driven ? input.throttle * c.engineForce * sampleCurve(powerCurve, speedRatio) / (c.drive === 'awd' ? 4 : 2) : 0;
      const brake = Math.max(input.brake, input.handbrake && !w.front ? 1 : 0);
      const brakingLimit = brake * c.brakeForce / 4 + (Math.abs(input.throttle) < 0.01 ? c.rolling : 0);
      // Limit braking by the impulse needed to stop: brakes never create reverse drive.
      driveForce -= Math.sign(vLong) * Math.min(Math.abs(vLong) * c.mass / (4 * dt), brakingLimit);
      const budget = friction * w.load * Math.max(0, up.dot(normal));
      const magnitude = Math.hypot(driveForce, lateralForce);
      if (magnitude > budget && magnitude > 0) { const scale = budget / magnitude; driveForce *= scale; lateralForce *= scale; }
      w.lateralForce = lateral.scale(lateralForce); w.driveForce = rolling.scale(driveForce);
      b.addForce(w.lateralForce, w.lateralForcePoint); b.addForce(w.driveForce, w.forcePoint);
      w.spin += vLong / WHEEL_RADIUS * dt;
    }
    b.integrate(dt);
    this.solveContacts();
  }
  private sampleContacts(point: Vec3) {
    const radius = 0.17, contacts: { normal: Vec3; depth: number }[] = [];
    const surface = this.terrain.surface(point.x, point.z);
    if (surface) {
      const depth = radius - point.clone().sub(surface.point).dot(surface.normal);
      if (depth > 0) contacts.push({ normal: surface.normal, depth });
    }
    for (const box of this.terrain.boxes) {
      const closest = new Vec3(clamp(point.x, box.min.x, box.max.x), clamp(point.y, box.min.y, box.max.y), clamp(point.z, box.min.z, box.max.z));
      const delta = point.clone().sub(closest), length = delta.length();
      if (length >= radius) continue;
      if (length > 1e-8) contacts.push({ normal: delta.scale(1 / length), depth: radius - length });
      else {
        const faces = [
          { normal: new Vec3(-1, 0, 0), depth: point.x - box.min.x + radius }, { normal: new Vec3(1, 0, 0), depth: box.max.x - point.x + radius },
          { normal: new Vec3(0, -1, 0), depth: point.y - box.min.y + radius }, { normal: new Vec3(0, 1, 0), depth: box.max.y - point.y + radius },
          { normal: new Vec3(0, 0, -1), depth: point.z - box.min.z + radius }, { normal: new Vec3(0, 0, 1), depth: box.max.z - point.z + radius },
        ];
        contacts.push(faces.sort((a, b) => a.depth - b.depth)[0]);
      }
    }
    return contacts;
  }
  private solveContacts() {
    const b = this.body;
    // Fixed 4 passes × 12 chassis samples × (ground + static boxes), no unbounded recovery loop.
    for (let pass = 0; pass < 4; pass++) for (const local of this.samples) {
      this.contactWork++;
      const point = b.point(local);
      for (const { normal, depth } of this.sampleContacts(point)) {
        this.contactCount++;
        b.position.add(normal.clone().scale(Math.max(0, depth - 0.0001)));
        const speed = b.pointVelocity(point).dot(normal);
        if (speed >= 0) continue;
        const impulse = -speed * b.effectiveMass(point, normal);
        b.addImpulse(normal.clone().scale(impulse), point);
        const velocity = b.pointVelocity(point), tangent = velocity.clone().sub(normal.clone().scale(velocity.dot(normal)));
        const tangentSpeed = tangent.length();
        if (tangentSpeed > 1e-8) {
          tangent.scale(1 / tangentSpeed);
          b.addImpulse(tangent.clone().scale(-Math.min(impulse * 0.4, tangentSpeed * b.effectiveMass(point, tangent))), point);
        }
      }
    }
  }
  penetration() { return Math.max(0, ...this.samples.flatMap(s => this.sampleContacts(this.body.point(s)).map(c => c.depth))); }
  snapshot() {
    return { step: this.stepIndex, time: this.time, position: this.body.position.clone(), velocity: this.body.velocity.clone(),
      orientation: this.body.orientation.clone(), momentum: this.body.momentum.clone(), speed: this.speed,
      forwardSpeed: this.forwardSpeed, grounded: this.groundedCount, slip: this.slip, distance: this.distance,
      contactCount: this.contactCount, penetration: this.maxPenetration, friction: this.frictionCoefficient, rollInfluence: this.rollCoefficient };
  }
}
