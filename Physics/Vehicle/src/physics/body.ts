import { Quat, Vec3 } from './math';

/** One six-degree-of-freedom body. Angular momentum is world-space. */
export class RigidBody {
  position = new Vec3(0, 1, 0);
  orientation = new Quat();
  velocity = new Vec3();
  momentum = new Vec3();
  force = new Vec3();
  torque = new Vec3();
  constructor(public mass: number, public inertia: Vec3) {}
  inverseInertia(v: Vec3) {
    const local = this.orientation.inverseRotate(v);
    return this.orientation.rotate(new Vec3(local.x / this.inertia.x, local.y / this.inertia.y, local.z / this.inertia.z));
  }
  get angularVelocity() { return this.inverseInertia(this.momentum); }
  point(local: Vec3) { return this.orientation.rotate(local).add(this.position); }
  pointVelocity(point: Vec3) { return this.angularVelocity.cross(point.clone().sub(this.position)).add(this.velocity); }
  addForce(force: Vec3, point = this.position) {
    this.force.add(force); this.torque.add(point.clone().sub(this.position).cross(force));
  }
  addImpulse(impulse: Vec3, point = this.position) {
    this.velocity.add(impulse.clone().scale(1 / this.mass));
    this.momentum.add(point.clone().sub(this.position).cross(impulse));
  }
  effectiveMass(point: Vec3, direction: Vec3) {
    const arm = point.clone().sub(this.position);
    return 1 / (1 / this.mass + this.inverseInertia(arm.cross(direction)).cross(arm).dot(direction));
  }
  integrate(dt: number) {
    this.velocity.add(this.force.clone().scale(dt / this.mass));
    this.momentum.add(this.torque.clone().scale(dt));
    this.position.add(this.velocity.clone().scale(dt));
    this.orientation.integrate(this.angularVelocity, dt);
    this.force.set(0, 0, 0); this.torque.set(0, 0, 0);
  }
}
