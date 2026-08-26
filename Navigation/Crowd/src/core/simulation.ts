import { AgentBuffer } from './agent-state';
import { clamp, distanceSquared, limit } from './math';
import { SeededRandom } from './random';
import type { ScenarioDefinition, SimulationConfig, StepMetrics, Vec2 } from './types';
import { FlowField } from '../algorithms/flow-field/flow-field';
import { LocalMovementSolver } from '../algorithms/steering/local-movement-solver';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';

const ZERO_METRICS: StepMetrics = {
  activeCount: 0,
  arrivedCount: 0,
  arrivalRate: 0,
  averageSpeed: 0,
  overlapPairs: 0,
  stalledCount: 0,
  averageNeighbors: 0,
  maxNeighbors: 0,
  candidateChecks: 0,
};

export class CrowdSimulation {
  state: AgentBuffer;
  private nextState: AgentBuffer;
  readonly navigator: FlowField;
  readonly neighbors: SpatialHash;
  readonly movement = new LocalMovementSolver();
  scenario: ScenarioDefinition;
  goal: Vec2;
  stepCount = 0;
  metrics: StepMetrics = { ...ZERO_METRICS };
  overlapFlags: Uint8Array;

  private queryAgent = 0;
  private neighborCount = 0;
  private separationX = 0;
  private separationY = 0;
  private alignmentX = 0;
  private alignmentY = 0;
  private candidateChecks = 0;
  private overlapPairs = 0;
  private readonly flowDirection = { x: 0, y: 0 };
  private readonly acceleration = { x: 0, y: 0 };
  private readonly limitedVelocity = { x: 0, y: 0 };
  private readonly visitCandidate = (candidate: number): void => this.accumulateCandidate(candidate);

  constructor(public config: SimulationConfig, scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.goal = { ...scenario.goal };
    this.state = new AgentBuffer(config.agentCount);
    this.nextState = new AgentBuffer(config.agentCount);
    this.navigator = new FlowField(config.width, config.height, config.cellSize);
    this.neighbors = new SpatialHash(config.width, config.height, config.neighborRadius, config.agentCount);
    this.overlapFlags = new Uint8Array(config.agentCount);
    this.reset();
  }

