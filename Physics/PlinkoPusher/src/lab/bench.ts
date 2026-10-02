import { PUSHER_BACKENDS } from '../physics/registry';
import { summarize, trayQuality, type Dist } from './metrics';
import type { Scenario } from './scenario';
import type { Simulation } from './simulation';

/**
 * 측정 기록기. 화면 밖 근사 모델은 측정 대상이 아니다(물리 step만 기록).
 * 같은 시나리오로 워밍업 후 같은 기간을 반복 측정한다. 측정 중 개수·품질을 바꾸지 않는다.
 */
export interface RepeatResult {
  initMs: { plinko: number; pusher: number };
  plinkoStep: Dist; pusherStep: Dist; coreStep: Dist; transfer: Dist;
  /** 엔진 step 밖 어댑터 시간(이벤트 정규화·평면 마찰 보정·이탈 검사). Custom은 null(전부 step에 포함). */
  plinkoAdapter: Dist | null; pusherAdapter: Dist | null;
  frameWork: Dist | null; frameInterval: Dist | null;
  items: { mean: number; max: number }; tokens: { mean: number; max: number };
  pusherActive: number; pusherSleeping: number | null; plinkoSleeping: number | null;
  quality: { maxOverlapPct: number; overlappedPairsMean: number; highTokensMax: number; lostTokens: number; lostItems: number; unstuck: number; speedClamps: number; duplicateEvents: number };
  economy: { completed: number; main: number; bonus: number; tokensPaid: number; seedPaid: number; feedBlocked: number };
  droppedMs: number;
  heapDeltaMB: number | null;
}

export interface BenchResult {
  id: string; at: string; label: string;
  backends: Scenario['backends']; condition: 'planar' | 'stacked';
  scenario: { preset: string; seed: number; fixedDt: number; quality: string; warmupSec: number; measureSec: number; repeats: number; initialTokens: number; trayMaxTokens: number; plinkoMaxActive: number };
  settings: { plinko: Record<string, string | number | boolean>; pusher: Record<string, string | number | boolean> };
  env: string;
  repeats: RepeatResult[];
}

