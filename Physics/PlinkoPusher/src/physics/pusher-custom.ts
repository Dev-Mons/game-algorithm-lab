import type { PusherParams } from '../core/config';
import { BodySnapshot, liveBackends, type BackendStats, type PusherBackend, type PusherEvent, type TokenSpawn, type TraySpec } from './contracts';
import { trayGeometry } from './tray-geometry';
import { UniformGrid } from './uniform-grid';

/**
 * Custom 푸셔: 수평 원판의 단층 위치 기반 계산.
 * 1) 쿨롱 마찰 감속 후 이동 2) 제한된 반복으로 푸셔 판·원판 쌍·측면 가드 겹침 해소 3) 위치 변화로 속도 갱신.
 * 전진 중인 푸셔 판에 닿은 원판은 이번 스텝에서 움직이지 않는 물체로 취급해 밀림을 앞쪽으로 전달한다.
 * 판이 후퇴할 때는 접촉 제약이 생기지 않으므로 끌어당기지 않는다.
 * 해소되지 않은 겹침은 시각적 포개짐(lift)으로만 표시한다. 실제 다층 강체 적층이 아니다.
 */
export class CustomPusher implements PusherBackend {
  readonly id = 'custom' as const;
  readonly label = 'Custom 단층';
  readonly mode = 'planar' as const;
  private spec!: TraySpec; private params!: PusherParams;
  private n = 0; private cap = 0;
  private ids = new Int32Array(0); private x = new Float64Array(0); private z = new Float64Array(0);
  private px = new Float64Array(0); private pz = new Float64Array(0); private vx = new Float64Array(0); private vz = new Float64Array(0);
  private r = new Float64Array(0); private hh = new Float64Array(0); private lift = new Float64Array(0); private liftTarget = new Float64Array(0);
  private sleepT = new Float64Array(0); private asleep = new Uint8Array(0); private pinned = new Uint8Array(0);
  private readonly slot = new Map<number, number>();
  private events: PusherEvent[] = [];
  private grid!: UniformGrid;
  private scratch = new Int32Array(512);
  private face = 0; private faceV = 0;
  private contactsLast = 0; private maxOverlapLast = 0;
  private readonly corrections = { speedClamp: 0, correctionClamp: 0, deepOverlap: 0, lost: 0 };
  private removeList: number[] = [];
  private alive = false;

  async init(spec: TraySpec, params: PusherParams) {
    this.spec = spec; this.params = params;
    const d = spec.dims, g = trayGeometry(d);
    this.grid = new UniformGrid(-d.width / 2 - 1, g.zBack - 1, d.width + 2, d.depth - g.zBack + 3, Math.max(d.tokenRadius * 2.05, 0.2));
    this.face = d.faceMin; this.faceV = 0;
    this.grow(256);
    if (!this.alive) { this.alive = true; liveBackends.pusher++; }
  }

  private grow(capacity: number) {
    if (capacity <= this.cap) return;
    const f = (src: Float64Array) => { const d = new Float64Array(capacity); d.set(src.subarray(0, this.n)); return d; };
    const u8 = (src: Uint8Array) => { const d = new Uint8Array(capacity); d.set(src.subarray(0, this.n)); return d; };
    const i32 = new Int32Array(capacity); i32.set(this.ids.subarray(0, this.n)); this.ids = i32;
    this.x = f(this.x); this.z = f(this.z); this.px = f(this.px); this.pz = f(this.pz); this.vx = f(this.vx); this.vz = f(this.vz);
    this.r = f(this.r); this.hh = f(this.hh); this.lift = f(this.lift); this.liftTarget = f(this.liftTarget); this.sleepT = f(this.sleepT);
    this.asleep = u8(this.asleep); this.pinned = u8(this.pinned);
    this.cap = capacity;
  }

