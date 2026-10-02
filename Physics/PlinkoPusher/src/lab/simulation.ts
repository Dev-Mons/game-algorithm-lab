import { boardTransformFor, frameFromTransform, projectedGravity, PLACEMENTS, type BoardFrame, type PlacementId, type Transform } from '../core/frame';
import { GameCore, type ReleaseOrder } from '../core/game-core';
import { buildBoardLayout, type BoardLayout } from '../core/layout';
import { vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { BodySnapshot, type PlinkoBackend, type PlinkoEvent, type PusherBackend, type PusherEvent } from '../physics/contracts';
import { createPlinko, createPusher } from '../physics/registry';
import { pusherMotion, trayGeometry } from '../physics/tray-geometry';
import { deviceLayout, cargoOffset, RAW_ENTRY_V, PLANAR_LOWER_SECONDS, type DeviceLayout } from './device-layout';
import type { Scenario } from './scenario';

const now = () => globalThis.performance.now();

export interface StepTiming { plinkoMs: number; pusherMs: number; coreMs: number }
export interface ExitVisual { id: number; x: number; y: number; z: number; vx?: number; vy?: number; vz?: number; rotation?: [number, number, number, number]; value: number; origin: 'produced' | 'seed' }

/**
 * 한 실험의 공통 고정 스텝 파이프라인. 렌더링과 무관하며 브라우저와 Node 측정 스크립트가 같이 쓴다.
 * 순서: 시간·공급 → 투입 → 플링코 step → 플링코 사실 정산 → 공통 푸셔 운동 → 트레이 공급 게이트 → 푸셔 step → 이탈 정산 → 부산물 공정.
 */
export class Simulation {
  readonly core: GameCore;
  readonly layout: BoardLayout;
  readonly device: DeviceLayout;
  boardWorld!: Transform; boardParent!: Transform; frame!: BoardFrame;
  tick = 0;
  readonly plinkoSnap = new BodySnapshot(64);
  readonly pusherSnap = new BodySnapshot(256);
  /** 투입 판정은 렌더링 sync 주기와 무관하게 현재 물리 상태를 읽는다. */
  private readonly feedSnapshot = new BodySnapshot(256);
  readonly timing: StepTiming = { plinkoMs: 0, pusherMs: 0, coreMs: 0 };
  initMs = { plinko: 0, pusher: 0 };
  pusherFace = 0;
  readonly exitVisuals: ExitVisual[] = [];
  readonly gateStats = { blocked: 0, fed: 0 };
  private releases: ReleaseOrder[] = [];
  private plinkoEvents: PlinkoEvent[] = [];
  private pusherEvents: PusherEvent[] = [];
  readonly discharge = { progress: 0, blocked: false, releaseAt: -Infinity, lastCount: 0 };
  readonly batchStats = { dumps: 0, largestDump: 0 };
  readonly handovers: Array<{ id: number; x: number; y: number; z: number; vy: number; tick: number }> = [];
  readonly pegFlashes = new Map<number, number>();
  private disposed = false;

  private constructor(readonly scenario: Scenario, readonly plinko: PlinkoBackend, readonly pusher: PusherBackend) {
    this.layout = buildBoardLayout(scenario.board, scenario.pegs);
    this.core = new GameCore(scenario.economy, scenario.flow, this.layout, scenario.seed);
    for (const peg of scenario.pegOverrides) this.core.setPeg(peg.index, peg.kind, peg.level);
    this.device = deviceLayout(scenario.board, scenario.tray, pusher.mode === 'stacked');
    this.setPlacement(scenario.placement);
  }

  static async create(scenario: Scenario): Promise<Simulation> {
    const sim = new Simulation(scenario, createPlinko(scenario.backends.plinko), createPusher(scenario.backends.pusher));
    try {
      const s = scenario;
      const gravity = s.plinko.gravityMode === 'world-projected' ? projectedGravity(sim.frame, vec3(0, -s.plinko.gravity, 0)) : { u: 0, v: s.plinko.gravity };
      let t = now();
      await sim.plinko.init({ width: s.board.width, height: s.board.height, pegs: sim.layout.pegs, pegRadius: s.board.pegRadius, gravity }, s.plinko);
      sim.initMs.plinko = now() - t;
      t = now();
      await sim.pusher.init({ dims: s.tray, wallHeight: trayGeometry(s.tray).wallHeight }, s.pusher);
      sim.initMs.pusher = now() - t;
      sim.core.addRaw(s.initialRaw);
      sim.seedTray(s.initialTokens);
      sim.pusherFace = s.tray.faceMin;
      sim.pusher.setPusher(s.tray.faceMin, 0);
      return sim;
    } catch (error) {
      sim.dispose();
      throw error;
    }
  }

  /** 보드 배치만 바꾼다. 로컬 물리 상태는 그대로이며 표시·선택 변환만 달라진다. */
  setPlacement(id: PlacementId) {
    const t = boardTransformFor(PLACEMENTS[id], this.device.boardAnchor, this.scenario.board.width, this.scenario.board.height);
    this.boardParent = t.parent; this.boardWorld = t.world; this.frame = frameFromTransform(t.world);
    this.scenario.placement = id;
  }

  private seedTray(count: number) {
    if (count <= 0) return;
    if (this.pusher.mode === 'stacked') { this.seedHeap(count); return; }
    const d = this.scenario.tray, r = d.tokenRadius;
    const spacing = r * 2 * 1.02, rowStep = spacing * Math.sqrt(3) / 2;
    const z0 = d.faceMin + d.stroke + r - 0.12, z1 = d.depth - r - 0.3, x0 = -d.width / 2 + r + 0.02, x1 = d.width / 2 - r - 0.02;
    const slots: Array<[number, number]> = [];
    for (let row = 0, z = z0; z <= z1; row++, z += rowStep) for (let x = x0 + (row % 2 ? spacing / 2 : 0); x <= x1; x += spacing) slots.push([x, z]);
    const rng = new Rng(this.scenario.seed * 31 + 5);
    for (let i = slots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    // 단층 조건: 한 층 슬롯을 넘는 초기 토큰은 겹쳐 넣지 않고 투입 대기열로 보낸다(투입구 게이트를 통해 들어감).
    const onTray = Math.min(count, slots.length);
    this.core.placeSeed(onTray).forEach((token, i) => {
      const [x, z] = slots[i];
      this.pusher.spawn({ id: token.id, x, y: d.tokenHalfHeight, z, radius: r, halfHeight: d.tokenHalfHeight });
    });
    if (count > onTray) this.core.queueSeed(count - onTray);
  }

  /**
   * 적층 조건 초기 적재: 뒤쪽·가운데가 높고 앞쪽·가장자리가 낮은 더미. 층마다 반 칸 어긋나게 둔다.
   * 슬롯이 모자라면 최대 층수를 올린다. 배치 후 첫 몇 초 동안 더미가 스스로 무너지며 자리를 잡는다.
   */
  private seedHeap(count: number) {
    const d = this.scenario.tray, r = d.tokenRadius, h = d.tokenHalfHeight;
    const spacing = r * 2 * 1.02, rowStep = spacing * Math.sqrt(3) / 2;
    const z0 = d.faceMin + d.stroke + r - 0.12, z1 = d.depth - r - 0.3, x0 = -d.width / 2 + r + 0.02, x1 = d.width / 2 - r - 0.02;
    const rng = new Rng(this.scenario.seed * 31 + 5);
    const heightAt = (x: number, z: number, maxLayers: number) => maxLayers * (1 - 0.7 * (z - z0) / Math.max(1e-6, z1 - z0)) * (1 - 0.45 * Math.abs(x) / (d.width / 2));
    let slots: Array<[number, number, number]> = [];
    for (let maxLayers = 1; maxLayers < 40; maxLayers++) {
      slots = [];
      for (let layer = 0; layer < maxLayers + 1; layer++) {
        const layerSlots: Array<[number, number, number]> = [], ox = layer % 2 ? spacing / 2 : 0, oz = layer % 2 ? rowStep / 3 : 0;
        for (let row = 0, z = z0 + oz; z <= z1; row++, z += rowStep) for (let x = x0 + ox + (row % 2 ? spacing / 2 : 0); x <= x1; x += spacing) if (layer === 0 || heightAt(x, z, maxLayers) > layer) layerSlots.push([x, z, layer]);
        for (let i = layerSlots.length - 1; i > 0; i--) { const j = rng.int(i + 1); [layerSlots[i], layerSlots[j]] = [layerSlots[j], layerSlots[i]]; }
        slots.push(...layerSlots);
      }
      if (slots.length >= count) break;
    }
    this.core.placeSeed(count).forEach((token, i) => {
      const [x, z, layer] = slots[i % slots.length];
      this.pusher.spawn({ id: token.id, x: x + rng.range(-0.04, 0.04), y: h + layer * (2 * h + 0.004) + 0.001, z: z + rng.range(-0.04, 0.04), radius: r, halfHeight: h });
    });
  }

  addRaw(count: number) { this.core.addRaw(count); }

  step() {
    if (this.disposed) return;
    const s = this.scenario, dt = s.fixedDt, core = this.core;
    let t0 = now();
    core.beginTick(dt);
    for (const entry of s.schedule) if (entry.tick === this.tick) core.addRaw(entry.count);
    this.releases.length = 0;
    core.takeReleases(dt, this.releases);
    for (const r of this.releases) this.plinko.spawn({ ...r, v: RAW_ENTRY_V, vu: 0, radius: s.board.itemRadius });
    let coreMs = now() - t0;

    t0 = now();
    this.plinko.step(dt);
    this.timing.plinkoMs = now() - t0;

    t0 = now();
    this.plinkoEvents.length = 0;
    this.plinko.drainEvents(this.plinkoEvents);
    for (const e of this.plinkoEvents) {
      if (e.type === 'peg') { core.onPegContact(e.id, e.peg); this.pegFlashes.set(e.peg, core.time); }
      else if (e.type === 'arrive') core.onArrive(e.id, e.u);
      else core.onItemLost(e.id);
    }
    const motion = pusherMotion(s.tray, (this.tick + 1) * dt);
    this.pusherFace = motion.face;
    this.pusher.setPusher(motion.face, motion.velocity);
    this.feedTray(dt);
    coreMs += now() - t0;

    t0 = now();
    this.pusher.step(dt);
    this.timing.pusherMs = now() - t0;

    t0 = now();
    this.pusherEvents.length = 0;
    this.pusher.drainEvents(this.pusherEvents);
    for (const e of this.pusherEvents) {
      if (e.type === 'exit') {
        const token = core.tray.get(e.id);
        if (core.onTokenExit(e.id) !== null && token && this.exitVisuals.length < 256) this.exitVisuals.push({ ...e, value: token.value, origin: token.origin });
      } else core.onTokenLost(e.id);
    }
    core.stepByproduct(dt, { canPress: this.discharge.progress === 0, maxBatchSize: this.device.cargoColumns * this.device.cargoRows });
    this.timing.coreMs = coreMs + now() - t0;
    this.tick++;
  }

  /** The flat comparison adapters use a short vertical lowering guide; stacked coins fall directly. */
  get dischargeY() {
    const d = this.device;
    return d.die.y + (d.dropY - d.die.y) * this.discharge.progress;
  }
  diePosition(index: number) {
    const o = cargoOffset(this.device, index);
    return { x: this.device.die.x + o.x, y: this.dischargeY + o.y, z: this.device.die.z + o.z };
  }

  private feedTray(dt: number) {
    const core = this.core, d = this.scenario.tray, dev = this.device, stacked = this.pusher.mode === 'stacked';
    this.discharge.blocked = false;
    if (core.pressPhase !== 'ready') return;
    const count = Math.min(core.feedQueue.length, dev.cargoColumns * dev.cargoRows);
    if (!count) return;
    if (!core.canFeedBatch(count) || !this.inletClear(count)) { this.discharge.blocked = true; this.gateStats.blocked++; return; }
    if (!stacked) {
      if (this.discharge.progress === 0) {
        for (let time = 0; time <= PLANAR_LOWER_SECONDS * 2; time += dt) {
          if (pusherMotion(d, core.time + time).face > dev.feedZ - d.tokenRadius - 0.03) { this.discharge.blocked = true; this.gateStats.blocked++; return; }
        }
      }
      this.discharge.progress = Math.min(1, this.discharge.progress + dt / PLANAR_LOWER_SECONDS);
      if (this.discharge.progress < 1) return;
    }
    if (stacked) {
      this.discharge.progress = Math.min(1, this.discharge.progress + dt / 0.12);
      if (this.discharge.progress < 1) return;
    }
    const tokens = core.commitFeedBatch(count);
    for (let i = 0; i < tokens.length; i++) {
      const p = this.diePosition(i);
      const handover = { id: tokens[i].id, x: p.x, y: p.y, z: p.z - dev.trayZ0, vy: 0, tick: this.tick };
      this.pusher.spawn({ ...handover, radius: d.tokenRadius, halfHeight: d.tokenHalfHeight });
      this.handovers.push(handover); if (this.handovers.length > 96) this.handovers.shift();
    }
    this.gateStats.fed += tokens.length; this.batchStats.dumps++; this.batchStats.largestDump = Math.max(this.batchStats.largestDump, tokens.length);
    this.discharge.releaseAt = core.time; this.discharge.lastCount = tokens.length; this.discharge.progress = 0;
  }

  private inletClear(count: number): boolean {
    const d = this.scenario.tray, dev = this.device, stacked = this.pusher.mode === 'stacked';
    this.pusher.snapshot(this.feedSnapshot);
    const snap = this.feedSnapshot, radius = Math.hypot(d.tokenRadius, d.tokenHalfHeight);
    if (!stacked && this.pusherFace > dev.feedZ - d.tokenRadius - 0.015) return false;
    for (let i = 0; i < Math.min(count, dev.cargoColumns); i++) {
      const x = dev.die.x + cargoOffset(dev, i).x;
      for (let k = 0; k < snap.count; k++) {
        if (Math.hypot(snap.a[k] - x, snap.b[k] - dev.feedZ) > (stacked ? 2 * radius + 0.15 : 2 * d.tokenRadius + 0.015)) continue;
        if (!stacked || snap.c[k] + radius > dev.dropY - d.tokenHalfHeight - 0.25) return false;
      }
    }
    return true;
  }

  /** 표시·측정용 상태 전달. 호출 주기는 물리 결과에 영향을 주지 않는다. */
  sync(): number {
    const t0 = now();
    this.plinko.snapshot(this.plinkoSnap);
    this.pusher.snapshot(this.pusherSnap);
    return now() - t0;
  }

  setOffscreen(on: boolean) {
    this.core.setOffscreen(on);
    if (on) this.resetDischarge();
  }
  /** Hidden-tab settlement can pay/reorder output; restart the planar descent guide from the die. */
  settleElapsed(seconds: number) {
    const result = this.core.settleElapsed(seconds);
    if (result.settled > 0) this.resetDischarge();
    return result;
  }
  private resetDischarge() { this.discharge.progress = 0; this.discharge.blocked = false; }
  advanceOffscreen(dt: number) { this.core.advanceOffscreen(dt); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.plinko.dispose(); } finally { this.pusher.dispose(); }
  }
  get isDisposed() { return this.disposed; }
}
