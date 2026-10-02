import type { PusherParams } from '../core/config';
import { BodySnapshot, liveBackends, type BackendStats, type PusherBackend, type PusherEvent, type TokenSpawn, type TraySpec } from './contracts';
import { trayGeometry } from './tray-geometry';
import { UniformGrid } from './uniform-grid';

const MAX_SUP = 4;
const Support = { None: 0, Floor: 1, Pusher: 2, Token: 3 } as const;
const CONTACT_MARGIN = 0.012;
/** 미끄러지는 토큰이 받침 속도를 따라가는 비율(운동 마찰) */
const KINETIC_COUPLING = 0.1;

/**
 * Custom 적층(2.5D) 푸셔: 토큰은 위치(x, y, z)를 가진 납작한 원판이며 회전 동역학 없이 위치 기반으로 계산한다.
 * - 중력으로 떨어지고 바닥·푸셔 판 윗면·다른 토큰 위에 얹힌다(원판 쌍은 수평·수직 중 얕은 축으로 분리).
 * - 받침 중심에서 무게중심이 벗어나면 바깥쪽으로 미끄러져 내린다(더미의 무너짐, 안식각).
 * - 받침이 빠지면 위 토큰을 깨워 다시 떨어뜨린다(연쇄 붕괴). 가장자리 너머로 중심이 나가면 바닥 지지가 없다.
 * - 푸셔 판 윗면에 얹힌 토큰은 판과 함께 움직이고, 후퇴 시 고정 립이 긁어 앞으로 떨어뜨린다.
 * - 기울기는 받침 높이로 추정한 표시용 값이다(충돌 형상은 항상 수평 원판).
 * 전 쌍 비교와 무제한 반복이 없다: xz 균일 격자 + 고정 반복 수.
 */
export class CustomStackPusher implements PusherBackend {
  readonly id = 'custom-stack' as const;
  readonly label = 'Custom 적층 2.5D';
  readonly mode = 'stacked' as const;
  private spec!: TraySpec; private params!: PusherParams; private geo!: ReturnType<typeof trayGeometry>;
  private n = 0; private cap = 0;
  private ids = new Int32Array(0);
  private x = new Float64Array(0); private y = new Float64Array(0); private z = new Float64Array(0);
  private px = new Float64Array(0); private py = new Float64Array(0); private pz = new Float64Array(0);
  private vx = new Float64Array(0); private vy = new Float64Array(0); private vz = new Float64Array(0);
  private r = new Float64Array(0); private hh = new Float64Array(0);
  private tx = new Float64Array(0); private tz = new Float64Array(0);
  private sleepT = new Float64Array(0);
  private asleep = new Uint8Array(0); private pinned = new Uint8Array(0);
  /** 이번 틱 끝에 재계산한 하중 수. 다음 틱의 가장자리 돌출 지지에 사용한다. */
  private loaded = new Uint8Array(0);
  /** 활성 토큰의 속도 갱신 때 초기화하고 무게중심/경사 붕괴에서 설정한다. 같은 틱의 마찰 결합이 소비한다. */
  private slip = new Uint8Array(0);
  /** 활성 토큰은 적분 때 받침 목록을 비우고 접촉 단계에서 재구성한다. 휴면 토큰은 깨울 때까지 유지한다. */
  private support = new Uint8Array(0); private nSup = new Uint8Array(0); private sup = new Int32Array(0);
  private readonly slot = new Map<number, number>();
  private events: PusherEvent[] = [];
  private grid!: UniformGrid;
  private scratch = new Int32Array(1024);
  private face = 0; private faceV = 0;
  private contactsLast = 0; private slidingLast = 0;
  private readonly corrections = { speedClamp: 0, correctionClamp: 0, slides: 0, topples: 0, edgeRests: 0, lost: 0, wakes: 0 };
  private removeList: number[] = [];
  private alive = false;

  async init(spec: TraySpec, params: PusherParams) {
    this.spec = spec; this.params = params; this.geo = trayGeometry(spec.dims);
    const d = spec.dims;
    this.grid = new UniformGrid(-d.width / 2 - 1, this.geo.zBack - 1, d.width + 2, d.depth - this.geo.zBack + 3, Math.max(d.tokenRadius * 2.05, 0.2));
    this.face = d.faceMin; this.faceV = 0;
    this.grow(512);
    if (!this.alive) { this.alive = true; liveBackends.pusher++; }
  }

