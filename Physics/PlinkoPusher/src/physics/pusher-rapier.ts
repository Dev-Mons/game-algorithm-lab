import RAPIER from '@dimforge/rapier3d-compat';
import type { PusherParams } from '../core/config';
import { BodySnapshot, liveBackends, type BackendStats, type PusherBackend, type PusherEvent, type TokenSpawn, type TraySpec } from './contracts';
import { trayGeometry } from './tray-geometry';

let ready: Promise<void> | null = null;
export const initRapier3d = () => (ready ??= RAPIER.init());

const G_FLOOR = 0x0001, G_WALL = 0x0002, G_PUSHER = 0x0004, G_TOKEN = 0x0008;
const groups = (membership: number, filter: number) => (membership << 16) | filter;

/**
 * Rapier 3D 푸셔 어댑터.
 * - planar: Y 이동과 X/Z 회전을 잠근 단층 조건. 바닥 접촉이 없으므로 Custom과 같은 쿨롱 마찰 감속을 어댑터가 적용한다(추가 비용 포함 측정).
 * - stacked: 중력·바닥 마찰·토큰 적층을 엔진이 처리하는 실제 3D 후보. 바닥 아래로 떨어져야 이탈이 확정된다.
 */
export class RapierPusher implements PusherBackend {
  readonly id: 'rapier3d-planar' | 'rapier3d-stacked';
  readonly label: string;
  private world: RAPIER.World | null = null;
  private spec!: TraySpec; private params!: PusherParams;
  private pusher!: RAPIER.RigidBody;
  private readonly tokens = new Map<number, RAPIER.RigidBody>();
  private readonly idByHandle = new Map<number, number>();
  private events: PusherEvent[] = [];
  private exits: number[] = []; private losses: number[] = [];
  private activeLast = 0;
  adapterMs = 0;
  private readonly corrections = { frictionApplied: 0, lost: 0 };

  constructor(readonly mode: 'planar' | 'stacked') {
    this.id = mode === 'planar' ? 'rapier3d-planar' : 'rapier3d-stacked';
    this.label = mode === 'planar' ? 'Rapier 3D 평면 제약' : 'Rapier 3D 적층';
  }

