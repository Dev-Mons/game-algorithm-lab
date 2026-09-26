import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { LabCommand } from '../scenarios/lab-scenarios';
import { distanceSquaredToRect } from './obstacle-collision';
import type { CrowdSimulation } from './simulation';
import { NumericRing } from './frame-trace';

export function distribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length), p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) ?? 0 };
}

/** Independent audit: no solver candidate list or neighbor cap is reused. */
export interface GeometryAudit {
  pairs:number; maxPenetration:number; maxProxyPenetration:number; maxSweptPenetration:number;
  maxPair:{a:number;b:number;ax:number;ay:number;bx:number;by:number}|null;
  tunnelingPairs:number; walls:number; checks:number; nonfinite:number;
}

export function auditGeometry(simulation: CrowdSimulation):GeometryAudit {
  const { state, previousState: previous, config, agentRadii: radii } = simulation;
  const retain = simulation.resolvedExperiment.options.destination === 'slots';
  const present = Uint8Array.from(state.active, (active, i) => retain || active === 1 || previous.active[i] === 1 ? 1 : 0);
  let nonfinite=0;
  for(let i=0;i<state.count;i++)if(present[i]) {
    if(![state.x[i],state.y[i],state.vx[i],state.vy[i],state.heading[i],state.intentX[i],state.intentY[i],state.stalledFor[i],previous.x[i],previous.y[i]].every(Number.isFinite)) {
      nonfinite++;present[i]=0;
    }
  }
  const index = new SpatialHash(config.width, config.height, Math.max(4, simulation.maxAgentRadius * 2), state.count);
  index.rebuild(previous.x, previous.y, present);
  let maxTravel = 0;
  for (let i = 0; i < state.count; i++) if(present[i])maxTravel = Math.max(maxTravel, Math.hypot(state.x[i]! - previous.x[i]!, state.y[i]! - previous.y[i]!));
  let pairs = 0, maxPenetration = 0, maxSweptPenetration = 0, tunnelingPairs = 0, walls = 0, checks = 0;
  let maxPair: {a:number;b:number;ax:number;ay:number;bx:number;by:number}|null=null;
  let maxProxyPenetration=0;
  for (let i = 0; i < state.count; i++) {
    if (!present[i]) continue;
    const ri = radii[i]!;
    for(const p of simulation.external?.proxies??[])maxProxyPenetration=Math.max(maxProxyPenetration,ri+p.radius-Math.hypot(state.x[i]!-p.toX,state.y[i]!-p.toY));
    const wallR = ri + config.wallMargin;
    if (state.x[i]! < wallR - 1e-6 || state.y[i]! < wallR - 1e-6
      || state.x[i]! > config.width - wallR + 1e-6 || state.y[i]! > config.height - wallR + 1e-6
      || simulation.scenario.obstacles.some(rect => distanceSquaredToRect(state.x[i]!, state.y[i]!, rect) < Math.max(0, wallR - 1e-6) ** 2)) walls++;
    index.forEachCandidate(previous.x[i]!, previous.y[i]!, ri + simulation.maxAgentRadius + 2 * maxTravel, j => {
      if (j <= i) return;
      checks++;
      const radius = ri + radii[j]!;
      const dx = previous.x[i]! - previous.x[j]!, dy = previous.y[i]! - previous.y[j]!;
      const endX = state.x[i]! - state.x[j]!, endY = state.y[i]! - state.y[j]!;
      const ux = endX - dx, uy = endY - dy;
      const t = Math.max(0, Math.min(1, -(dx * ux + dy * uy) / Math.max(1e-20, ux * ux + uy * uy)));
      const penetration = Math.max(0, radius - Math.hypot(endX, endY));
      const swept = Math.max(0, radius - Math.hypot(dx + t * ux, dy + t * uy));
      if (penetration > .01) pairs++;
      if(penetration>maxPenetration){maxPenetration=penetration;maxPair={a:i,b:j,ax:state.x[i]!,ay:state.y[i]!,bx:state.x[j]!,by:state.y[j]!};}
      maxSweptPenetration = Math.max(maxSweptPenetration, swept);
      if (swept > .01 && penetration <= .01 && Math.hypot(dx, dy) >= radius - .01 && t > 0 && t < 1) tunnelingPairs++;
    });
  }
  return { pairs, maxPenetration, maxPair, maxProxyPenetration, maxSweptPenetration, tunnelingPairs, walls, checks, nonfinite };
}

