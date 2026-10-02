import type { PlinkoParams } from '../core/config';
import { BodySnapshot, clampSpeed2, liveBackends, nudgeDirection, type BackendStats, type PlinkoBackend, type PlinkoBoardSpec, type PlinkoEvent, type PlinkoSpawn } from './contracts';
import { UniformGrid } from './uniform-grid';

/**
 * Custom 플링코: 보드 로컬 2D 원 충돌.
 * 중력 → 감쇠 → 속도 상한 → 이동 → 원끼리 → 페그 → 벽, 이를 제한된 서브스텝으로 반복한다.
 */
export class CustomPlinko implements PlinkoBackend {
  readonly id = 'custom' as const;
  readonly label = 'Custom 2D';
  private spec!: PlinkoBoardSpec; private params!: PlinkoParams;
  private n = 0; private cap = 0;
  private ids = new Int32Array(0); private u = new Float64Array(0); private v = new Float64Array(0);
  private vu = new Float64Array(0); private vv = new Float64Array(0); private r = new Float64Array(0);
  private ang = new Float64Array(0); private still = new Float64Array(0); private nudges = new Int32Array(0);
  private prevA = new Int32Array(0); private prevB = new Int32Array(0);
  private readonly slot = new Map<number, number>();
  private events: PlinkoEvent[] = [];
  private pegGrid!: UniformGrid; private itemGrid!: UniformGrid;
  private pegU = new Float64Array(0); private pegV = new Float64Array(0);
  private scratch = new Int32Array(256);
  private removeList: number[] = [];
  private contactsThisStep = 0;
  private readonly corrections = { speedClamp: 0, unstuck: 0, lost: 0 };
  private alive = false;

  async init(spec: PlinkoBoardSpec, params: PlinkoParams) {
    this.spec = spec; this.params = params;
    this.pegU = Float64Array.from(spec.pegs, p => p.u); this.pegV = Float64Array.from(spec.pegs, p => p.v);
    const pegCell = Math.max(spec.pegRadius * 4, 1);
    this.pegGrid = new UniformGrid(0, 0, spec.width, spec.height, pegCell);
    this.pegGrid.build(spec.pegs.length, this.pegU, this.pegV);
    this.itemGrid = new UniformGrid(-1, -1, spec.width + 2, spec.height + 2, 0.8);
    this.grow(64);
    if (!this.alive) { this.alive = true; liveBackends.plinko++; }
  }

  private grow(capacity: number) {
    if (capacity <= this.cap) return;
    const copy = <T extends Float64Array | Int32Array>(src: T, make: (n: number) => T) => { const d = make(capacity); d.set(src.subarray(0, this.n) as never); return d; };
    const f = (n: number) => new Float64Array(n), i = (n: number) => new Int32Array(n);
    this.ids = copy(this.ids, i); this.u = copy(this.u, f); this.v = copy(this.v, f); this.vu = copy(this.vu, f); this.vv = copy(this.vv, f);
    this.r = copy(this.r, f); this.ang = copy(this.ang, f); this.still = copy(this.still, f); this.nudges = copy(this.nudges, i);
    this.prevA = copy(this.prevA, i); this.prevB = copy(this.prevB, i);
    this.cap = capacity;
  }

  spawn(b: PlinkoSpawn) {
    if (this.slot.has(b.id)) return;
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const k = this.n++;
    this.ids[k] = b.id; this.u[k] = b.u; this.v[k] = b.v; this.vu[k] = b.vu; this.vv[k] = b.vv; this.r[k] = b.radius;
    this.ang[k] = 0; this.still[k] = 0; this.nudges[k] = 0; this.prevA[k] = -1; this.prevB[k] = -1;
    this.slot.set(b.id, k);
  }

  remove(id: number) {
    const k = this.slot.get(id);
    if (k === undefined) return;
    const last = --this.n;
    this.slot.delete(id);
    if (k !== last) {
      this.ids[k] = this.ids[last]; this.u[k] = this.u[last]; this.v[k] = this.v[last]; this.vu[k] = this.vu[last]; this.vv[k] = this.vv[last];
      this.r[k] = this.r[last]; this.ang[k] = this.ang[last]; this.still[k] = this.still[last]; this.nudges[k] = this.nudges[last];
      this.prevA[k] = this.prevA[last]; this.prevB[k] = this.prevB[last];
      this.slot.set(this.ids[k], k);
    }
  }

