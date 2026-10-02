import { add, cross, dot, length, quatFromEulerDeg, quatMul, quatRotate, scale, sub, vec3, IDENTITY_QUAT, type Quat, type Vec3 } from './math';

/**
 * 보드 로컬 좌표 계약
 * - 보드 원점(u=0, v=0)은 보드 왼쪽 위 모서리다.
 * - u: 보드 오른쪽, v: 보드 아래쪽, n: 보드 앞면 법선. 세 축은 서로 직교하는 단위 벡터다.
 *   (v가 아래쪽이므로 u × v = -n 이다.)
 * - world = origin + (uAxis*u + vAxis*v + normal*depth) * scale
 * - depth는 시각적 오프셋이다. 충돌 계산에 사용하지 않는다.
 */
export interface Transform { position: Vec3; rotation: Quat; scale: Vec3 }
export interface BoardFrame { origin: Vec3; uAxis: Vec3; vAxis: Vec3; normal: Vec3; scale: number }
export interface LocalPoint { u: number; v: number; depth: number }

export const identityTransform = (): Transform => ({ position: vec3(), rotation: { ...IDENTITY_QUAT }, scale: vec3(1, 1, 1) });

/** 비균일 스케일은 원형 충돌을 타원으로 만들므로 지원하지 않는다. */
export function uniformScale(t: Transform): number {
  const { x, y, z } = t.scale, eps = 1e-6 * Math.max(1, Math.abs(x));
  if (Math.abs(x - y) > eps || Math.abs(x - z) > eps) throw new Error(`비균일 스케일은 지원하지 않습니다: (${x}, ${y}, ${z}). 보드 크기는 논리 치수로 조정하세요.`);
  if (!(x > 0)) throw new Error(`스케일은 양수여야 합니다: ${x}`);
  return x;
}

/** parent ∘ child. 둘 다 균일 스케일이어야 한다. */
export function composeTransforms(parent: Transform, child: Transform): Transform {
  const ps = uniformScale(parent), cs = uniformScale(child);
  return {
    position: add(parent.position, quatRotate(parent.rotation, scale(child.position, ps))),
    rotation: quatMul(parent.rotation, child.rotation),
    scale: vec3(ps * cs, ps * cs, ps * cs),
  };
}

export function frameFromTransform(t: Transform): BoardFrame {
  const s = uniformScale(t);
  return {
    origin: { ...t.position }, scale: s,
    uAxis: quatRotate(t.rotation, vec3(1, 0, 0)),
    vAxis: quatRotate(t.rotation, vec3(0, -1, 0)),
    normal: quatRotate(t.rotation, vec3(0, 0, 1)),
  };
}

export function localToWorld(f: BoardFrame, u: number, v: number, depth = 0): Vec3 {
  const s = f.scale;
  return vec3(
    f.origin.x + (f.uAxis.x * u + f.vAxis.x * v + f.normal.x * depth) * s,
    f.origin.y + (f.uAxis.y * u + f.vAxis.y * v + f.normal.y * depth) * s,
    f.origin.z + (f.uAxis.z * u + f.vAxis.z * v + f.normal.z * depth) * s,
  );
}

export function worldToLocal(f: BoardFrame, p: Vec3): LocalPoint {
  const d = sub(p, f.origin);
  return { u: dot(d, f.uAxis) / f.scale, v: dot(d, f.vAxis) / f.scale, depth: dot(d, f.normal) / f.scale };
}

export const localDirectionToWorld = (f: BoardFrame, du: number, dv: number): Vec3 => add(scale(f.uAxis, du * f.scale), scale(f.vAxis, dv * f.scale));

/** 월드 광선과 보드 면(depth = planeDepth)의 교차점을 로컬 좌표로 돌려준다. */
export function rayToLocal(f: BoardFrame, origin: Vec3, direction: Vec3, planeDepth = 0): (LocalPoint & { distance: number }) | null {
  const denom = dot(direction, f.normal);
  if (Math.abs(denom) < 1e-9) return null;
  const planePoint = add(f.origin, scale(f.normal, planeDepth * f.scale));
  const t = dot(sub(planePoint, origin), f.normal) / denom;
  if (t < 0) return null;
  const hit = add(origin, scale(direction, t));
  return { ...worldToLocal(f, hit), distance: t * length(direction) };
}