  spawn(t: TokenSpawn) {
    if (this.slot.has(t.id)) return;
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const k = this.n++;
    this.ids[k] = t.id; this.x[k] = this.px[k] = t.x; this.z[k] = this.pz[k] = t.z; this.vx[k] = t.vx ?? 0; this.vz[k] = t.vz ?? 0;
    this.r[k] = t.radius; this.hh[k] = t.halfHeight; this.lift[k] = this.liftTarget[k] = 0; this.sleepT[k] = 0; this.asleep[k] = 0; this.pinned[k] = 0;
    this.slot.set(t.id, k);
  }

  remove(id: number) {
    const k = this.slot.get(id);
    if (k === undefined) return;
    const last = --this.n;
    this.slot.delete(id);
    if (k !== last) {
      this.ids[k] = this.ids[last]; this.x[k] = this.x[last]; this.z[k] = this.z[last]; this.px[k] = this.px[last]; this.pz[k] = this.pz[last];
      this.vx[k] = this.vx[last]; this.vz[k] = this.vz[last]; this.r[k] = this.r[last]; this.hh[k] = this.hh[last];
      this.lift[k] = this.lift[last]; this.liftTarget[k] = this.liftTarget[last]; this.sleepT[k] = this.sleepT[last];
      this.asleep[k] = this.asleep[last]; this.pinned[k] = this.pinned[last];
      this.slot.set(this.ids[k], k);
    }
  }

  setPusher(faceZ: number, velocityZ: number) { this.face = faceZ; this.faceV = velocityZ; }

  private wake(k: number) { if (this.asleep[k]) { this.asleep[k] = 0; this.px[k] = this.x[k]; this.pz[k] = this.z[k]; this.vx[k] = this.vz[k] = 0; } this.sleepT[k] = 0; }

  step(dt: number) {
    const p = this.params, d = this.spec.dims, n = this.n;
    const decel = p.friction * p.gravity * dt, halfW = d.width / 2;
    for (let k = 0; k < n; k++) {
      this.pinned[k] = 0; this.liftTarget[k] = 0;
      if (this.asleep[k]) continue;
      this.px[k] = this.x[k]; this.pz[k] = this.z[k];
      let a = this.vx[k], b = this.vz[k];
      const s = Math.hypot(a, b);
      if (s > 0) { const f = s <= decel ? 0 : (s - decel) / s; a *= f; b *= f; }
      this.x[k] += a * dt; this.z[k] += b * dt;
    }
    this.grid.build(n, this.x, this.z);
    const iterations = Math.max(1, Math.min(20, Math.round(p.iterations)));
    let contacts = 0, maxOverlap = 0;
    for (let it = 0; it < iterations; it++) {
      const lastIt = it === iterations - 1;
      // 푸셔 판: 앞면 뒤로 들어간 원판을 앞면으로 밀어낸다. 전진 중이면 고정 물체로 취급한다.
      for (let k = 0; k < n; k++) {
        const r = this.r[k];
        if (this.z[k] - r < this.face) {
          this.wake(k);
          this.z[k] = this.face + r;
          if (this.faceV > 0) this.pinned[k] = 1;
        }
      }
      for (let i = 0; i < n; i++) {
        if (this.asleep[i]) continue;
        const ri = this.r[i], count = this.grid.neighbors(this.x[i], this.z[i], ri * 2 + 0.05, this.scratch);
        for (let q = 0; q < count; q++) {
          const j = this.scratch[q];
          if (j === i || (!this.asleep[j] && j < i)) continue;
          const R = ri + this.r[j], dx = this.x[i] - this.x[j], dz = this.z[i] - this.z[j], d2 = dx * dx + dz * dz;
          if (d2 >= R * R) continue;
          const dist = Math.sqrt(d2);
          const nx = dist > 1e-9 ? dx / dist : ((this.ids[i] & 1) ? 1 : -1), nz = dist > 1e-9 ? dz / dist : 0;
          const pen = R - dist;
          if (lastIt) {
            const ratio = pen / R;
            if (ratio > maxOverlap) maxOverlap = ratio;
            const lt = Math.min(1, Math.max(0, (ratio - 0.12) / 0.5));
            if (lt > this.liftTarget[i]) this.liftTarget[i] = lt;
            if (lt > this.liftTarget[j]) this.liftTarget[j] = lt;
          }
          const wi = this.pinned[i] ? 0 : 1, wj = this.pinned[j] ? 0 : 1;
          if (wi + wj === 0 || pen < 1e-4) continue;
          let c = pen;
          const limit = p.maxCorrection * Math.min(ri, this.r[j]);
          if (c > limit) { c = limit; this.corrections.correctionClamp++; }
          if (this.asleep[j]) { if (c < 0.002) continue; this.wake(j); }
          const si = c * wi / (wi + wj), sj = c * wj / (wi + wj);
          this.x[i] += nx * si; this.z[i] += nz * si; this.x[j] -= nx * sj; this.z[j] -= nz * sj;
          contacts++;
        }
      }
      for (let k = 0; k < n; k++) {
        const r = this.r[k];
        if (this.x[k] < -halfW + r) this.x[k] = -halfW + r; else if (this.x[k] > halfW - r) this.x[k] = halfW - r;
      }
    }
    if (maxOverlap > 0.5) this.corrections.deepOverlap++;
    this.contactsLast = contacts; this.maxOverlapLast = maxOverlap;
    this.removeList.length = 0;
    for (let k = 0; k < n; k++) {
      if (!Number.isFinite(this.x[k]) || !Number.isFinite(this.z[k])) { this.events.push({ type: 'lost', id: this.ids[k] }); this.corrections.lost++; this.removeList.push(this.ids[k]); continue; }
      if (this.z[k] > d.depth) { this.events.push({ type: 'exit', id: this.ids[k], x: this.x[k], y: this.hh[k], z: this.z[k] }); this.removeList.push(this.ids[k]); continue; }
      if (this.asleep[k]) continue;
      this.lift[k] += (this.liftTarget[k] - this.lift[k]) * 0.25;
      let a = (this.x[k] - this.px[k]) / dt, b = (this.z[k] - this.pz[k]) / dt;
      const s = Math.hypot(a, b);
      if (s > p.maxSpeed) { a *= p.maxSpeed / s; b *= p.maxSpeed / s; this.corrections.speedClamp++; }
      this.vx[k] = a; this.vz[k] = b;
      if (!this.pinned[k] && s < p.sleepSpeed) { this.sleepT[k] += dt; if (this.sleepT[k] >= p.sleepSeconds) { this.asleep[k] = 1; this.vx[k] = this.vz[k] = 0; } }
      else this.sleepT[k] = 0;
    }
    for (const id of this.removeList) this.remove(id);
  }