  reset(): void {
    const random = new SeededRandom(this.config.seed);
    this.state = new AgentBuffer(this.config.agentCount);
    this.nextState = new AgentBuffer(this.config.agentCount);
    this.overlapFlags = new Uint8Array(this.config.agentCount);
    this.goal = { ...this.scenario.goal };
    this.navigator.rebuild(this.goal, this.scenario.obstacles);
    const padding = this.config.agentRadius + 2;
    for (let i = 0; i < this.config.agentCount; i += 1) {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        x = random.range(this.scenario.spawn.x + padding, this.scenario.spawn.x + this.scenario.spawn.width - padding);
        y = random.range(this.scenario.spawn.y + padding, this.scenario.spawn.y + this.scenario.spawn.height - padding);
        if (!this.navigator.isBlockedAt(x, y)) break;
      }
      this.state.x[i] = x;
      this.state.y[i] = y;
      this.state.active[i] = 1;
    }
    this.nextState.copyFrom(this.state);
    this.stepCount = 0;
    this.metrics = { ...ZERO_METRICS, activeCount: this.config.agentCount };
  }

  changeScenario(scenario: ScenarioDefinition): void {
    this.scenario = scenario;
    this.reset();
  }

  setGoal(x: number, y: number): void {
    this.goal.x = clamp(x, 0, this.config.width - 0.001);
    this.goal.y = clamp(y, 0, this.config.height - 0.001);
    this.navigator.rebuild(this.goal, this.scenario.obstacles);
    this.state.active.fill(1);
    this.state.stalledFor.fill(0);
    this.nextState.copyFrom(this.state);
    this.metrics.arrivedCount = 0;
    this.metrics.activeCount = this.config.agentCount;
  }

  step(): void {
    const current = this.state;
    const next = this.nextState;
    const radiusSquared = this.config.goalRadius * this.config.goalRadius;
    this.neighbors.rebuild(current.x, current.y, current.active);
    next.copyFrom(current);
    this.candidateChecks = 0;
    this.overlapPairs = 0;
    this.overlapFlags.fill(0);
    let activeCount = 0;
    let arrivedCount = 0;
    let stalledCount = 0;
    let totalSpeed = 0;
    let totalNeighbors = 0;
    let maxNeighbors = 0;

    for (let i = 0; i < current.count; i += 1) {
      if (current.active[i] !== 1) {
        arrivedCount += 1;
        continue;
      }
      const x = current.x[i]!;
      const y = current.y[i]!;
      const goalDistanceSquared = distanceSquared(x, y, this.goal.x, this.goal.y);
      if (goalDistanceSquared <= radiusSquared) {
        next.active[i] = 0;
        next.vx[i] = 0;
        next.vy[i] = 0;
        arrivedCount += 1;
        continue;
      }

      activeCount += 1;
      this.queryAgent = i;
      this.neighborCount = 0;
      this.separationX = 0;
      this.separationY = 0;
      this.alignmentX = 0;
      this.alignmentY = 0;
      this.neighbors.forEachCandidate(x, y, this.config.neighborRadius, this.visitCandidate);
      totalNeighbors += this.neighborCount;
      maxNeighbors = Math.max(maxNeighbors, this.neighborCount);

      this.navigator.sampleDirection(x, y, this.flowDirection);
      if (this.neighborCount > 0) {
        this.alignmentX = this.alignmentX / this.neighborCount - current.vx[i]!;
        this.alignmentY = this.alignmentY / this.neighborCount - current.vy[i]!;
      }
      this.movement.solve({
        velocityX: current.vx[i]!,
        velocityY: current.vy[i]!,
        preferredX: this.flowDirection.x,
        preferredY: this.flowDirection.y,
        separationX: this.separationX,
        separationY: this.separationY,
        alignmentX: this.alignmentX,
        alignmentY: this.alignmentY,
        distanceToGoal: Math.sqrt(goalDistanceSquared),
        maxSpeed: this.config.maxSpeed,
        maxAcceleration: this.config.maxAcceleration,
        separationWeight: this.config.separationWeight,
        alignmentWeight: this.config.alignmentWeight,
        arrivalSlowRadius: Math.max(this.config.arrivalSlowRadius, this.config.goalRadius * 1.5),
      }, this.acceleration);

      let vx = current.vx[i]! + this.acceleration.x * this.config.fixedDelta;
      let vy = current.vy[i]! + this.acceleration.y * this.config.fixedDelta;
      limit(vx, vy, this.config.maxSpeed, this.limitedVelocity);
      vx = this.limitedVelocity.x;
      vy = this.limitedVelocity.y;
      let nx = clamp(x + vx * this.config.fixedDelta, this.config.agentRadius, this.config.width - this.config.agentRadius);
      let ny = clamp(y + vy * this.config.fixedDelta, this.config.agentRadius, this.config.height - this.config.agentRadius);
      if (this.navigator.isBlockedAt(nx, ny)) {
        if (!this.navigator.isBlockedAt(x, ny)) {
          nx = x;
          vx = 0;
        } else if (!this.navigator.isBlockedAt(nx, y)) {
          ny = y;
          vy = 0;
        } else {
          nx = x;
          ny = y;
          vx = 0;
          vy = 0;
        }
      }
      next.x[i] = nx;
      next.y[i] = ny;
      next.vx[i] = vx;
      next.vy[i] = vy;
      const speed = Math.hypot(vx, vy);
      totalSpeed += speed;
      next.stalledFor[i] = speed < this.config.maxSpeed * 0.08
        ? current.stalledFor[i]! + this.config.fixedDelta
        : 0;
      if (next.stalledFor[i]! >= this.config.stallSeconds) stalledCount += 1;
    }

    this.state = next;
    this.nextState = current;
    this.stepCount += 1;
    this.metrics = {
      activeCount,
      arrivedCount,
      arrivalRate: this.config.agentCount === 0 ? 1 : arrivedCount / this.config.agentCount,
      averageSpeed: activeCount === 0 ? 0 : totalSpeed / activeCount,
      overlapPairs: Math.floor(this.overlapPairs / 2),
      stalledCount,
      averageNeighbors: activeCount === 0 ? 0 : totalNeighbors / activeCount,
      maxNeighbors,
      candidateChecks: this.candidateChecks,
    };
  }

  stateHash(): string {
    let hash = 0x811c9dc5;
    const mix = (value: number): void => {
      hash ^= value | 0;
      hash = Math.imul(hash, 0x01000193);
    };
    mix(this.stepCount);
    for (let i = 0; i < this.state.count; i += 1) {
      mix(Math.round(this.state.x[i]! * 1000));
      mix(Math.round(this.state.y[i]! * 1000));
      mix(Math.round(this.state.vx[i]! * 1000));
      mix(Math.round(this.state.vy[i]! * 1000));
      mix(this.state.active[i]!);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private accumulateCandidate(candidate: number): void {
    if (candidate === this.queryAgent || this.state.active[candidate] !== 1) return;
    this.candidateChecks += 1;
    const dx = this.state.x[this.queryAgent]! - this.state.x[candidate]!;
    const dy = this.state.y[this.queryAgent]! - this.state.y[candidate]!;
    const squared = dx * dx + dy * dy;
    const neighborSquared = this.config.neighborRadius * this.config.neighborRadius;
    if (squared > neighborSquared || squared <= 1e-12) return;
    this.neighborCount += 1;
    const distance = Math.sqrt(squared);
    const strength = (this.config.neighborRadius - distance) / this.config.neighborRadius;
    this.separationX += (dx / distance) * strength * this.config.maxSpeed;
    this.separationY += (dy / distance) * strength * this.config.maxSpeed;
    this.alignmentX += this.state.vx[candidate]!;
    this.alignmentY += this.state.vy[candidate]!;
    if (distance < this.config.agentRadius * 2) {
      this.overlapPairs += 1;
      this.overlapFlags[this.queryAgent] = 1;
      this.overlapFlags[candidate] = 1;
    }
  }
}

export const DEFAULT_CONFIG: SimulationConfig = {
  width: 1200,
  height: 720,
  cellSize: 24,
  agentCount: 1000,
  seed: 42,
  maxSpeed: 86,
  maxAcceleration: 210,
  agentRadius: 3.2,
  neighborRadius: 22,
  separationWeight: 2.3,
  alignmentWeight: 0.12,
  goalRadius: 58,
  fixedDelta: 1 / 60,
  arrivalSlowRadius: 150,
  stallSeconds: 2.5,
};