export function orthonormalError(f: BoardFrame): number {
  return Math.max(
    Math.abs(length(f.uAxis) - 1), Math.abs(length(f.vAxis) - 1), Math.abs(length(f.normal) - 1),
    Math.abs(dot(f.uAxis, f.vAxis)), Math.abs(dot(f.uAxis, f.normal)), Math.abs(dot(f.vAxis, f.normal)),
    length(add(cross(f.uAxis, f.vAxis), f.normal)),
  );
}

/** 선택 옵션: 월드 중력을 보드 면에 투영한 로컬 중력. 기본 모드(장치 내부 중력)와 섞지 않는다. */
export function projectedGravity(f: BoardFrame, gravityWorld: Vec3): { u: number; v: number } {
  return { u: dot(gravityWorld, f.uAxis) / f.scale, v: dot(gravityWorld, f.vAxis) / f.scale };
}

// ---- 배치 프리셋 ----
export type PlacementId = 'default' | 'yaw' | 'tilt' | 'roll' | 'compound';
export interface PlacementSpec { label: string; description: string; parent: { position: Vec3; yaw: number; pitch: number; roll: number }; child: { yaw: number; pitch: number; roll: number } }

export const PLACEMENTS: Record<PlacementId, PlacementSpec> = {
  default: { label: '기본', description: '보드가 정면(+Z)을 향해 수직으로 선다.', parent: { position: vec3(), yaw: 0, pitch: 0, roll: 0 }, child: { yaw: 0, pitch: 0, roll: 0 } },
  yaw: { label: 'Y축 35°', description: '월드 Y축으로 35° 회전. 보드 법선이 오른쪽 앞을 향한다.', parent: { position: vec3(), yaw: 0, pitch: 0, roll: 0 }, child: { yaw: 35, pitch: 0, roll: 0 } },
  tilt: { label: 'X축 −25°', description: '보드 위쪽이 뒤로 넘어간 경사 배치(로컬 중력은 그대로 +v).', parent: { position: vec3(), yaw: 0, pitch: 0, roll: 0 }, child: { yaw: 0, pitch: -25, roll: 0 } },
  roll: { label: '법선축 12°', description: '보드 면 안에서 12° 회전. 장치 중력이 +v이므로 원석은 보드 기준 아래로 떨어진다.', parent: { position: vec3(), yaw: 0, pitch: 0, roll: 0 }, child: { yaw: 0, pitch: 0, roll: 12 } },
  compound: { label: '부모+복합', description: '부모 Transform(Y −30°, 이동)에 자식 X −15°, Z 8°를 합성한 배치.', parent: { position: vec3(-1.5, 0.5, 1), yaw: -30, pitch: 0, roll: 0 }, child: { yaw: 0, pitch: -15, roll: 8 } },
};

/**
 * 보드 중심을 anchor에 두는 Transform을 만든다.
 * 자식 Transform은 부모 기준으로 중심이 원점에 오도록 계산한 뒤 부모와 합성한다.
 */
export function boardTransformFor(placement: PlacementSpec, anchor: Vec3, width: number, height: number, unitScale = 1): { parent: Transform; child: Transform; world: Transform } {
  const parent: Transform = { position: add(anchor, placement.parent.position), rotation: quatFromEulerDeg(placement.parent.yaw, placement.parent.pitch, placement.parent.roll), scale: vec3(1, 1, 1) };
  const rotation = quatFromEulerDeg(placement.child.yaw, placement.child.pitch, placement.child.roll);
  // 보드 로컬 중심 (W/2, H/2)는 Transform 로컬 (W/2, -H/2, 0)
  const centerOffset = quatRotate(rotation, vec3(width / 2 * unitScale, -height / 2 * unitScale, 0));
  const child: Transform = { position: scale(centerOffset, -1), rotation, scale: vec3(unitScale, unitScale, unitScale) };
  return { parent, child, world: composeTransforms(parent, child) };
}