  async init(spec: TraySpec, params: PusherParams) {
    await initRapier3d();
    this.dispose();
    this.spec = spec; this.params = params;
    const d = spec.dims, g = trayGeometry(d), planar = this.mode === 'planar';
    const world = new RAPIER.World({ x: 0, y: planar ? 0 : -params.gravity, z: 0 });
    world.numSolverIterations = Math.max(1, params.engineSolverIterations);
    this.world = world;
    liveBackends.pusher++; liveBackends.engineWorlds++;
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, group: number) =>
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(params.friction).setRestitution(params.restitution).setCollisionGroups(groups(group, G_TOKEN)), fixed);
    const len = d.depth - g.zBack, midZ = (d.depth + g.zBack) / 2;
    box(0, -0.5, midZ, d.width / 2, 0.5, len / 2, G_FLOOR);
    const wh = spec.wallHeight / 2, wt = g.wallThickness;
    box(-d.width / 2 - wt, wh, midZ, wt, wh, len / 2, G_WALL);
    box(d.width / 2 + wt, wh, midZ, wt, wh, len / 2, G_WALL);
    if (!planar) {
      const lipDepth = g.lip.zFront - g.zBack;
      box(0, g.lip.yBottom + g.lip.height / 2, g.zBack + lipDepth / 2, d.width / 2, g.lip.height / 2, lipDepth / 2, G_WALL);
    }
    this.pusher = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, g.plateHeight / 2, d.faceMin - d.pusherDepth / 2));
    world.createCollider(RAPIER.ColliderDesc.cuboid(d.width / 2 - 0.01, g.plateHeight / 2, d.pusherDepth / 2).setFriction(params.friction).setRestitution(params.restitution).setCollisionGroups(groups(G_PUSHER, G_TOKEN)), this.pusher);
  }

  spawn(t: TokenSpawn) {
    const world = this.world!, p = this.params, planar = this.mode === 'planar';
    if (this.tokens.has(t.id)) return;
    let desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, planar ? t.halfHeight : t.y, t.z).setAngularDamping(planar ? 2 : 0.5).setLinearDamping(0.05);
    if (planar) desc = desc.enabledTranslations(true, false, true).enabledRotations(false, true, false);
    desc = desc.setLinvel(t.vx ?? 0, planar ? 0 : t.vy ?? 0, t.vz ?? 0);
    const body = world.createRigidBody(desc);
    world.createCollider(RAPIER.ColliderDesc.cylinder(t.halfHeight, t.radius).setDensity(1).setFriction(p.friction).setRestitution(p.restitution)
      .setCollisionGroups(groups(G_TOKEN, planar ? G_WALL | G_PUSHER | G_TOKEN : G_FLOOR | G_WALL | G_PUSHER | G_TOKEN)), body);
    this.tokens.set(t.id, body); this.idByHandle.set(body.handle, t.id);
  }

  remove(id: number) {
    const body = this.tokens.get(id);
    if (!body || !this.world) return;
    this.idByHandle.delete(body.handle); this.tokens.delete(id);
    this.world.removeRigidBody(body);
  }

  setPusher(faceZ: number) {
    const d = this.spec.dims;
    this.pusher.setNextKinematicTranslation({ x: 0, y: trayGeometry(d).plateHeight / 2, z: faceZ - d.pusherDepth / 2 });
  }

  step(dt: number) {
    const world = this.world!, d = this.spec.dims, planar = this.mode === 'planar';
    world.timestep = dt;
    world.step();
    const t0 = performance.now();
    const decel = this.params.friction * this.params.gravity * dt, maxSpeed = this.params.maxSpeed;
    this.exits.length = 0; this.losses.length = 0;
    let active = 0;
    world.forEachActiveRigidBody(body => {
      const id = this.idByHandle.get(body.handle);
      if (id === undefined) return;
      active++;
      const t = body.translation();
      if (!Number.isFinite(t.x + t.y + t.z) || t.y < -6 || Math.abs(t.x) > d.width / 2 + 1.5) { this.losses.push(id); return; }
      if (planar) {
        if (t.z > d.depth) { this.exits.push(id); return; }
        const v = body.linvel(), s = Math.hypot(v.x, v.z);
        if (s > 0) {
          const k = s <= decel ? 0 : Math.min(s - decel, maxSpeed) / s;
          body.setLinvel({ x: v.x * k, y: 0, z: v.z * k }, false); this.corrections.frictionApplied++;
        }
      } else if (t.y < -this.spec.dims.tokenHalfHeight * 3) {
        if (t.z > d.depth - this.spec.dims.tokenRadius) this.exits.push(id); else this.losses.push(id);
      }
    });
    this.activeLast = active;
    for (const id of this.exits) {
      const body = this.tokens.get(id)!, t = body.translation(), v = body.linvel(), q = body.rotation();
      this.events.push({ type: 'exit', id, x: t.x, y: t.y, z: t.z, vx: v.x, vy: v.y, vz: v.z, rotation: [q.x, q.y, q.z, q.w] }); this.remove(id);
    }
    for (const id of this.losses) { this.events.push({ type: 'lost', id }); this.corrections.lost++; this.remove(id); }
    this.adapterMs = performance.now() - t0;
  }

  snapshot(out: BodySnapshot) {
    out.ensure(this.tokens.size);
    let k = 0;
    for (const [id, body] of this.tokens) {
      const t = body.translation(), q = body.rotation();
      out.ids[k] = id; out.a[k] = t.x; out.b[k] = t.z; out.c[k] = t.y;
      out.quat[k * 4] = q.x; out.quat[k * 4 + 1] = q.y; out.quat[k * 4 + 2] = q.z; out.quat[k * 4 + 3] = q.w;
      out.sleeping[k] = body.isSleeping() ? 1 : 0; k++;
    }
    out.count = k;
  }

  drainEvents(out: PusherEvent[]) { for (const e of this.events) out.push(e); this.events.length = 0; }

  stats(): BackendStats {
    const p = this.params;
    return {
      label: this.label, bodies: this.tokens.size, active: this.activeLast, sleeping: this.tokens.size - this.activeLast, contacts: null,
      memoryBytes: null, memoryNote: '측정 불가(WASM 힙 내부 사용량 비공개)', corrections: { ...this.corrections },
      settings: {
        mode: this.mode, solverIterations: this.world?.numSolverIterations ?? p.engineSolverIterations, friction: p.friction, restitution: p.restitution,
        gravity: this.mode === 'planar' ? '0 (Y 잠금)' : p.gravity, frictionModel: this.mode === 'planar' ? '어댑터 쿨롱 감속' : '엔진 접촉 마찰', sleep: 'Rapier 기본', ccd: false,
      },
    };
  }

  reset() { for (const id of [...this.tokens.keys()]) this.remove(id); this.events.length = 0; }

  dispose() {
    if (!this.world) return;
    this.world.free(); this.world = null;
    this.tokens.clear(); this.idByHandle.clear(); this.events.length = 0;
    liveBackends.pusher--; liveBackends.engineWorlds--;
  }
}
