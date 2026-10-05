import RAPIER from '@dimforge/rapier2d-compat';
import type { PlinkoParams } from '../core/config';
import { BodySnapshot, clampSpeed2, liveBackends, nudgeDirection, type BackendStats, type PlinkoBackend, type PlinkoBoardSpec, type PlinkoEvent, type PlinkoSpawn } from './contracts';

let ready: Promise<void> | null = null;
export const initRapier2d = () => (ready ??= RAPIER.init());

const GROUP_STATIC = 0x0001, GROUP_ITEM = 0x0002;
const groups = (membership: number, filter: number) => (membership << 16) | filter;

interface Item { id: number; body: RAPIER.RigidBody; still: number; nudges: number }

/**
 * Rapier 2D 플링코 어댑터. 로컬 (u, v)를 Rapier (x, y)에 그대로 대응시킨다(Rapier 2D 자체가 평면이라 평면 제약 비용이 없다).
 * 엔진 접촉 시작 이벤트를 페그 접촉 사실로 정규화한다. 하단 도착 기준(v ≥ height)은 Custom과 같다.
 */
export class RapierPlinko implements PlinkoBackend {
  readonly id = 'rapier2d' as const;
  readonly label = 'Rapier 2D';
  private world: RAPIER.World | null = null;
  private queue: RAPIER.EventQueue | null = null;
  private spec!: PlinkoBoardSpec; private params!: PlinkoParams;
  private readonly items = new Map<number, Item>();
  private readonly itemByCollider = new Map<number, number>();
  private readonly pegByCollider = new Map<number, number>();
  private events: PlinkoEvent[] = [];
  private eventsThisStep = 0;
  private readonly corrections = { speedClamp: 0, unstuck: 0, lost: 0 };
  private removeList: number[] = [];
  adapterMs = 0;

