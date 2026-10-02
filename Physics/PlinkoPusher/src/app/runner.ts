import { applyPegSetup } from '../core/layout';
import { MAX_PEG_LEVEL, type PegKind } from '../core/config';
import type { PlacementId } from '../core/frame';
import type { BenchResult } from '../lab/bench';
import { BenchSession } from '../lab/bench-session';
import { Ring } from '../lab/metrics';
import { cloneScenario, createScenario, type PresetId, type Scenario } from '../lab/scenario';
import { Simulation } from '../lab/simulation';
import type { CameraPreset, DeviceView } from '../view/device-view';

/**
 * ExperimentRunner(브라우저): 고정 스텝 루프, 백엔드 교체 재시작, 화면 밖 처리, 숨김 탭 정산, 순차 측정.
 * 누락 시간 정책: 한 프레임에 최대 MAX_CATCH_UP 스텝만 따라잡고 남은 시간은 버린다(droppedMs에 기록).
 * 버린 시간은 시뮬레이션이 실시간보다 느려진 것으로 처리하며, 큰 dt를 물리에 넘기지 않는다.
 */
export const MAX_CATCH_UP = 6;
type RunnerView = Pick<DeviceView, 'build' | 'clear' | 'update' | 'setCamera' | 'updatePlacement' | 'refreshPegColors'>;

export class Runner {
  sim: Simulation | null = null;
  scenario: Scenario;
  paused = false;
  speed = 1;
  offscreen = false;
  droppedMs = 0;
  readonly frameWork = new Ring(240); readonly frameInterval = new Ring(240);
  readonly plinkoMs = new Ring(240); readonly pusherMs = new Ring(240); readonly transferMs = new Ring(240);
  bench: BenchSession | null = null;
  readonly results: BenchResult[] = [];
  onBenchDone: (r: BenchResult) => void = () => {};
  onToast: (msg: string) => void = () => {};
  onRebuilt: () => void = () => {};
  demo = { on: false, t: 0, cam: 0 };
  private acc = 0;
  private last = 0;
  private hiddenAt: number | null = null;
  private restartChain: Promise<void> = Promise.resolve();
  private pendingRestarts = 0;
  private frameId = 0;
  private disposed = false;
  private readonly visibilityHandler = () => this.onVisibility();

  constructor(private readonly view: RunnerView) {
    this.scenario = createScenario('basic');
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /**
   * 현재 실험을 종료하고 같은 시나리오(같은 시드·초기 상태)로 다시 만든다. 이전 월드는 해제한다.
   * 요청이 겹쳐도 순서대로 하나씩 실행해 두 월드가 동시에 만들어지지 않게 한다.
   */
  restart(next?: Scenario): Promise<void> {
    this.cancelBench('실험 재시작');
    return this.rebuild(next ?? this.scenario);
  }

  /** 측정 반복만 세션을 유지하며 재생성한다. 입력은 요청 시점에 복사한다. */
  private rebuild(next: Scenario): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const input = cloneScenario(next);
    const run = async () => {
      if (this.disposed) return;
      this.scenario = cloneScenario(input);
      this.sim?.dispose();
      this.sim = null;
      this.view.clear();
      const sim = await Simulation.create(cloneScenario(this.scenario));
      if (this.disposed) { sim.dispose(); return; }
      if (this.offscreen) sim.setOffscreen(true);
      try {
        sim.sync();
        this.view.build(sim);
      } catch (error) {
        sim.dispose(); this.view.clear();
        throw error;
      }
      this.sim = sim;
      this.acc = 0; this.droppedMs = 0;
      for (const r of [this.frameWork, this.frameInterval, this.plinkoMs, this.pusherMs, this.transferMs]) r.clear();
      this.onRebuilt();
    };
    this.pendingRestarts++;
    const job = this.restartChain.then(run).finally(() => { this.pendingRestarts--; });
    this.restartChain = job.catch(err => { console.error(err); this.onToast(`재시작 실패: ${String(err)}`); });
    return job;
  }
  private get restarting() { return this.pendingRestarts > 0; }
  /** 대기 중이거나 진행 중인 재시작이 있으면 true. */
  get busy() { return this.restarting; }

  loadPreset(id: PresetId, seed = this.scenario.seed) {
    const s = createScenario(id, seed);
    s.backends = { ...this.scenario.backends };
    s.placement = this.scenario.placement;
    return this.restart(s);
  }

