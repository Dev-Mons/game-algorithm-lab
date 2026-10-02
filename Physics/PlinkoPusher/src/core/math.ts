// 렌더러와 무관한 최소 벡터·쿼터니언 연산. Three.js 좌표 타입을 코어로 끌어들이지 않는다.
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3): Vec3 => { const l = length(a) || 1; return scale(a, 1 / l); };

export const IDENTITY_QUAT: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis), s = Math.sin(angle / 2);
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(angle / 2) };
}

/** a * b: b를 먼저 적용한 뒤 a를 적용한다. */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const qv = vec3(q.x, q.y, q.z), t = scale(cross(qv, v), 2);
  return add(add(v, scale(t, q.w)), cross(qv, t));
}

export const quatNormalize = (q: Quat): Quat => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };

/** 각도는 도 단위. 적용 순서: roll(Z) → pitch(X) → yaw(Y). */
export function quatFromEulerDeg(yaw: number, pitch: number, roll: number): Quat {
  const d = Math.PI / 180;
  return quatNormalize(quatMul(quatAxisAngle(vec3(0, 1, 0), yaw * d), quatMul(quatAxisAngle(vec3(1, 0, 0), pitch * d), quatAxisAngle(vec3(0, 0, 1), roll * d))));
}