  snapshot(out: BodySnapshot) {
    out.ensure(this.n); out.count = this.n;
    for (let k = 0; k < this.n; k++) {
      out.ids[k] = this.ids[k]; out.a[k] = this.x[k]; out.b[k] = this.z[k];
      out.c[k] = this.hh[k] + this.lift[k] * this.hh[k] * 2;
      out.quat[k * 4] = 0; out.quat[k * 4 + 1] = 0; out.quat[k * 4 + 2] = 0; out.quat[k * 4 + 3] = 1;
      out.sleeping[k] = this.asleep[k];
    }
  }

  drainEvents(out: PusherEvent[]) { for (const e of this.events) out.push(e); this.events.length = 0; }

  stats(): BackendStats {
    let sleeping = 0;
    for (let k = 0; k < this.n; k++) sleeping += this.asleep[k];
    const p = this.params;
    return {
      label: this.label, bodies: this.n, active: this.n - sleeping, sleeping, contacts: this.contactsLast,
      memoryBytes: this.cap * (11 * 8 + 2 + 4), memoryNote: '상태 배열 크기(근사)',
      corrections: { ...this.corrections, maxOverlapPct: Math.round(this.maxOverlapLast * 100) },
      settings: { mode: 'planar', iterations: p.iterations, maxCorrection: p.maxCorrection, friction: p.friction, frictionModel: '쿨롱 감속', sleep: `${p.sleepSpeed}/s·${p.sleepSeconds}s` },
    };
  }

  reset() { this.n = 0; this.slot.clear(); this.events.length = 0; }
  dispose() { this.reset(); if (this.alive) { this.alive = false; liveBackends.pusher--; } }
}
