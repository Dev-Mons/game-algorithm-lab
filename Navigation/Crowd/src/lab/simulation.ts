import { CrowdKernel, type CrowdPass } from '../core/crowd-kernel';
import { DEFAULT_CROWD_CONFIG } from '../core/config';
import { largeAgentPercent, largeAgentScale } from '../core/agent-size';
import { createSpawnLayout } from '../core/spawn-layout';
import { angleDelta, clamp } from '../core/math';
import type { AgentBuffer } from '../core/agent-state';
import type { ScenarioDefinition, SimulationConfig, Vec2 } from '../core/types';
import type { FlowField } from '../algorithms/flow-field/flow-field';
import { resolveExperiment, type ResolvedExperiment } from '../algorithms/lab/registry';
import type { LabPipeline, AgentGoalCommand } from '../algorithms/lab/pipeline';
import { emptyExperimentStats, type ExperimentStats } from '../algorithms/lab/contracts';
import type { ExternalInput } from '../core/external-influences';

const EPSILON = 1e-9;

/** Lab adapter: seeded placement, preset lifecycle and wall-clock profiling. */
export class CrowdSimulation extends CrowdKernel {
  declare config: SimulationConfig;
  scenario: ScenarioDefinition;
  readonly resolvedExperiment: ResolvedExperiment;
  private pipeline: LabPipeline | null = null;
  private legacyExperimentStats = emptyExperimentStats();
  private readonly individualGoals = new Map<number, Vec2>();
  private timedPass: CrowdPass | null = null;
  private passStarted = 0;
  unspawnedCount = 0;

  constructor(config: SimulationConfig, scenario: ScenarioDefinition) {
    super(config, config.agentCount);
    this.scenario = scenario;
    this.resolvedExperiment = resolveExperiment(config);
    this.reset();
  }

  get experimentStats(): ExperimentStats { return this.pipeline?.stats ?? this.legacyExperimentStats; }
  protected override get usesCustomNavigation(): boolean { return !!this.resolvedExperiment.preset.createPipeline; }
  protected override get retainArrivals(): boolean { return this.usesCustomNavigation && this.resolvedExperiment.options.destination === 'slots'; }
  protected override now(): number { return performance.now(); }
  protected override onPass(pass: CrowdPass | null): void {
    const now = this.now();
    if (this.timedPass) this.legacyExperimentStats.passMs[this.timedPass] = now - this.passStarted;
    this.timedPass = pass;
    this.passStarted = now;
  }

  reset(): void {
    if (this.config.agentCount > this.agentFlow.length) throw new RangeError('Increasing agentCount requires constructing a new CrowdSimulation.');
    this.pipeline = null;
    this.individualGoals.clear();
    this.legacyExperimentStats = emptyExperimentStats();
    this.config.largeAgentPercent = largeAgentPercent(this.config.largeAgentPercent);
    this.config.largeAgentScale = largeAgentScale(this.config.largeAgentScale);
    const flows = this.scenario.flows?.length ? this.scenario.flows
      : [{ id: this.scenario.id, spawn: this.scenario.spawn, goal: this.scenario.goal }];
    const positions = createSpawnLayout({ count: this.config.agentCount, seed: this.config.seed,
      agentRadius: this.config.agentRadius, largeAgentPercent: this.config.largeAgentPercent,
      largeAgentScale: this.config.largeAgentScale, agentGap: this.config.agentGap,
      wallMargin: this.config.wallMargin, worldWidth: this.config.width, worldHeight: this.config.height,
      obstacles: this.scenario.obstacles, flows });
    this.unspawnedCount = Math.max(0, this.config.agentCount - positions.length);
    this.initialize({ flows, obstacles: this.scenario.obstacles,
      maxAgentRadius: Math.round(this.config.agentCount * this.config.largeAgentPercent / 100) > 0
        ? this.config.agentRadius * this.config.largeAgentScale : this.config.agentRadius,
      agents: positions.map((position, index) => ({ id: 'agent-' + index, ...position })) });
  }

  changeScenario(scenario: ScenarioDefinition): void { this.scenario = scenario; this.reset(); }

  protected override onInitialized(): void {
    this.legacyExperimentStats.activeCount = this.state.count;
    this.legacyExperimentStats.waitingCount = this.state.count;
    this.legacyExperimentStats.fieldBuilds = this.uniqueNavigators.length;
    this.rebuildPipeline(false);
  }
  protected override onGoalChanged(): void {
    if (!this.usesCustomNavigation) return;
    this.individualGoals.clear(); this.state.active.fill(1); this.rebuildPipeline(true);
  }
  protected override onObstaclesChanged(): void {
    this.scenario = { ...this.scenario, obstacles: this.obstacles };
    this.legacyExperimentStats.terrainVersion = this.terrainVersion;
    this.rebuildPipeline(true);
  }
  protected override hashAdditionalState(mix: (value: number) => void): void {
    if (!this.pipeline) return;
    for (const target of this.pipeline.targets) { mix(Math.round(target.x * 1000)); mix(Math.round(target.y * 1000)); }
    mix(this.terrainVersion);
  }

  override step(): void {
    if (this.pipeline) { this.stepExperiment(); return; }
    const started = this.now();
    super.step();
    const stats = this.legacyExperimentStats;
    stats.activeCount = this.metrics.activeCount; stats.arrivedCount = this.metrics.arrivedCount;
    stats.movingCount = 0;
    for (let i = 0; i < this.state.count; i++) {
      if (this.state.active[i] === 1 && Math.hypot(this.state.vx[i]!, this.state.vy[i]!) >= this.config.maxSpeed * 0.04) stats.movingCount++;
    }
    stats.waitingCount = stats.activeCount - stats.movingCount;
    stats.contactActiveCount = this.metrics.contactCorrectedAgents;
    stats.fieldBuilds += this.dynamicRebuildCountThisStep;
    stats.passMs.total = this.now() - started;
  }