  private grow(capacity: number) {
    if (capacity <= this.cap) return;
    const f = (s: Float64Array) => { const d = new Float64Array(capacity); d.set(s.subarray(0, this.n)); return d; };
    const u8 = (s: Uint8Array) => { const d = new Uint8Array(capacity); d.set(s.subarray(0, this.n)); return d; };
    const ids = new Int32Array(capacity); ids.set(this.ids.subarray(0, this.n)); this.ids = ids;
    const sup = new Int32Array(capacity * MAX_SUP); sup.set(this.sup.subarray(0, this.n * MAX_SUP)); this.sup = sup;
    this.x = f(this.x); this.y = f(this.y); this.z = f(this.z); this.px = f(this.px); this.py = f(this.py); this.pz = f(this.pz);
    this.vx = f(this.vx); this.vy = f(this.vy); this.vz = f(this.vz); this.r = f(this.r); this.hh = f(this.hh);
    this.tx = f(this.tx); this.tz = f(this.tz); this.sleepT = f(this.sleepT);
    this.asleep = u8(this.asleep); this.pinned = u8(this.pinned); this.loaded = u8(this.loaded); this.slip = u8(this.slip); this.support = u8(this.support); this.nSup = u8(this.nSup);
    this.cap = capacity;
  }

  spawn(t: TokenSpawn) {
    if (this.slot.has(t.id)) return;
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const k = this.n++;
    this.ids[k] = t.id; this.x[k] = this.px[k] = t.x; this.y[k] = this.py[k] = t.y; this.z[k] = this.pz[k] = t.z;
    this.vx[k] = t.vx ?? 0; this.vy[k] = t.vy ?? 0; this.vz[k] = t.vz ?? 0; this.r[k] = t.radius; this.hh[k] = t.halfHeight; this.tx[k] = this.tz[k] = 0;
    this.sleepT[k] = 0; this.asleep[k] = 0; this.pinned[k] = 0; this.support[k] = Support.None; this.nSup[k] = 0; this.loaded[k] = 0;
    this.slot.set(t.id, k);
  }

  remove(id: number) {
    const k = this.slot.get(id);
    if (k === undefined) return;
    const last = --this.n;
    this.slot.delete(id);
    if (k !== last) {
      for (const a of [this.x, this.y, this.z, this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.r, this.hh, this.tx, this.tz, this.sleepT]) a[k] = a[last];
      for (const a of [this.asleep, this.pinned, this.support, this.nSup, this.loaded, this.slip]) a[k] = a[last];
      this.ids[k] = this.ids[last];
      for (let s = 0; s < MAX_SUP; s++) this.sup[k * MAX_SUP + s] = this.sup[last * MAX_SUP + s];
      this.slot.set(this.ids[k], k);
    }
  }

  setPusher(faceZ: number, velocityZ: number) { this.face = faceZ; this.faceV = velocityZ; }

  private wake(k: number) {
    if (this.asleep[k]) { this.asleep[k] = 0; this.px[k] = this.x[k]; this.py[k] = this.y[k]; this.pz[k] = this.z[k]; this.vx[k] = this.vy[k] = this.vz[k] = 0; this.corrections.wakes++; }
    this.sleepT[k] = 0;
  }

  private moved(k: number) { return Math.abs(this.x[k] - this.px[k]) + Math.abs(this.y[k] - this.py[k]) + Math.abs(this.z[k] - this.pz[k]) > 1e-3; }

  private addSupport(k: number, j: number) {
    const c = this.nSup[k];
    for (let s = 0; s < c; s++) if (this.sup[k * MAX_SUP + s] === j) return;
    if (c < MAX_SUP) { this.sup[k * MAX_SUP + c] = j; this.nSup[k] = c + 1; }
    if (this.support[k] === Support.None) this.support[k] = Support.Token;
  }

