import { boardTransformFor, frameFromTransform, projectedGravity, PLACEMENTS, type BoardFrame, type PlacementId, type Transform } from '../core/frame';
import { GameCore, type ReleaseOrder } from '../core/game-core';
import { buildBoardLayout, type BoardLayout } from '../core/layout';
import { vec3 } from '../core/math';
import { Rng } from '../core/rng';
import { BodySnapshot, type PlinkoBackend, type PlinkoEvent, type PusherBackend, type PusherEvent } from '../physics/contracts';
import { createPlinko, createPusher } from '../physics/registry';
import { pusherMotion, trayGeometry } from '../physics/tray-geometry';
import { deviceLayout, type DeviceLayout } from './device-layout';
import type { Scenario } from './scenario';

const now = () => globalThis.performance.now();

export interface StepTiming { plinkoMs: number; pusherMs: number; coreMs: number }
export interface ExitVisual { id: number; x: number; y: number; z: number; value: number; origin: 'produced' | 'seed' }

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
  readonly timing: StepTiming = { plinkoMs: 0, pusherMs: 0, coreMs: 0 };
  initMs = { plinko: 0, pusher: 0 };
  pusherFace = 0;
  readonly exitVisuals: ExitVisual[] = [];
  readonly gateStats = { blocked: 0, fed: 0 };
  private releases: ReleaseOrder[] = [];
  private plinkoEvents: PlinkoEvent[] = [];
  private pusherEvents: PusherEvent[] = [];
  private readonly feedRng: Rng;
  private recentSpawns: Array<{ x: number; z: number; tick: number }> = [];
  private disposed = false;

  private constructor(readonly scenario: Scenario, readonly plinko: PlinkoBackend, readonly pusher: PusherBackend) {
    this.layout = buildBoardLayout(scenario.board, scenario.pegs);
    this.core = new GameCore(scenario.economy, scenario.flow, this.layout, scenario.seed);
    this.device = deviceLayout(scenario.board, scenario.tray);
    this.feedRng = new Rng(scenario.seed * 7919 + 17);
    this.setPlacement(scenario.placement);
  }

  static async create(scenario: Scenario): Promise<Simulation> {
    const sim = new Simulation(scenario, createPlinko(scenario.backends.plinko), createPusher(scenario.backends.pusher));
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
    const d = this.scenario.tray, r = d.tokenRadius, stacked = false;
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
    void stacked;
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
    for (const r of this.releases) this.plinko.spawn({ ...r, radius: s.board.itemRadius });
    let coreMs = now() - t0;

    t0 = now();
    this.plinko.step(dt);
    this.timing.plinkoMs = now() - t0;

    t0 = now();
    this.plinkoEvents.length = 0;
    this.plinko.drainEvents(this.plinkoEvents);
    for (const e of this.plinkoEvents) {
      if (e.type === 'peg') core.onPegContact(e.id, e.peg);
      else if (e.type === 'arrive') core.onArrive(e.id, e.u);
      else core.onItemLost(e.id);
    }
    const motion = pusherMotion(s.tray, (this.tick + 1) * dt);
    this.pusherFace = motion.face;
    this.pusher.setPusher(motion.face, motion.velocity);
    this.feedTray(motion.face);
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
        if (core.onTokenExit(e.id) !== null && token && this.exitVisuals.length < 256) this.exitVisuals.push({ id: e.id, x: e.x, y: e.y, z: e.z, value: token.value, origin: token.origin });
      } else core.onTokenLost(e.id);
    }
    core.stepByproduct(dt);
    this.timing.coreMs = coreMs + now() - t0;
    this.tick++;
  }

  /** 트레이 공급 게이트: 투입 지점이 비어 있어야 토큰을 놓는다. 막히면 대기열이 늘어난다(적체). */
  private feedTray(face: number) {
    const core = this.core, d = this.scenario.tray, r = d.tokenRadius, stacked = this.pusher.mode === 'stacked';
    if (!core.canFeed()) return;
    if (stacked) { this.dropOnHeap(face); return; }
    this.recentSpawns = this.recentSpawns.filter(p => this.tick - p.tick < 20);
    const lanes = Math.max(3, Math.floor((d.width - 1) / (r * 2.2)));
    const z = face + r + 0.06, clear2 = (r * 1.9) ** 2;
    for (let attempt = 0; attempt < 3; attempt++) {
      const lane = this.feedRng.int(lanes);
      const x = -d.width / 2 + 0.5 + r + (lane + 0.5) * ((d.width - 1 - 2 * r) / lanes);
      if (this.isOccupied(x, z, clear2)) continue;
      const token = core.commitFeed()!;
      this.pusher.spawn({ id: token.id, x, y: stacked ? d.tokenHalfHeight + 0.35 : d.tokenHalfHeight, z, radius: r, halfHeight: d.tokenHalfHeight });
      this.recentSpawns.push({ x, z, tick: this.tick });
      this.gateStats.fed++;
      return;
    }
    this.gateStats.blocked++;
  }

  /**
   * 적층 조건: 판 윗면 선반 뒤쪽 절반부터 판 앞 1.2까지의 더미 위로 떨어뜨린다(점유 검사 없음).
   * 선반에 떨어진 토큰은 판이 물러날 때 립에 긁혀 판 앞 빈자리로 떨어진다(밀린 자리를 채우는 실제 공급 경로).
   */
  private dropOnHeap(face: number) {
    const core = this.core, d = this.scenario.tray, r = d.tokenRadius, h = d.tokenHalfHeight, snap = this.pusherSnap;
    this.recentSpawns = this.recentSpawns.filter(p => this.tick - p.tick < 20);
    const x = this.feedRng.range(-d.width / 2 + r + 0.3, d.width / 2 - r - 0.3), z = this.feedRng.range(Math.max(d.faceMin + r, face - d.pusherDepth * 0.5), face + 1.2);
    let top = trayGeometry(d).plateHeight;
    for (let k = 0; k < snap.count; k++) { const dx = snap.a[k] - x, dz = snap.b[k] - z; if (dx * dx + dz * dz < 4 * r * r && snap.c[k] + h > top) top = snap.c[k] + h; }
    for (const p of this.recentSpawns) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < 4 * r * r) top += 2 * h; }
    const token = core.commitFeed()!;
    this.pusher.spawn({ id: token.id, x, y: top + h + 0.35, z, radius: r, halfHeight: h });
    this.recentSpawns.push({ x, z, tick: this.tick });
    this.gateStats.fed++;
  }

  private isOccupied(x: number, z: number, clear2: number) {
    const snap = this.pusherSnap;
    for (let k = 0; k < snap.count; k++) { const dx = snap.a[k] - x, dz = snap.b[k] - z; if (dx * dx + dz * dz < clear2) return true; }
    for (const p of this.recentSpawns) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < clear2) return true; }
    return false;
  }

  /** 렌더링·게이트용 상태 전달. 걸린 시간(ms)을 돌려준다. */
  sync(): number {
    const t0 = now();
    this.plinko.snapshot(this.plinkoSnap);
    this.pusher.snapshot(this.pusherSnap);
    return now() - t0;
  }

  setOffscreen(on: boolean) { this.core.setOffscreen(on); }
  advanceOffscreen(dt: number) { this.core.advanceOffscreen(dt); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.plinko.dispose(); this.pusher.dispose();
  }
  get isDisposed() { return this.disposed; }
}