  override enqueueExternal(input: ExternalInput): boolean {
    if (this.pipeline) throw new RangeError('External inputs currently require Legacy.');
    return super.enqueueExternal(input);
  }
  override get navigators(): readonly FlowField[] { return this.pipeline?.navigators ?? super.navigators; }
  override goalForAgent(agent: number): Vec2 { const goal = super.goalForAgent(agent); return this.pipeline?.targets[agent] ?? goal; }
  arrivalSlotForAgent(agent: number): Vec2 | undefined {
    if (this.resolvedExperiment.options.destination !== 'slots' || !this.pipeline?.available[agent]) return undefined;
    return this.pipeline.targets[agent];
  }
  override sampleNavigationDirection(agent: number, x: number, y: number, out: Vec2): boolean {
    return this.pipeline ? this.pipeline.sample(agent, x, y, out) : super.sampleNavigationDirection(agent, x, y, out);
  }

  /** Single-agent convenience API; batches should use setAgentGoals to invalidate caches once. */
  setAgentGoal(agent: number, x: number, y: number): void { this.setAgentGoals([{ agent, goal: { x, y } }]); }

  setAgentGoals(commands: readonly AgentGoalCommand[]): void {
    if (!this.pipeline || !this.resolvedExperiment.preset.supportsIndividualGoals) throw new RangeError('This preset does not support individual goal commands.');
    const proposed = new Map(this.individualGoals);
    for (const command of commands) {
      if (!Number.isInteger(command.agent) || command.agent < 0 || command.agent >= this.state.count) throw new RangeError('Individual goal agent is out of range.');
      if (!Number.isFinite(command.goal.x) || !Number.isFinite(command.goal.y)) throw new RangeError('Goal coordinates must be finite.');
      proposed.set(command.agent, { x: clamp(command.goal.x, 0, this.config.width), y: clamp(command.goal.y, 0, this.config.height) });
    }
    this.individualGoals.clear();
    for (const [agent, goal] of proposed) this.individualGoals.set(agent, goal);
    for (const { agent } of commands) { this.state.active[agent] = 1; this.state.stalledFor[agent] = 0; this.state.vx[agent] = 0; this.state.vy[agent] = 0; }
    this.rebuildPipeline(true);
    this.previousState.copyFrom(this.state); this.nextState.copyFrom(this.state);
    this.clearWorkingState();
  }

  private rebuildPipeline(preserveCounters: boolean): void {
    const createPipeline = this.resolvedExperiment.preset.createPipeline;
    if (!createPipeline) return;
    const previousPipeline = this.pipeline;
    const previous = previousPipeline?.stats;
    this.pipeline = createPipeline({ config: this.config, scenario: this.scenario, state: this.state,
      radii: this.agentRadii, flows: this.agentFlow, goals: this.goals, crowdField: this.crowdField },
    this.resolvedExperiment.options, this.navigator, this.individualGoals, this.terrainVersion,
    preserveCounters ? previousPipeline ?? undefined : undefined);
    if (previous && preserveCounters) {
      for (const key of ['pathRequests', 'cacheHits', 'fieldBuilds', 'queuePassed', 'replans', 'directionFlips'] as const) this.pipeline.stats[key] += previous[key];
    }
  }

  private stepExperiment(): void {
    const started = performance.now(); const current = this.state; const next = this.nextState;
    this.previousState.copyFrom(current);
    const densityStart = performance.now();
    this.crowdField.update(current, this.effectivePressureThreshold(), this.config.fixedDelta, this.agentAreaWeights);
    const densityMs = performance.now() - densityStart;
    const movement = this.pipeline!.step(current, next, this.stepCount, this.effectivePressureThreshold());
    this.desiredVelocityX.set(this.pipeline!.preferredX); this.desiredVelocityY.set(this.pipeline!.preferredY);
    this.solvedVelocityX.set(next.vx); this.solvedVelocityY.set(next.vy);
    this.publishFieldDensity(next);
    this.dynamicRebuildCountThisStep = 0; this.dynamicRebuildMsThisStep = 0;
    this.finalizeMetrics(current, next, movement);
    this.updateHeadings(current, next);
    this.state = next; this.nextState = current; this.stepCount += 1;
    this.pipeline!.stats.passMs.density = densityMs;
    this.pipeline!.stats.passMs.total = performance.now() - started;
  }

  private updateHeadings(current: AgentBuffer, next: AgentBuffer): void {
    const turnSpeed = Number.isFinite(this.config.turnSpeed) ? Math.max(0, this.config.turnSpeed) : 360;
    const maximumTurn = turnSpeed * Math.PI / 180 * this.config.fixedDelta;
    for (let agent = 0; agent < next.count; agent += 1) {
      const previous = current.heading[agent]!;
      next.heading[agent] = previous;
      if (next.active[agent] !== 1) continue;
      let x = next.intentX[agent]!, y = next.intentY[agent]!;
      if (x * x + y * y <= EPSILON) { x = next.vx[agent]!; y = next.vy[agent]!; }
      if (x * x + y * y <= EPSILON) continue;
      const delta = angleDelta(previous, Math.atan2(y, x));
      next.heading[agent] = angleDelta(0, previous + clamp(delta, -maximumTurn, maximumTurn));
    }
  }

}

export const DEFAULT_CONFIG: SimulationConfig = { ...DEFAULT_CROWD_CONFIG,
  agentCount: 1000, seed: 42, largeAgentPercent: 0, largeAgentScale: 2, neighborRadius: 28,
};