  /**
   * 단계 순서는 물리 계약이다. 적분 → 반복 접촉 → 속도/이탈 → 하중 → 경사 → 마찰 결합 → 제거.
   * 각 단계는 같은 TypedArray를 갱신하며, 표시용 snapshot()은 이 상태를 읽기만 한다.
   */
  step(dt: number) {
    this.integrate(dt);
    this.grid.build(this.n, this.x, this.z);
    const iterations = Math.max(1, Math.min(16, Math.round(this.params.iterations)));
    let contacts = 0;
    for (let it = 0; it < iterations; it++) {
      this.solveStaticContacts();
      contacts += this.solveTokenContacts();
    }
    this.contactsLast = contacts;
    let sliding = this.updateMotionAndCollectExits(dt);
    this.updateLoads();
    sliding += this.topple(dt);
    this.coupleSupportVelocities();
    this.slidingLast = sliding;
    this.removeExitedTokens();
  }

  private integrate(dt: number) {
    const p = this.params, n = this.n, decel = p.friction * p.gravity * dt;
    // 1) 적분: 중력, 받침이 있을 때만 쿨롱 마찰, 판 윗면 토큰은 판과 함께 이동
    for (let k = 0; k < n; k++) {
      this.pinned[k] = 0;
      if (this.asleep[k]) continue;
      this.px[k] = this.x[k]; this.py[k] = this.y[k]; this.pz[k] = this.z[k];
      let a = this.vx[k], b = this.vz[k];
      if (this.support[k] !== Support.None) {
        const s = Math.hypot(a, b);
        if (s > 0) { const f = s <= decel ? 0 : (s - decel) / s; a *= f; b *= f; }
      }
      if (this.support[k] === Support.Pusher) b = this.faceV;
      this.vy[k] -= p.gravity * dt;
      this.x[k] += a * dt; this.y[k] += this.vy[k] * dt; this.z[k] += b * dt;
      this.vx[k] = a; this.vz[k] = b;
      this.support[k] = Support.None; this.nSup[k] = 0;
    }
  }

  private solveStaticContacts() {
    const p = this.params, d = this.spec.dims, g = this.geo, n = this.n;
    const halfW = d.width / 2, plateTop = g.plateHeight;
    // 2) 정적 형상: 바닥, 푸셔 판(앞면·윗면), 립, 측면·뒤 벽
    for (let k = 0; k < n; k++) {
      const r = this.r[k], h = this.hh[k];
      if (this.asleep[k]) {
        // 전진하는 판이 휴면 토큰에 닿으면 깨운다
        if (this.y[k] - h < plateTop && this.z[k] - r < this.face && this.z[k] > this.face - d.pusherDepth) this.wake(k); else continue;
      }
      const overPlate = this.z[k] <= this.face && this.z[k] >= this.face - d.pusherDepth;
      if (overPlate && this.py[k] - h >= plateTop - 0.03) {
        if (this.y[k] - h < plateTop + CONTACT_MARGIN) { if (this.y[k] - h < plateTop) this.y[k] = plateTop + h; this.support[k] = Support.Pusher; }
      } else if (this.y[k] - h < plateTop && this.z[k] - r < this.face) {
        this.z[k] = this.face + r;
        if (this.faceV > 0) this.pinned[k] = 1;
      }
      if (this.y[k] + h > g.lip.yBottom && this.z[k] - r < g.lip.zFront) this.z[k] = g.lip.zFront + r;
      if (this.z[k] <= d.depth + (this.loaded[k] ? r * p.overhang : 0) && this.z[k] >= g.zBack && this.y[k] - h < CONTACT_MARGIN) { if (this.y[k] < h) this.y[k] = h; this.support[k] = Support.Floor; }
      if (this.x[k] < -halfW + r) this.x[k] = -halfW + r; else if (this.x[k] > halfW - r) this.x[k] = halfW - r;
    }
  }

