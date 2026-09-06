export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  clone() { return new Vec3(this.x, this.y, this.z); }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: Vec3) { return this.set(v.x, v.y, v.z); }
  add(v: Vec3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: Vec3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: Vec3) { return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  unit() { const n = this.length(); return n > 1e-12 ? this.scale(1 / n) : this.set(0, 0, 0); }
  finite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
}
export class Quat {
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  unit() { const n = Math.hypot(this.x, this.y, this.z, this.w); this.x /= n; this.y /= n; this.z /= n; this.w /= n; return this; }
  rotate(v: Vec3): Vec3 {
    const q = new Vec3(this.x, this.y, this.z), t = q.cross(v).scale(2);
    return v.clone().add(t.clone().scale(this.w)).add(q.cross(t));
  }
  inverseRotate(v: Vec3) { return new Quat(-this.x, -this.y, -this.z, this.w).rotate(v); }
  integrate(omega: Vec3, dt: number) {
    const { x, y, z, w } = this, h = dt * 0.5;
    this.x += h * (omega.x * w + omega.y * z - omega.z * y);
    this.y += h * (-omega.x * z + omega.y * w + omega.z * x);
    this.z += h * (omega.x * y - omega.y * x + omega.z * w);
    this.w += h * (-omega.x * x - omega.y * y - omega.z * z);
    return this.unit();
  }
}
export type Curve = readonly (readonly [number, number])[];
export function sampleCurve(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
  }
  return curve[curve.length - 1][1];
}