export class LabRecorder {
  private readonly times = new NumericRing();
  private readonly passTimes: Record<string, NumericRing> = {};
  private readonly frames = new NumericRing();
  private readonly renderTimes = new NumericRing();
  private measuredSteps = 0;
  private readonly ticks: Array<Record<string, number>> = [];
  private readonly gateSeen = new Set<string>();
  private readonly gateCounts: Record<string, number> = {};
  private readonly lateralSign: Int8Array;
  private observedFlips = 0;
  private auditMs = 0;
  private audits = 0;
  private maximumOverlapPairs = 0;
  private maximumPenetration = 0;
  private maximumSweptPenetration = 0;
  private maximumWallCount = 0;
  private maximumNonfinite = 0;
  private maximumProxyPenetration = 0;
  private tunnelingPairs = 0;
  private stalledMax = 0;
  private activeMinimum = Infinity;
  private activeMaximum = 0;
  private activeAtFirstSample: number | null = null;
  private firstMeasuredAt: number | null = null;
  private lastMeasuredAt = 0;
  private readonly initialScenario;

  constructor(private readonly simulation: CrowdSimulation, readonly qualityEvery = 0, readonly warmupSteps = 0, readonly initMs = 0) {
    this.lateralSign = new Int8Array(simulation.state.count);
    this.initialScenario = structuredClone(simulation.scenario);
  }

  get achievedHz(): number {
    return this.firstMeasuredAt === null ? 0 : this.measuredSteps * 1000 / Math.max(.001, this.lastMeasuredAt - this.firstMeasuredAt);
  }

  frame(intervalMs: number, renderMs: number): void {
    if (intervalMs > 0) this.frames.push(intervalMs);
    this.renderTimes.push(renderMs);
  }

  frameTimings(samples = 90) {
    return { frameIntervalMs: distribution(this.frames.slice(-samples)), renderMs: distribution(this.renderTimes.slice(-samples)) };
  }

  record(stepMs: number): void {
    const s = this.simulation;
    if (s.stepCount <= this.warmupSteps) return;
    this.firstMeasuredAt ??= performance.now() - stepMs;
    const stats = s.experimentStats;
    this.times.push(stepMs);
    this.measuredSteps++;
    for (const [key, value] of Object.entries(stats.passMs)) (this.passTimes[key] ??= new NumericRing()).push(value);
    this.activeAtFirstSample ??= s.metrics.activeCount;
    this.activeMinimum = Math.min(this.activeMinimum, s.metrics.activeCount);
    this.activeMaximum = Math.max(this.activeMaximum, s.metrics.activeCount);
    this.stalledMax = Math.max(this.stalledMax, s.metrics.stalledCount);
    this.maximumWallCount = Math.max(this.maximumWallCount, s.metrics.wallOverlapCount);
    for (let i = 0; i < s.state.count; i++) {
      if (s.state.active[i] !== 1) continue;
      const speed = Math.hypot(s.state.vx[i]!, s.state.vy[i]!);
      const lateral = s.state.vx[i]! * -s.state.intentY[i]! + s.state.vy[i]! * s.state.intentX[i]!;
      const sign = speed > s.config.maxSpeed * .1 && Math.abs(lateral) > s.config.maxSpeed * .05 ? Math.sign(lateral) : 0;
      if (sign && this.lateralSign[i] && sign !== this.lateralSign[i]) this.observedFlips++;
      if (sign) this.lateralSign[i] = sign;
    }
    for (const gate of s.scenario.routeGates ?? []) {
      const axis = gate.axis ?? 'x';
      const crossAxis = axis === 'x' ? 'y' : 'x';
      const dimension = axis === 'x' ? 'width' : 'height';
      const crossDimension = axis === 'x' ? 'height' : 'width';
      const line = gate.region[axis] + gate.region[dimension] / 2;
      for (let i = 0; i < s.state.count; i++) {
        const before = s.previousState[axis][i]!, after = s.state[axis][i]!;
        if (!((before < line && after >= line) || (before > line && after <= line))) continue;
        const t = (line - before) / (after - before);
        const cross = s.previousState[crossAxis][i]! + t * (s.state[crossAxis][i]! - s.previousState[crossAxis][i]!);
        if (cross < gate.region[crossAxis] || cross > gate.region[crossAxis] + gate.region[crossDimension]) continue;
        const direction = after > before ? '+' : '-';
        const key = `${gate.id}:${direction}:${i}`;
        if (this.gateSeen.has(key)) continue;
        this.gateSeen.add(key);
        const name = `${gate.id}:${direction}`;
        this.gateCounts[name] = (this.gateCounts[name] ?? 0) + 1;
      }
    }
    if (this.qualityEvery > 0 && s.stepCount % this.qualityEvery === 0) {
      const start = performance.now();
      const audit = auditGeometry(s);
      this.auditMs += performance.now() - start;
      this.audits++;
      this.maximumOverlapPairs = Math.max(this.maximumOverlapPairs, audit.pairs);
      this.maximumPenetration = Math.max(this.maximumPenetration, audit.maxPenetration);
      this.maximumSweptPenetration = Math.max(this.maximumSweptPenetration, audit.maxSweptPenetration);
      this.maximumWallCount = Math.max(this.maximumWallCount, audit.walls);
      this.maximumNonfinite = Math.max(this.maximumNonfinite, audit.nonfinite);
      this.maximumProxyPenetration = Math.max(this.maximumProxyPenetration, audit.maxProxyPenetration);
      this.tunnelingPairs += audit.tunnelingPairs;
    }
    if (s.stepCount % 10 === 0 || this.times.length === 1) this.ticks.push({ step: s.stepCount, requested: s.config.agentCount,
      spawned: s.state.count, active: s.metrics.activeCount, moving: stats.movingCount, waiting: stats.waitingCount,
      arrived: s.metrics.arrivedCount, contactActive: stats.contactActiveCount, stepMs });
    if(this.ticks.length>10000)this.ticks.shift();
    this.lastMeasuredAt = performance.now();
  }