  private solveTokenContacts(): number {
    const p = this.params, n = this.n;
    const stacked = 0.7; // 수평 침투가 수직 침투보다 충분히 깊을 때만 올라탄다.
    let contacts = 0;
    // 3) 원판 쌍: 얕은 축으로 분리. 수직이면 위 토큰만 들어 올리고 받침을 기록한다.
    for (let i = 0; i < n; i++) {
      if (this.asleep[i]) continue;
      const ri = this.r[i], cnt = this.grid.neighbors(this.x[i], this.z[i], ri * 2 + 0.05, this.scratch);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        if (j === i || (!this.asleep[j] && j < i)) continue;
        const R = ri + this.r[j], dx = this.x[i] - this.x[j], dz = this.z[i] - this.z[j], d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const dy = this.y[i] - this.y[j], H = this.hh[i] + this.hh[j], ady = Math.abs(dy);
        if (ady >= H + CONTACT_MARGIN) continue;
        const upper = dy >= 0 ? i : j, lower = upper === i ? j : i;
        if (ady >= H) { // 닿아 있는 받침(침투 없음)
          if (this.asleep[upper] && !this.asleep[lower] && this.moved(lower)) this.wake(upper);
          if (!this.asleep[upper]) this.addSupport(upper, lower);
          continue;
        }
        const dist = Math.sqrt(d2), penH = R - dist, penV = H - ady;
        if (penV < penH * stacked) {
          if (this.asleep[upper]) this.wake(upper);
          this.y[upper] += penV;
          this.addSupport(upper, lower);
          if (penH < R * 0.35) this.corrections.edgeRests++;
        } else {
          const nx = dist > 1e-9 ? dx / dist : ((this.ids[i] & 1) ? 1 : -1), nz = dist > 1e-9 ? dz / dist : 0;
          const wi = this.pinned[i] ? 0 : 1, wj = this.pinned[j] ? 0 : 1;
          if (wi + wj === 0) continue;
          let c = penH;
          const limit = p.maxCorrection * Math.min(ri, this.r[j]);
          if (c > limit) { c = limit; this.corrections.correctionClamp++; }
          if (this.asleep[j]) { if (c < 0.002) continue; this.wake(j); }
          const si = c * wi / (wi + wj), sj = c * wj / (wi + wj);
          this.x[i] += nx * si; this.z[i] += nz * si; this.x[j] -= nx * sj; this.z[j] -= nz * sj;
        }
        contacts++;
      }
    }
    return contacts;
  }

  private updateMotionAndCollectExits(dt: number): number {
    const p = this.params, d = this.spec.dims, n = this.n, halfW = d.width / 2;
    // 4) 속도 갱신, 무너짐(받침 밖 무게중심 → 미끄러짐), 표시용 기울기, 휴면, 이탈
    let sliding = 0;
    this.removeList.length = 0;
    for (let k = 0; k < n; k++) {
      const r = this.r[k], h = this.hh[k];
      if (!Number.isFinite(this.x[k] + this.y[k] + this.z[k]) || this.y[k] < -8 || Math.abs(this.x[k]) > halfW + 1.5) { this.events.push({ type: 'lost', id: this.ids[k] }); this.corrections.lost++; this.removeList.push(this.ids[k]); continue; }
      if (this.y[k] < -h * 3) {
        if (this.z[k] > d.depth - r) this.events.push({ type: 'exit', id: this.ids[k], x: this.x[k], y: this.y[k], z: this.z[k], vx: this.vx[k], vy: this.vy[k], vz: this.vz[k] });
        else { this.events.push({ type: 'lost', id: this.ids[k] }); this.corrections.lost++; }
        this.removeList.push(this.ids[k]); continue;
      }
      if (this.asleep[k]) continue;
      let a = (this.x[k] - this.px[k]) / dt, b = (this.y[k] - this.py[k]) / dt, c = (this.z[k] - this.pz[k]) / dt;
      if (this.support[k] !== Support.None && b > 0) b = 0; // 받침에 얹힐 때 튀어 오르지 않는다(반발 0)
      const s = Math.hypot(a, b, c);
      if (s > p.maxSpeed) { a *= p.maxSpeed / s; b *= p.maxSpeed / s; c *= p.maxSpeed / s; this.corrections.speedClamp++; }
      let unstable = false, tnx = 0, tnz = 0;
      this.slip[k] = 0;
      if (this.support[k] === Support.Token) {
        let cx = 0, cz = 0, cy = 0;
        const m = this.nSup[k];
        for (let q = 0; q < m; q++) { const j = this.sup[k * MAX_SUP + q]; cx += this.x[j]; cz += this.z[j]; cy += this.y[j]; }
        cx /= m; cz /= m; cy /= m;
        const ox = this.x[k] - cx, oz = this.z[k] - cz, off = Math.hypot(ox, oz);
        const limit = r * (m === 1 ? 0.3 : m === 2 ? 0.45 : 0.6);
        if (off > limit && off > 1e-6) {
          const acc = p.gravity * 0.6 * Math.min(1, (off - limit) / r + 0.3) * dt;
          a += ox / off * acc; c += oz / off * acc; unstable = true; this.slip[k] = 1; sliding++; this.corrections.slides++;
        }
        // 기울기(표시용): 받침 중심 쪽이 높고 바깥쪽이 낮다
        const lean = Math.min(0.6, off / (r * 1.6)) * (m === 1 ? 1 : 0.6);
        if (off > 1e-6) { tnx = ox / off * lean; tnz = oz / off * lean; }
        if (this.y[k] - h < h * 2.2) { tnx *= 1.3; tnz *= 1.3; } // 바닥에 한쪽이 닿아 기댄 토큰
        void cy;
      }
      this.tx[k] += (tnx - this.tx[k]) * 0.3; this.tz[k] += (tnz - this.tz[k]) * 0.3;
      this.vx[k] = a; this.vy[k] = b; this.vz[k] = c;
      if (!unstable && !this.pinned[k] && this.support[k] !== Support.None && this.support[k] !== Support.Pusher && s < p.sleepSpeed) {
        this.sleepT[k] += dt;
        if (this.sleepT[k] >= p.sleepSeconds) { this.asleep[k] = 1; this.vx[k] = this.vy[k] = this.vz[k] = 0; }
      } else this.sleepT[k] = 0;
    }
    return sliding;
  }

  private updateLoads() {
    const n = this.n;
    // 하중 표시(다음 스텝의 가장자리 돌출 지지에 사용): 누군가의 받침이면 하중이 있다
    this.loaded.fill(0, 0, n);
    for (let k = 0; k < n; k++) if (this.support[k] === Support.Token) for (let q = 0; q < this.nSup[k]; q++) { const j = this.sup[k * MAX_SUP + q]; if (this.loaded[j] < 255) this.loaded[j]++; }
  }

  private coupleSupportVelocities() {
    const n = this.n;
    // 6) 마찰 결합: 토큰 위 토큰은 받침의 수평 속도를 따라간다(밀린 더미가 덩어리로 움직임).
    //    미끄러지는 토큰은 운동 마찰(약한 결합)만 받는다. 강한 결합을 걸면 무너짐 속도가 매 스텝 지워져 더미가 솟은 채 버틴다.
    for (let k = 0; k < n; k++) {
      if (this.asleep[k] || this.support[k] !== Support.Token) continue;
      const m = this.nSup[k], f = this.slip[k] ? KINETIC_COUPLING : this.params.coupling;
      let ax = 0, az = 0;
      for (let q = 0; q < m; q++) { const j = this.sup[k * MAX_SUP + q]; ax += this.vx[j]; az += this.vz[j]; }
      this.vx[k] += (ax / m - this.vx[k]) * f; this.vz[k] += (az / m - this.vz[k]) * f;
    }
  }

  private removeExitedTokens() {
    // 제거된 토큰 위에 얹혀 있던 휴면 토큰을 깨운다(받침이 사라짐)
    for (const id of this.removeList) {
      const k = this.slot.get(id)!;
      const cx = this.x[k], cz = this.z[k], cy = this.y[k], cnt = this.grid.neighbors(cx, cz, this.r[k] * 2, this.scratch);
      for (let q = 0; q < cnt; q++) { const j = this.scratch[q]; if (this.asleep[j] && this.y[j] > cy - 0.01) this.wake(j); }
    }
    for (const id of this.removeList) this.remove(id);
  }

  private hm = new Float64Array(0);

  private topple(dt: number): number {
    const d = this.spec.dims, g = this.geo, n = this.n, r = d.tokenRadius;
    const cell = r, x0 = -d.width / 2, z0 = g.zBack, cols = Math.ceil(d.width / cell), rows = Math.ceil((d.depth + 2 * r - z0) / cell);
    if (this.hm.length !== cols * rows) { this.hm = new Float64Array(cols * rows); }
    const hm = this.hm;
    for (let cz = 0; cz < rows; cz++) {
      const zc = z0 + (cz + 0.5) * cell;
      const base = zc > d.depth ? 0 : zc <= this.face && zc >= this.face - d.pusherDepth ? g.plateHeight : 0;
      for (let cx = 0; cx < cols; cx++) hm[cz * cols + cx] = base;
    }
    const cellOf = (x: number, z: number) => {
      const cx = Math.floor((x - x0) / cell), cz = Math.floor((z - z0) / cell);
      return cx < 0 || cz < 0 || cx >= cols || cz >= rows ? -1 : cz * cols + cx;
    };
    for (let k = 0; k < n; k++) { const c = cellOf(this.x[k], this.z[k]); if (c >= 0) { const top = this.y[k] + this.hh[k]; if (top > hm[c]) hm[c] = top; } }
    const drop = r * this.params.reposeSlope, acc = this.params.gravity * 0.5 * dt;
    let count = 0;
    for (let k = 0; k < n; k++) {
      // 하중이 사라진 돌출 토큰은 깨워서 떨어뜨린다
      if (this.asleep[k] && !this.loaded[k] && this.z[k] > d.depth) { this.wake(k); continue; }
      if (this.support[k] === Support.None && !this.asleep[k]) continue; // 공중에 있는 토큰은 중력이 처리
      const c = cellOf(this.x[k], this.z[k]);
      if (c < 0) continue;
      const top = this.y[k] + this.hh[k];
      if (top < hm[c] - this.hh[k]) continue; // 꼭대기 토큰만
      const bottom = this.y[k] - this.hh[k];
      if (bottom < 0.02) continue; // 바닥에 닿은 토큰은 미끄러지지 않는다
      const cx = c % cols, cz = (c - cx) / cols;
      let best = 0, bx = 0, bz = 0;
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oz) continue;
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nx >= cols) continue; // 측면 가드는 막혀 있다
        const nTop = nz < 0 ? 99 : nz >= rows ? 0 : hm[nz * cols + nx];
        const dist = Math.hypot(ox, oz) * cell, diff = (top - nTop) / dist;
        if (diff > best) { best = diff; bx = ox / Math.hypot(ox, oz); bz = oz / Math.hypot(ox, oz); }
      }
      if (best * cell <= drop) continue;
      if (this.asleep[k]) this.wake(k);
      const strength = Math.min(1.5, best * cell / drop - 1 + 0.4);
      this.vx[k] += bx * acc * strength; this.vz[k] += bz * acc * strength;
      this.sleepT[k] = 0; this.slip[k] = 1; count++; this.corrections.topples++;
    }
    return count;
  }

  snapshot(out: BodySnapshot) {
    out.ensure(this.n); out.count = this.n;
    for (let k = 0; k < this.n; k++) {
      out.ids[k] = this.ids[k]; out.a[k] = this.x[k]; out.b[k] = this.z[k]; out.c[k] = this.y[k];
      // 법선 (−tx, 1, −tz)… 를 위쪽 축에서 회전시키는 쿼터니언(표시용)
      const nx = this.tx[k], nz = this.tz[k], len = Math.hypot(nx, 1, nz), ux = nx / len, uy = 1 / len, uz = nz / len;
      // up(0,1,0) → u: 축 = up × u = (uz, 0, -ux), 각 = acos(uy)
      const ax = uz, az = -ux, al = Math.hypot(ax, az);
      if (al < 1e-9) { out.quat[k * 4] = 0; out.quat[k * 4 + 1] = 0; out.quat[k * 4 + 2] = 0; out.quat[k * 4 + 3] = 1; }
      else {
        const ang = Math.acos(Math.min(1, uy)), s = Math.sin(ang / 2) / al;
        out.quat[k * 4] = ax * s; out.quat[k * 4 + 1] = 0; out.quat[k * 4 + 2] = az * s; out.quat[k * 4 + 3] = Math.cos(ang / 2);
      }
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
      memoryBytes: this.cap * (16 * 8 + 4 + 4 + 4 * MAX_SUP), memoryNote: '상태 배열 크기(근사)',
      corrections: { ...this.corrections, slidingNow: this.slidingLast },
      settings: { mode: 'stacked-2.5d', iterations: p.iterations, maxCorrection: p.maxCorrection, friction: p.friction, gravity: p.gravity, frictionModel: '받침 있을 때 쿨롱 감속', collapse: `받침 밖 무게중심 미끄러짐 + 경사 붕괴(tan ${p.reposeSlope}) + 마찰 결합 ${p.coupling} + 하중 돌출 ${p.overhang}r`, sleep: `${p.sleepSpeed}/s·${p.sleepSeconds}s` },
    };
  }

  reset() { this.n = 0; this.slot.clear(); this.events.length = 0; }
  dispose() { this.reset(); if (this.alive) { this.alive = false; liveBackends.pusher--; } }
}
