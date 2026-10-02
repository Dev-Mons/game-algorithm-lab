import type { PlinkoParams, PusherParams, TrayDims } from '../core/config';

/**
 * 물리 백엔드 공통 계약.
 * - 플링코는 보드 로컬 2D(u 오른쪽, v 아래, 중력은 설정값)만 안다. 월드 배치·Three.js 좌표를 받지 않는다.
 * - 푸셔는 트레이 로컬 좌표(x 가로, y 위, z 앞쪽; z=0 뒤 벽, z=depth 보상 가장자리)만 안다.
 * - 백엔드는 보상을 지급하지 않는다. 접촉·도착·이탈 사실만 이벤트로 보고한다.
 * - 영역을 벗어난 물체(도착·이탈·유실)는 백엔드가 스스로 제거하고 한 번만 보고한다. 이후 remove()는 무시된다.
 * - 엔진 World/Body/Collider는 어댑터 밖으로 노출하지 않는다.
 */
export type PlinkoBackendId = 'custom' | 'rapier2d';
export type PusherBackendId = 'custom-stack' | 'custom' | 'rapier3d-planar' | 'rapier3d-stacked';

export interface PlinkoBoardSpec {
  width: number; height: number;
  pegs: ReadonlyArray<{ u: number; v: number }>; pegRadius: number;
  /** 로컬 중력(u, v). 기본 모드는 (0, gravity). */
  gravity: { u: number; v: number };
}
export interface PlinkoSpawn { id: number; u: number; v: number; vu: number; vv: number; radius: number }
export type PlinkoEvent =
  | { type: 'peg'; id: number; peg: number }
  | { type: 'arrive'; id: number; u: number }
  | { type: 'lost'; id: number };

export interface TokenSpawn { id: number; x: number; y: number; z: number; radius: number; halfHeight: number }
export type PusherEvent = { type: 'exit'; id: number; x: number; y: number; z: number } | { type: 'lost'; id: number };

export interface BackendStats {
  label: string;
  bodies: number; active: number;
  /** null = 측정 불가 */
  sleeping: number | null; contacts: number | null;
  /** 백엔드가 보고 가능한 메모리 근사(바이트). null = 측정 불가 */
  memoryBytes: number | null;
  memoryNote: string;
  /** 보정 규칙이 개입한 횟수(누적) */
  corrections: Record<string, number>;
  settings: Record<string, string | number | boolean>;
}

/** 미리 할당한 상태 버퍼. 렌더링·게이트 검사에 쓰는 상태 전달 형식이다. */
export class BodySnapshot {
  count = 0;
  ids: Int32Array; a: Float32Array; b: Float32Array; c: Float32Array; quat: Float32Array; sleeping: Uint8Array;
  constructor(capacity = 256) {
    this.ids = new Int32Array(capacity); this.a = new Float32Array(capacity); this.b = new Float32Array(capacity); this.c = new Float32Array(capacity);
    this.quat = new Float32Array(capacity * 4); this.sleeping = new Uint8Array(capacity);
  }
  ensure(capacity: number) {
    if (capacity <= this.ids.length) return;
    const next = new BodySnapshot(Math.max(capacity, this.ids.length * 2));
    this.ids = next.ids; this.a = next.a; this.b = next.b; this.c = next.c; this.quat = next.quat; this.sleeping = next.sleeping;
  }
}

export interface PlinkoBackend {
  readonly id: PlinkoBackendId;
  readonly label: string;
  /** 엔진 step 밖에서 어댑터가 쓴 시간(ms, 마지막 step). 없으면 undefined. */
  readonly adapterMs?: number;
  init(spec: PlinkoBoardSpec, params: PlinkoParams): Promise<void>;
  spawn(body: PlinkoSpawn): void;
  remove(id: number): void;
  step(dt: number): void;
  /** a=u, b=v, c=회전각(표시용) */
  snapshot(out: BodySnapshot): void;
  drainEvents(out: PlinkoEvent[]): void;
  stats(): BackendStats;
  /** 동적 물체를 모두 제거하고 정적 형상은 유지한다. */
  reset(): void;
  dispose(): void;
}

export interface TraySpec { dims: TrayDims; /** 측면 가드 높이 */ wallHeight: number }

export interface PusherBackend {
  readonly id: PusherBackendId;
  readonly label: string;
  /** 'planar' = 단층·평면 제약 비교 조건, 'stacked' = 실제 3D 적층 후보 */
  readonly mode: 'planar' | 'stacked';
  /** 엔진 step 밖에서 어댑터가 쓴 시간(ms, 마지막 step): 평면 제약 마찰 보정·이탈 검사 등. */
  readonly adapterMs?: number;
  init(spec: TraySpec, params: PusherParams): Promise<void>;
  spawn(token: TokenSpawn): void;
  remove(id: number): void;
  /** 공통 코드가 계산한 푸셔 판 앞면 위치와 속도 */
  setPusher(faceZ: number, velocityZ: number): void;
  step(dt: number): void;
  /** a=x, b=z, c=y, quat=회전, sleeping=휴면 */
  snapshot(out: BodySnapshot): void;
  drainEvents(out: PusherEvent[]): void;
  stats(): BackendStats;
  reset(): void;
  dispose(): void;
}

/** 백엔드 수명 추적: 교체 후 이전 월드가 남지 않는지 검사한다. */
export const liveBackends = { plinko: 0, pusher: 0, engineWorlds: 0 };

/** 플링코 공통 보정 규칙: 과속 제한과 끼임 해소. 두 백엔드가 같은 규칙을 쓴다. */
export function clampSpeed2(vu: number, vv: number, max: number): number {
  const s = Math.hypot(vu, vv);
  return s > max ? max / s : 1;
}
export const nudgeDirection = (id: number, count: number) => ((id + count) % 2 === 0 ? 1 : -1);