  step(dt: number) {
    const p = this.params, s = this.spec, sub = Math.max(1, Math.min(16, Math.round(p.substeps))), h = dt / sub;
    const gu = s.gravity.u, gv = s.gravity.v, damp = 1 / (1 + p.linearDamping * h), e = p.restitution, mu = p.friction;
    const pr = s.pegRadius;
    this.contactsThisStep = 0;
    for (let it = 0; it < sub; it++) {
      for (let k = 0; k < this.n; k++) {
        let a = (this.vu[k] + gu * h) * damp, b = (this.vv[k] + gv * h) * damp;
        const c = clampSpeed2(a, b, p.maxSpeed);
        if (c < 1) { a *= c; b *= c; this.corrections.speedClamp++; }
        this.vu[k] = a; this.vv[k] = b;
        this.u[k] += a * h; this.v[k] += b * h;
      }
      if (p.itemCollisions && this.n > 1) this.solveItems(e);
      for (let k = 0; k < this.n; k++) {
        const r = this.r[k], reach = r + pr;
        let curA = -1, curB = -1;
        const count = this.pegGrid.neighbors(this.u[k], this.v[k], reach, this.scratch);
        for (let q = 0; q < count; q++) {
          const g = this.scratch[q];
          const dx = this.u[k] - this.pegU[g], dy = this.v[k] - this.pegV[g], d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = reach - d;
          this.u[k] += nx * pen; this.v[k] += ny * pen;
          const vn = this.vu[k] * nx + this.vv[k] * ny;
          if (vn < 0) {
            this.vu[k] -= (1 + e) * vn * nx; this.vv[k] -= (1 + e) * vn * ny;
            const tx = -ny, ty = nx, vt = this.vu[k] * tx + this.vv[k] * ty;
            const jt = Math.min(Math.abs(vt), mu * (1 + e) * -vn) * Math.sign(vt);
            this.vu[k] -= jt * tx; this.vv[k] -= jt * ty;
            this.ang[k] += vt * h / r;
          }
          this.contactsThisStep++;
          if (g !== this.prevA[k] && g !== this.prevB[k]) this.events.push({ type: 'peg', id: this.ids[k], peg: g });
          if (curA < 0) curA = g; else if (curB < 0 && g !== curA) curB = g;
        }
        this.prevA[k] = curA; this.prevB[k] = curB;
        if (this.u[k] < r) { this.u[k] = r; if (this.vu[k] < 0) this.vu[k] = -this.vu[k] * e; }
        else if (this.u[k] > s.width - r) { this.u[k] = s.width - r; if (this.vu[k] > 0) this.vu[k] = -this.vu[k] * e; }
        if (this.v[k] < r) { this.v[k] = r; if (this.vv[k] < 0) this.vv[k] = -this.vv[k] * e; }
      }
      this.collectExits();
    }
    // 끼임 보정(틱 단위)
    for (let k = 0; k < this.n; k++) {
      if (Math.hypot(this.vu[k], this.vv[k]) < p.stuckSpeed) this.still[k] += dt; else this.still[k] = 0;
      if (this.still[k] >= p.stuckSeconds) {
        this.vu[k] += p.nudgeSpeed * nudgeDirection(this.ids[k], this.nudges[k]); this.vv[k] -= p.nudgeSpeed * 0.3;
        this.nudges[k]++; this.still[k] = 0; this.corrections.unstuck++;
      }
    }
  }

  private solveItems(e: number) {
    this.itemGrid.build(this.n, this.u, this.v);
    for (let i = 0; i < this.n; i++) {
      const ri = this.r[i], count = this.itemGrid.neighbors(this.u[i], this.v[i], ri * 2 + 0.1, this.scratch);
      for (let q = 0; q < count; q++) {
        const j = this.scratch[q];
        if (j <= i) continue;
        const R = ri + this.r[j], dx = this.u[i] - this.u[j], dy = this.v[i] - this.v[j], d2 = dx * dx + dy * dy;
        if (d2 >= R * R || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, half = (R - d) / 2;
        this.u[i] += nx * half; this.v[i] += ny * half; this.u[j] -= nx * half; this.v[j] -= ny * half;
        const vn = (this.vu[i] - this.vu[j]) * nx + (this.vv[i] - this.vv[j]) * ny;
        if (vn < 0) {
          const jn = -(1 + e) * vn / 2;
          this.vu[i] += jn * nx; this.vv[i] += jn * ny; this.vu[j] -= jn * nx; this.vv[j] -= jn * ny;
        }
        this.contactsThisStep++;
      }
    }
  }

  private collectExits() {
    const s = this.spec;
    this.removeList.length = 0;
    for (let k = 0; k < this.n; k++) {
      const u = this.u[k], v = this.v[k];
      if (!Number.isFinite(u) || !Number.isFinite(v) || u < -1 || u > s.width + 1 || v < -2) { this.events.push({ type: 'lost', id: this.ids[k] }); this.corrections.lost++; this.removeList.push(this.ids[k]); }
      else if (v >= s.height) { this.events.push({ type: 'arrive', id: this.ids[k], u }); this.removeList.push(this.ids[k]); }
    }
    for (const id of this.removeList) this.remove(id);
  }

  snapshot(out: BodySnapshot) {
    out.ensure(this.n); out.count = this.n;
    for (let k = 0; k < this.n; k++) { out.ids[k] = this.ids[k]; out.a[k] = this.u[k]; out.b[k] = this.v[k]; out.c[k] = this.ang[k]; out.sleeping[k] = 0; }
  }

  drainEvents(out: PlinkoEvent[]) { for (const e of this.events) out.push(e); this.events.length = 0; }

  stats(): BackendStats {
    const p = this.params;
    return {
      label: this.label, bodies: this.n, active: this.n, sleeping: 0, contacts: this.contactsThisStep,
      memoryBytes: this.cap * (8 * 8 + 4 * 4) + this.pegU.byteLength * 2, memoryNote: '상태 배열 크기(근사)',
      corrections: { ...this.corrections },
      settings: { substeps: p.substeps, restitution: p.restitution, friction: p.friction, linearDamping: p.linearDamping, itemCollisions: p.itemCollisions, sleep: '없음' },
    };
  }

  reset() { this.n = 0; this.slot.clear(); this.events.length = 0; }
  dispose() { this.reset(); if (this.alive) { this.alive = false; liveBackends.plinko--; } }
}