  async init(spec: PlinkoBoardSpec, params: PlinkoParams) {
    await initRapier2d();
    this.dispose();
    this.spec = spec; this.params = params;
    const world = new RAPIER.World({ x: spec.gravity.u, y: spec.gravity.v });
    world.numSolverIterations = Math.max(1, params.engineSolverIterations);
    this.world = world; this.queue = new RAPIER.EventQueue(true);
    liveBackends.plinko++; liveBackends.engineWorlds++;
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const statics = groups(GROUP_STATIC, GROUP_ITEM);
    spec.pegs.forEach((p, index) => {
      const c = world.createCollider(RAPIER.ColliderDesc.ball(spec.pegRadius).setTranslation(p.u, p.v).setRestitution(params.restitution).setFriction(params.friction).setCollisionGroups(statics), fixed);
      this.pegByCollider.set(c.handle, index);
    });
    const h = spec.height / 2 + 2, wall = (x: number, y: number, hx: number, hy: number) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y).setRestitution(params.restitution).setFriction(params.friction).setCollisionGroups(statics), fixed);
    wall(-0.5, spec.height / 2, 0.5, h); wall(spec.width + 0.5, spec.height / 2, 0.5, h);
    if(spec.receiving)for(let i=1;i<spec.receiving.count;i++)wall(i*spec.width/spec.receiving.count,(spec.height+spec.receiving.start)/2,spec.receiving.halfThickness,(spec.height-spec.receiving.start)/2);
    // The board top is an open inlet; raw bodies start in the hopper above v=0.
  }

  spawn(b: PlinkoSpawn) {
    const world = this.world!, p = this.params;
    if (this.items.has(b.id)) return;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(b.u, b.v).setLinvel(b.vu, b.vv).setLinearDamping(p.linearDamping).setCcdEnabled(p.engineCcd));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(b.radius).setRestitution(p.restitution).setFriction(p.friction).setDensity(1)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP_ITEM, p.itemCollisions ? GROUP_STATIC | GROUP_ITEM : GROUP_STATIC)), body);
    this.items.set(b.id, { id: b.id, body, still: 0, nudges: 0 });
    this.itemByCollider.set(collider.handle, b.id);
  }

  remove(id: number) {
    const item = this.items.get(id);
    if (!item || !this.world) return;
    for (let i = 0; i < item.body.numColliders(); i++) this.itemByCollider.delete(item.body.collider(i).handle);
    this.world.removeRigidBody(item.body);
    this.items.delete(id);
  }

  step(dt: number) {
    const world = this.world!, p = this.params, s = this.spec;
    world.timestep = dt;
    world.step(this.queue!);
    const t0 = performance.now();
    this.eventsThisStep = 0;
    this.queue!.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      this.eventsThisStep++;
      const peg = this.pegByCollider.get(h1) ?? this.pegByCollider.get(h2);
      const id = this.itemByCollider.get(h1) ?? this.itemByCollider.get(h2);
      if (peg !== undefined && id !== undefined) this.events.push({ type: 'peg', id, peg });
    });
    this.removeList.length = 0;
    for (const item of this.items.values()) {
      const t = item.body.translation();
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || t.x < -1 || t.x > s.width + 1 || t.y < -2) { this.events.push({ type: 'lost', id: item.id }); this.corrections.lost++; this.removeList.push(item.id); continue; }
      if (t.y >= s.height) { const v=item.body.linvel(); this.events.push({ type: 'arrive', id: item.id, u: t.x, v: t.y, vu: v.x, vv: v.y }); this.removeList.push(item.id); continue; }
      const v = item.body.linvel(), c = clampSpeed2(v.x, v.y, p.maxSpeed);
      if (c < 1) { item.body.setLinvel({ x: v.x * c, y: v.y * c }, true); this.corrections.speedClamp++; }
      if (Math.hypot(v.x, v.y) < p.stuckSpeed) item.still += dt; else item.still = 0;
      if (item.still >= p.stuckSeconds) {
        item.body.setLinvel({ x: v.x + p.nudgeSpeed * nudgeDirection(item.id, item.nudges), y: v.y - p.nudgeSpeed * 0.3 }, true);
        item.nudges++; item.still = 0; this.corrections.unstuck++;
      }
    }
    for (const id of this.removeList) this.remove(id);
    this.adapterMs = performance.now() - t0;
  }

  snapshot(out: BodySnapshot) {
    out.ensure(this.items.size);
    let k = 0;
    for (const item of this.items.values()) {
      const t = item.body.translation();
      out.ids[k] = item.id; out.a[k] = t.x; out.b[k] = t.y; out.c[k] = item.body.rotation(); out.sleeping[k] = item.body.isSleeping() ? 1 : 0; k++;
    }
    out.count = k;
  }

  drainEvents(out: PlinkoEvent[]) { for (const e of this.events) out.push(e); this.events.length = 0; }

  stats(): BackendStats {
    let sleeping = 0;
    for (const item of this.items.values()) if (item.body.isSleeping()) sleeping++;
    const p = this.params;
    return {
      label: this.label, bodies: this.items.size, active: this.items.size - sleeping, sleeping, contacts: this.eventsThisStep,
      memoryBytes: null, memoryNote: '측정 불가(WASM 힙 내부 사용량 비공개)',
      corrections: { ...this.corrections },
      settings: { solverIterations: this.world?.numSolverIterations ?? p.engineSolverIterations, ccd: p.engineCcd, restitution: p.restitution, friction: p.friction, linearDamping: p.linearDamping, itemCollisions: p.itemCollisions, sleep: 'Rapier 기본', steps: '틱당 1회' },
    };
  }

  reset() { for (const id of [...this.items.keys()]) this.remove(id); this.events.length = 0; }

  dispose() {
    if (!this.world) return;
    this.world.free(); this.queue?.free();
    this.world = null; this.queue = null;
    this.items.clear(); this.itemByCollider.clear(); this.pegByCollider.clear(); this.events.length = 0;
    liveBackends.plinko--; liveBackends.engineWorlds--;
  }
}