const heap = () => (globalThis.performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

export class BenchRecorder {
  private plinko: number[] = []; private pusher: number[] = []; private core: number[] = []; private transfer: number[] = [];
  private frameWork: number[] = []; private frameInterval: number[] = [];
  private plinkoAdapter: number[] = []; private pusherAdapter: number[] = [];
  private itemSum = 0; private itemMax = 0; private tokenSum = 0; private tokenMax = 0; private ticks = 0;
  private activeSum = 0; private sleepSum = 0; private plinkoSleepSum = 0; private samples = 0; private sleepUnknown = false; private plinkoSleepUnknown = false;
  private maxOverlap = 0; private overlapSum = 0; private qualitySamples = 0; private highMax = 0;
  private readonly base: { completed: number; main: number; bonus: number; paid: number; seedPaid: number; lostTokens: number; lostItems: number; unstuck: number; clamps: number; dup: number; blocked: number };
  private readonly heap0 = heap();
  droppedMs = 0;

  constructor(private readonly sim: Simulation) {
    const c = sim.core, pc = sim.plinko.stats().corrections;
    this.base = {
      completed: c.stats.completed, main: c.ledger.main, bonus: c.ledger.bonusProduced + c.ledger.bonusSeed, paid: c.stats.tokensPaid, seedPaid: c.stats.seedPaid,
      lostTokens: c.stats.lostTokens, lostItems: c.stats.lostItems, unstuck: pc.unstuck ?? 0, clamps: pc.speedClamp ?? 0,
      dup: c.stats.duplicateArrivals + c.stats.duplicateExits, blocked: sim.gateStats.blocked,
    };
  }

  afterTick() {
    const t = this.sim.timing;
    this.plinko.push(t.plinkoMs); this.pusher.push(t.pusherMs); this.core.push(t.coreMs);
    if (this.sim.plinko.adapterMs !== undefined) this.plinkoAdapter.push(this.sim.plinko.adapterMs);
    if (this.sim.pusher.adapterMs !== undefined) this.pusherAdapter.push(this.sim.pusher.adapterMs);
    const items = this.sim.core.items.size, tokens = this.sim.core.tray.size;
    this.itemSum += items; this.tokenSum += tokens; this.ticks++;
    if (items > this.itemMax) this.itemMax = items;
    if (tokens > this.tokenMax) this.tokenMax = tokens;
    if (this.ticks % 30 === 0) this.sampleBackends();
  }
  afterSync(ms: number) { this.transfer.push(ms); }
  afterFrame(workMs: number, intervalMs: number) { this.frameWork.push(workMs); this.frameInterval.push(intervalMs); }

  private sampleBackends() {
    const ps = this.sim.pusher.stats(), ls = this.sim.plinko.stats();
    this.activeSum += ps.active; this.samples++;
    if (ps.sleeping === null) this.sleepUnknown = true; else this.sleepSum += ps.sleeping;
    if (ls.sleeping === null) this.plinkoSleepUnknown = true; else this.plinkoSleepSum += ls.sleeping;
    const q = trayQuality(this.sim.pusherSnap, this.sim.scenario.tray, this.sim.pusher.mode === 'planar');
    this.maxOverlap = Math.max(this.maxOverlap, q.maxOverlap); this.overlapSum += q.overlappedPairs; this.qualitySamples++;
    this.highMax = Math.max(this.highMax, q.highTokens);
  }

  finish(): RepeatResult {
    const c = this.sim.core, pc = this.sim.plinko.stats().corrections, b = this.base, h = heap();
    return {
      initMs: { ...this.sim.initMs },
      plinkoStep: summarize(this.plinko), pusherStep: summarize(this.pusher), coreStep: summarize(this.core), transfer: summarize(this.transfer),
      plinkoAdapter: this.plinkoAdapter.length ? summarize(this.plinkoAdapter) : null, pusherAdapter: this.pusherAdapter.length ? summarize(this.pusherAdapter) : null,
      frameWork: this.frameWork.length ? summarize(this.frameWork) : null, frameInterval: this.frameInterval.length ? summarize(this.frameInterval) : null,
      items: { mean: this.itemSum / Math.max(1, this.ticks), max: this.itemMax }, tokens: { mean: this.tokenSum / Math.max(1, this.ticks), max: this.tokenMax },
      pusherActive: this.activeSum / Math.max(1, this.samples),
      pusherSleeping: this.sleepUnknown ? null : this.sleepSum / Math.max(1, this.samples),
      plinkoSleeping: this.plinkoSleepUnknown ? null : this.plinkoSleepSum / Math.max(1, this.samples),
      quality: {
        maxOverlapPct: Math.round(this.maxOverlap * 1000) / 10, overlappedPairsMean: this.overlapSum / Math.max(1, this.qualitySamples), highTokensMax: this.highMax,
        lostTokens: c.stats.lostTokens - b.lostTokens, lostItems: c.stats.lostItems - b.lostItems,
        unstuck: (pc.unstuck ?? 0) - b.unstuck, speedClamps: (pc.speedClamp ?? 0) - b.clamps,
        duplicateEvents: c.stats.duplicateArrivals + c.stats.duplicateExits - b.dup,
      },
      economy: {
        completed: c.stats.completed - b.completed, main: c.ledger.main - b.main, bonus: c.ledger.bonusProduced + c.ledger.bonusSeed - b.bonus,
        tokensPaid: c.stats.tokensPaid - b.paid, seedPaid: c.stats.seedPaid - b.seedPaid, feedBlocked: this.sim.gateStats.blocked - b.blocked,
      },
      droppedMs: this.droppedMs,
      heapDeltaMB: h !== null && this.heap0 !== null ? (h - this.heap0) / 1048576 : null,
    };
  }
}

export function benchMeta(sim: Simulation, env: string, label: string): Omit<BenchResult, 'repeats'> {
  const s = sim.scenario;
  return {
    id: `${s.backends.plinko}+${s.backends.pusher}@${s.preset}#${Date.now().toString(36)}`, at: new Date().toISOString(), label,
    backends: { ...s.backends }, condition: PUSHER_BACKENDS[s.backends.pusher].condition,
    scenario: { preset: s.preset, seed: s.seed, fixedDt: s.fixedDt, quality: s.quality, ...s.measure, initialTokens: s.initialTokens, trayMaxTokens: s.flow.trayMaxTokens, plinkoMaxActive: s.flow.plinkoMaxActive },
    settings: { plinko: sim.plinko.stats().settings, pusher: sim.pusher.stats().settings },
    env,
  };
}

/** 반복 결과의 중앙값 요약(표시용). */
export function overview(r: BenchResult) {
  const med = (f: (x: RepeatResult) => number | null | undefined) => {
    const v = r.repeats.map(f).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  const spread = (f: (x: RepeatResult) => number) => { const v = r.repeats.map(f); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  return {
    plinkoMedian: med(x => x.plinkoStep.median), plinkoP95: med(x => x.plinkoStep.p95),
    pusherAdapterMedian: med(x => x.pusherAdapter?.median), plinkoAdapterMedian: med(x => x.plinkoAdapter?.median),
    pusherMedian: med(x => x.pusherStep.median), pusherP95: med(x => x.pusherStep.p95), pusherMedianSpread: spread(x => x.pusherStep.median),
    transferMedian: med(x => x.transfer.median), transferP95: med(x => x.transfer.p95),
    frameMedian: med(x => x.frameWork?.median), frameP95: med(x => x.frameWork?.p95), intervalMedian: med(x => x.frameInterval?.median),
    items: med(x => x.items.mean), itemsMax: med(x => x.items.max), tokens: med(x => x.tokens.mean), tokensMax: med(x => x.tokens.max),
    active: med(x => x.pusherActive), sleeping: med(x => x.pusherSleeping),
    initPlinko: med(x => x.initMs.plinko), initPusher: med(x => x.initMs.pusher), heap: med(x => x.heapDeltaMB),
    maxOverlapPct: med(x => x.quality.maxOverlapPct), overlappedPairs: med(x => x.quality.overlappedPairsMean), high: med(x => x.quality.highTokensMax),
    lostTokens: med(x => x.quality.lostTokens), unstuck: med(x => x.quality.unstuck),
    completed: med(x => x.economy.completed), bonus: med(x => x.economy.bonus), tokensPaid: med(x => x.economy.tokensPaid), droppedMs: med(x => x.droppedMs),
  };
}