  /** 실행 중 바꿀 수 있는 설정(경제·공급·푸셔 운동·페그). 시뮬레이션 사본과 시나리오를 같이 갱신한다. */
  configure(mutate: (s: Scenario) => void, restart = false) {
    this.cancelBench('설정 변경');
    const before = { ...this.scenario.pegs };
    mutate(this.scenario);
    const pegsChanged = before.level !== this.scenario.pegs.level || before.pattern !== this.scenario.pegs.pattern;
    if (pegsChanged) this.scenario.pegOverrides = [];
    if (restart || this.busy || !this.sim) return this.restart();
    mutate(this.sim.scenario);
    // 페그 패턴·레벨이 바뀐 경우에만 다시 적용한다(개별 페그 편집 보존).
    if (pegsChanged) {
      this.sim.scenario.pegOverrides = [];
      applyPegSetup(this.sim.layout, this.sim.scenario.pegs);
      this.view.refreshPegColors();
    }
  }

  editPeg(index: number, kind: PegKind, level: number) {
    if (!this.sim || this.busy || !this.sim.layout.pegs[index]) return;
    const peg = { index, kind, level: Math.max(1, Math.min(MAX_PEG_LEVEL, Math.round(level))) };
    this.configure(s => { s.pegOverrides = [...s.pegOverrides.filter(p => p.index !== index), peg].sort((a, b) => a.index - b.index); });
    this.sim.core.setPeg(index, kind, peg.level);
    this.view.refreshPegColors();
  }

  setPlacement(id: PlacementId) {
    if (this.scenario.plinko.gravityMode === 'world-projected' || this.busy) return this.configure(s => { s.placement = id; }, true);
    this.configure(s => { s.placement = id; });
    this.sim?.setPlacement(id);
    this.view.updatePlacement();
  }

  addRaw(count: number) { this.cancelBench('수동 투입'); this.sim?.addRaw(count); }
  setPaused(paused: boolean) { this.cancelBench('일시정지 변경'); this.paused = paused; }
  setSpeed(speed: number) { this.cancelBench('배속 변경'); this.speed = speed; }

