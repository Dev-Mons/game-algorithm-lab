import { benchMeta, BenchRecorder, type BenchResult } from './bench';
import { cloneScenario, type Scenario } from './scenario';
import type { Simulation } from './simulation';

/** 반복마다 같은 입력을 복원하는 측정 세션. 브라우저·재시작 대기열과 독립적이다. */
export class BenchSession {
  phase: 'preparing' | 'warmup' | 'measure' = 'preparing';
  repeat = 0;
  ticks = 0;
  recorder: BenchRecorder | null = null;
  private result: BenchResult | null = null;
  private readonly input: Scenario;
  readonly target: { warm: number; span: number };

  constructor(scenario: Scenario, readonly savedSpeed: number) {
    this.input = cloneScenario(scenario);
    this.target = {
      warm: Math.max(0, Math.round(scenario.measure.warmupSec / scenario.fixedDt)),
      span: Math.max(1, Math.round(scenario.measure.measureSec / scenario.fixedDt)),
    };
  }

  get scenario() { return cloneScenario(this.input); }
  get repeats() { return this.input.measure.repeats; }

  attach(sim: Simulation, env: string) {
    this.result ??= { ...benchMeta(sim, env, `${sim.plinko.id} + ${sim.pusher.id}`), repeats: [] };
    this.phase = 'warmup'; this.ticks = 0; this.recorder = null;
  }

  beginMeasurement(sim: Simulation) {
    this.phase = 'measure'; this.ticks = 0; this.recorder = new BenchRecorder(sim);
  }

  finishRepeat(sim: Simulation): BenchResult | null {
    const result = this.result!;
    result.repeats.push(this.recorder!.finish());
    result.settings = { plinko: sim.plinko.stats().settings, pusher: sim.pusher.stats().settings };
    this.repeat++;
    this.phase = 'preparing'; this.ticks = 0; this.recorder = null;
    return this.repeat >= this.repeats ? result : null;
  }
}