  result(commands: readonly LabCommand[] = []) {
    const s = this.simulation;
    const seconds = this.measuredSteps * s.config.fixedDelta;
    const step = distribution(this.times.slice());
    const memory = (globalThis.performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    return {
      schema: 'crowd-lab-result-v1', createdAt: new Date().toISOString(), preset: s.resolvedExperiment.preset.id,
      options: { ...s.resolvedExperiment.options }, config: structuredClone(s.config), scenario: structuredClone(this.initialScenario), commands: structuredClone(commands),
      seed: s.config.seed, step: s.stepCount, hash: s.stateHash(), requested: s.config.agentCount, spawned: s.state.count,
      unspawned: s.unspawnedCount, active: s.metrics.activeCount, activeAtFirstSample: this.activeAtFirstSample,
      activeMinimum: Number.isFinite(this.activeMinimum) ? this.activeMinimum : s.metrics.activeCount, activeMaximum: this.activeMaximum,
      moving: s.experimentStats.movingCount, waiting: s.experimentStats.waitingCount, arrived: s.metrics.arrivedCount,
      contactActive: s.experimentStats.contactActiveCount, arrivalRate: s.metrics.arrivalRate,
      timing: { initMs: this.initMs, warmupSteps: this.warmupSteps, measuredSteps: this.measuredSteps, retainedTimingSamples: this.times.length, timingCapacity: this.times.capacity, stepMs: step,
        simulationCapacityHz: step.mean > 0 ? 1000 / step.mean : 0, achievedHzIncludingAudit: this.achievedHz,
        frameIntervalMs: distribution(this.frames.slice()), renderMs: distribution(this.renderTimes.slice()), passes: Object.fromEntries(Object.entries(this.passTimes).map(([key, values]) => [key, distribution(values.slice())])) },
      memory: memory ? { kind: 'browser-reported JS heap; includes app, not per solver', usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize } : null,
      quality: { auditEverySteps: this.qualityEvery, auditedSteps: this.audits, auditMs: this.auditMs,
        coverage: this.qualityEvery === 1 ? 'Every measured tick, all spatial candidates; swept test is the chord between published states (substep paths not exposed).' : this.qualityEvery > 1 ? 'Sampled ticks, all spatial candidates; intermediate ticks and curved substep paths not audited.' : 'Quality audit disabled; runtime overlap diagnostics are solver-dependent.',
        maximumOverlapPairs: this.audits ? this.maximumOverlapPairs : null, maximumPenetration: this.audits ? this.maximumPenetration : null,
        maximumNonfinite: this.audits ? this.maximumNonfinite : null, maximumProxyPenetration: this.audits ? this.maximumProxyPenetration : null,
        maximumSweptPenetration: this.audits ? this.maximumSweptPenetration : null, tunnelingPairs: this.audits ? this.tunnelingPairs : null,
        maximumWallCount: this.maximumWallCount, stalledMax: this.stalledMax, stalledLabel: 'Low-speed duration proxy; includes legitimate queues, not certified deadlock.',
        lateralSignFlips: this.observedFlips, lateralFlipsPerAgentSecond: this.observedFlips / Math.max(1, s.state.count * seconds),
        gateCrossings: { ...this.gateCounts }, gateAgentsPerSecond: Object.fromEntries(Object.entries(this.gateCounts).map(([key, count]) => [key, count / Math.max(1e-9, seconds)])) },
      stats: structuredClone(s.experimentStats), ticks: this.ticks.slice(),
    };
  }
}

export type LabResult = ReturnType<LabRecorder['result']>;