  start() {
    if (this.disposed || this.frameId) return;
    this.last = performance.now();
    const loop = (now: number) => { this.frameId = requestAnimationFrame(loop); this.frame(now); };
    this.frameId = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.frameId); this.frameId = 0; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.cancelBench('실험 종료');
    this.sim?.dispose(); this.sim = null;
    this.view.clear();
  }

  private frame(now: number) {
    const interval = now - this.last;
    this.last = now;
    const sim = this.sim;
    // 숨김 중에는 진행하지 않는다. 경과 시간은 복귀 시 한 번만 정산한다(이중 처리 방지).
    if (!sim || this.restarting || document.hidden || this.bench?.phase === 'preparing') return;
    const t0 = performance.now();
    const wallDt = Math.min(interval / 1000, 0.25);
    if (this.bench?.phase === 'warmup') this.fastForward(sim);
    else if (this.offscreen) {
      if (!this.paused) {
        let left = wallDt * this.speed;
        while (left > 1e-9) { const d = Math.min(0.5, left); sim.advanceOffscreen(d); left -= d; }
      }
    } else if (!this.paused) {
      this.acc += wallDt * this.speed;
      const dt = sim.scenario.fixedDt;
      let steps = 0;
      while (this.acc >= dt && steps < MAX_CATCH_UP && (!this.bench || this.bench.ticks < this.bench.target.span)) {
        sim.step(); steps++; this.acc -= dt;
        this.plinkoMs.push(sim.timing.plinkoMs); this.pusherMs.push(sim.timing.pusherMs);
        if (this.bench?.recorder) { this.bench.recorder.afterTick(); this.bench.ticks++; }
      }
      // 측정 목표에 도달해서 멈춘 프레임의 나머지는 따라잡기 실패가 아니다.
      const measurementEnded = this.bench?.phase === 'measure' && this.bench.ticks >= this.bench.target.span;
      if (!measurementEnded && steps === MAX_CATCH_UP && this.acc >= dt) {
        const dropped = this.acc - (this.acc % dt);
        this.droppedMs += dropped * 1000;
        if (this.bench?.recorder) this.bench.recorder.droppedMs += dropped * 1000;
        this.acc %= dt;
      }
      if (steps > 0) { const ms = sim.sync(); this.transferMs.push(ms); this.bench?.recorder?.afterSync(ms); }
    }
    this.runDemo(wallDt);
    this.view.update(wallDt, this.offscreen);
    const work = performance.now() - t0;
    this.frameWork.push(work); this.frameInterval.push(interval);
    if (this.bench?.recorder) this.bench.recorder.afterFrame(work, interval);
    if (this.bench) this.advanceBench();
  }

  // ---------- 측정 ----------
  /** 같은 시나리오로 반복 측정한다. 각 반복은 새 월드에서 시작하며, 워밍업은 렌더 없이 빠르게 진행한다. */
  async runBench() {
    if (this.disposed || this.bench) return;
    if (this.offscreen) { this.onToast('화면 밖 처리 중에는 물리 측정을 하지 않습니다.'); return; }
    const session = new BenchSession(this.scenario, this.speed);
    this.bench = session; // 비동기 초기화 중 중복 시작·설정 변경도 같은 세션 정책을 따른다.
    await this.prepareRepeat(session);
    if (this.bench === session) { this.speed = 1; this.paused = false; }
  }

  private async prepareRepeat(session: BenchSession) {
    try {
      await this.rebuild(session.scenario);
      if (this.bench !== session) return;
      const env = `${navigator.userAgent.replace(/^Mozilla\/5.0 /, '')} · DPR ${window.devicePixelRatio} · ${innerWidth}×${innerHeight} · 품질 ${this.sim!.scenario.quality}`;
      session.attach(this.sim!, env);
    } catch {
      if (this.bench === session) this.cancelBench('초기화 실패');
    }
  }

  cancelBench(reason: string) {
    if (!this.bench) return;
    this.speed = this.bench.savedSpeed; this.bench = null;
    this.onToast(`측정 취소: ${reason}`);
  }

  private fastForward(sim: Simulation) {
    const b = this.bench!, budget = performance.now() + 10;
    while (b.ticks < b.target.warm && performance.now() < budget) { sim.step(); sim.sync(); b.ticks++; }
  }

  private advanceBench() {
    const b = this.bench!, sim = this.sim!;
    if (b.phase === 'warmup' && b.ticks >= b.target.warm) {
      b.beginMeasurement(sim); this.acc = 0;
    } else if (b.phase === 'measure' && b.ticks >= b.target.span) {
      const result = b.finishRepeat(sim);
      if (!result) {
        void this.prepareRepeat(b);
      } else {
        this.speed = b.savedSpeed; this.bench = null;
        this.results.push(result);
        this.onBenchDone(result);
      }
    }
  }

  benchProgress() {
    const b = this.bench;
    if (!b) return null;
    const total = b.phase === 'warmup' ? b.target.warm : b.target.span;
    return { phase: b.phase, repeat: b.repeat + 1, repeats: b.repeats, pct: Math.min(100, Math.round(b.ticks / Math.max(1, total) * 100)) };
  }

  // ---------- 화면 밖 / 숨김 탭 ----------
  setOffscreen(on: boolean) {
    if (on && this.bench) this.cancelBench('화면 밖 처리로 전환');
    this.offscreen = on;
    this.sim?.setOffscreen(on);
    this.acc = 0;
  }

  private onVisibility() {
    if (document.hidden) { this.hiddenAt = performance.now(); return; }
    if (this.hiddenAt === null) return;
    const elapsed = (performance.now() - this.hiddenAt) / 1000;
    this.hiddenAt = null; this.acc = 0; this.last = performance.now();
    if (this.bench) { this.cancelBench('탭이 숨겨져 측정 조건이 깨졌습니다.'); return; }
    if (!this.sim || this.paused || elapsed < 0.5) return;
    const r = this.sim.settleElapsed(elapsed * this.speed);
    this.onToast(`숨김 ${elapsed.toFixed(1)}초 → 화면 밖 근사로 ${r.settled.toFixed(1)}초 정산(${r.chunks}회)${r.clipped > 0 ? `, ${r.clipped.toFixed(0)}초는 상한 초과로 제외` : ''}`);
  }

  // ---------- 자동 데모 ----------
  private runDemo(dt: number) {
    if (!this.demo.on || !this.sim || this.bench) return;
    this.demo.t += dt;
    if (this.demo.t > 7) {
      this.demo.t = 0;
      const order: CameraPreset[] = ['all', 'plinko', 'all', 'pusher'];
      this.demo.cam = (this.demo.cam + 1) % order.length;
      this.view.setCamera(order[this.demo.cam]);
      if (!this.offscreen) this.sim.addRaw(6);
    }
  }
}
