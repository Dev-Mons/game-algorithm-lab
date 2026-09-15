import { AgentBuffer } from './agent-state';
import { largeAgentPercent, largeAgentScale } from './agent-size';
import { CrowdField } from './crowd-field';
import { CrowdFlowSolver } from './crowd-flow-solver';
import { clamp, distanceSquared } from './math';
import { distanceSquaredToRect } from './obstacle-collision';
import { CrowdMovementSolver, type CrowdMovementResult } from './crowd-movement-solver';
import { createSpawnLayout } from './spawn-layout';
import type {
  CrowdDebugLayers,
  ScenarioDefinition,
  ScenarioFlowDefinition,
  SimulationConfig,
  StepMetrics,
  Vec2,
} from './types';
import { FlowField, type DynamicFlowFieldOptions } from '../algorithms/flow-field/flow-field';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';

const EPSILON = 1e-9;

const ZERO_METRICS: StepMetrics = {
  activeCount: 0,
  arrivedCount: 0,
  arrivalRate: 0,
  averageSpeed: 0,
  overlapPairs: 0,
  recoveredAgents: 0,
  maxRecoveryDistance: 0,
  stalledCount: 0,
  averageNeighbors: 0,
  maxNeighbors: 0,
  candidateChecks: 0,
  backwardCount: 0,
  wallOverlapCount: 0,
  averageVelocityDelta: 0,
  maxVelocityDelta: 0,
  averageAcceleration: 0,
  maxAcceleration: 0,
  contactChecks: 0,
  contactConstraints: 0,
  constraintIterations: 0,
  maxContacts: 0,
  contactCorrectedAgents: 0,
  maxContactCorrection: 0,
  staticProjectionCorrections: 0,
  dynamicRebuildCount: 0,
  dynamicRebuildMs: 0,
  dynamicRebuildIntervalSteps: 0,
  dynamicRebuildAgeSteps: 0,
};

/**
 * Deterministic crowd simulation with one movement authority:
 * navigation -> grid transport -> bounded residual contacts -> static sweep.
 */
export class CrowdSimulation {
  state: AgentBuffer;
  previousState: AgentBuffer;
  private nextState: AgentBuffer;
  readonly navigator: FlowField;
  readonly contactGrid: SpatialHash;
  readonly neighbors: SpatialHash;
  readonly crowdField: CrowdField;
  readonly crowdFlow: CrowdFlowSolver;
  scenario: ScenarioDefinition;
  goal: Vec2;
  readonly agentFlow: Uint16Array;
  readonly agentRadii: Float64Array;
  readonly agentAreaWeights: Float64Array;
  largeAgentCount = 0;
  maxAgentRadius = 0;
  stepCount = 0;
  metrics: StepMetrics = { ...ZERO_METRICS };
  overlapFlags: Uint8Array;
  unspawnedCount = 0;
  readonly debugLayers: CrowdDebugLayers;

  private flowDefinitions: readonly ScenarioFlowDefinition[] = [];
  private flowNavigators: FlowField[] = [];
  private largeFlowNavigators: FlowField[] = [];
  private flowGoals: Vec2[] = [];
  private flowIds: string[] = [];
  private readonly desiredVelocityX: Float64Array;
  private readonly desiredVelocityY: Float64Array;
  private readonly solvedVelocityX: Float64Array;
  private readonly solvedVelocityY: Float64Array;
  private readonly density: Float64Array;
  private readonly recovery: Uint8Array;
  private readonly movement = new CrowdMovementSolver();
  private readonly direction = { x: 1, y: 0 };
  private readonly dynamicFlowOptions: DynamicFlowFieldOptions = {
    densityScale: 1,
    targetDensity: 1,
    densityWeight: 0,
    overloadWeight: 0,
    counterFlowWeight: 0,
    wallWeight: 0,
    costSmoothing: 1,
    directionHysteresis: 0,
    maximumSpeed: 1,
    directGoalLowDensity: 0,
    directGoalCounterFlow: 1,
    directGoalMinimumClearance: 0,
  };
  private lastDynamicRebuildStep = 0;
  private dynamicRebuildCountThisStep = 0;
  private dynamicRebuildMsThisStep = 0;

  constructor(public config: SimulationConfig, scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.goal = { ...scenario.goal };
    this.state = new AgentBuffer(config.agentCount);
    this.previousState = new AgentBuffer(config.agentCount);
    this.nextState = new AgentBuffer(config.agentCount);
    this.navigator = new FlowField(config.width, config.height, config.navCellSize);
    this.crowdField = new CrowdField(
      config.width,
      config.height,
      config.crowdFieldCellSize,
    );
    this.crowdFlow = new CrowdFlowSolver(this.crowdField);
    const contactDiameter = config.agentRadius * 2 + Math.max(0, config.agentGap);
    const spatialCellSize = Math.min(config.contactCellSize, Math.max(1, contactDiameter));
    this.contactGrid = new SpatialHash(
      config.width,
      config.height,
      spatialCellSize,
      config.agentCount,
    );
    // Backward-compatible public alias used by debug drawing and quality
    // instrumentation. Movement uses this grid only for circle contacts.
    this.neighbors = this.contactGrid;
    this.agentFlow = new Uint16Array(config.agentCount);
    this.agentRadii = new Float64Array(config.agentCount);
    this.agentAreaWeights = new Float64Array(config.agentCount);
    this.desiredVelocityX = new Float64Array(config.agentCount);
    this.desiredVelocityY = new Float64Array(config.agentCount);
    this.solvedVelocityX = new Float64Array(config.agentCount);
    this.solvedVelocityY = new Float64Array(config.agentCount);
    this.density = new Float64Array(config.agentCount);
    this.recovery = new Uint8Array(config.agentCount);
    this.overlapFlags = new Uint8Array(config.agentCount);
    this.debugLayers = {
      desiredVelocityX: this.desiredVelocityX,
      desiredVelocityY: this.desiredVelocityY,
      solvedVelocityX: this.solvedVelocityX,
      solvedVelocityY: this.solvedVelocityY,
      density: this.density,
      recovery: this.recovery,
    };
    this.reset();
  }

  reset(): void {
    if (this.config.agentCount > this.agentFlow.length) {
      throw new RangeError('Increasing agentCount requires constructing a new CrowdSimulation.');
    }
    this.config.largeAgentPercent = largeAgentPercent(this.config.largeAgentPercent);
    this.config.largeAgentScale = largeAgentScale(this.config.largeAgentScale);
    this.maxAgentRadius = Math.round(this.config.agentCount * this.config.largeAgentPercent / 100) > 0
      ? this.config.agentRadius * this.config.largeAgentScale : this.config.agentRadius;
    this.configureFlows();
    const positions = createSpawnLayout({
      count: this.config.agentCount,
      seed: this.config.seed,
      agentRadius: this.config.agentRadius,
      largeAgentPercent: this.config.largeAgentPercent,
      largeAgentScale: this.config.largeAgentScale,
      agentGap: this.config.agentGap,
      wallMargin: this.config.wallMargin,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      obstacles: this.scenario.obstacles,
      flows: this.flowDefinitions,
    });
    this.unspawnedCount = Math.max(0, this.config.agentCount - positions.length);
    this.state = new AgentBuffer(positions.length);
    this.previousState = new AgentBuffer(positions.length);
    this.nextState = new AgentBuffer(positions.length);
    this.overlapFlags = new Uint8Array(positions.length);
    this.agentFlow.fill(0);
    this.agentRadii.fill(this.config.agentRadius);
    this.agentAreaWeights.fill(1);
    this.largeAgentCount = 0;
    for (let agent = 0; agent < positions.length; agent += 1) {
      const position = positions[agent]!;
      this.agentFlow[agent] = position.flow;
      this.agentRadii[agent] = position.radius;
      this.agentAreaWeights[agent] = (position.radius / this.config.agentRadius) ** 2;
      if (position.radius > this.config.agentRadius) this.largeAgentCount += 1;
      this.state.x[agent] = position.x;
      this.state.y[agent] = position.y;
      this.state.active[agent] = 1;
      this.sampleNavigationDirection(agent, position.x, position.y, this.direction);
      this.state.intentX[agent] = this.direction.x;
      this.state.intentY[agent] = this.direction.y;
    }
    this.previousState.copyFrom(this.state);
    this.nextState.copyFrom(this.state);
    this.movement.resetRecoveryState();
    this.clearWorkingState();
    this.crowdField.reset();
    this.crowdField.update(
      this.state,
      this.effectivePressureThreshold(),
      0,
      this.agentAreaWeights,
    );
    this.stepCount = 0;
    this.rebuildDynamicFlowFields();
    this.lastDynamicRebuildStep = 0;
    this.dynamicRebuildCountThisStep = 0;
    this.dynamicRebuildMsThisStep = 0;
    this.publishFieldDensity(this.state);
    this.metrics = {
      ...ZERO_METRICS,
      activeCount: this.state.count,
      dynamicRebuildIntervalSteps: this.dynamicRebuildInterval(),
    };
  }

  changeScenario(scenario: ScenarioDefinition): void {
    this.scenario = scenario;
    this.reset();
  }

  /**
   * A new command invalidates old movement momentum. Velocity is projected onto
   * the new route direction, so a 180-degree command stops old motion in the
   * command frame and accelerates in the new direction on the next fixed step.
   */
  setGoal(x: number, y: number): void {
    this.goal.x = clamp(x, 0, this.config.width - 0.001);
    this.goal.y = clamp(y, 0, this.config.height - 0.001);
    const clearance = this.config.agentRadius + this.config.wallMargin;
    for (let flow = 0; flow < this.flowGoals.length; flow += 1) {
      this.flowGoals[flow]!.x = this.goal.x;
      this.flowGoals[flow]!.y = this.goal.y;
      this.flowNavigators[flow]!.rebuild(
        this.flowGoals[flow]!,
        this.scenario.obstacles,
        clearance,
      );
      this.largeFlowNavigators[flow]?.rebuild(
        this.flowGoals[flow]!, this.scenario.obstacles, this.maxAgentRadius + this.config.wallMargin,
      );
    }
    for (let agent = 0; agent < this.state.count; agent += 1) {
      this.state.active[agent] = 1;
      this.state.stalledFor[agent] = 0;
      this.sampleNavigationDirection(
        agent,
        this.state.x[agent]!,
        this.state.y[agent]!,
        this.direction,
      );
      this.removeReverseVelocity(this.state, agent, this.direction.x, this.direction.y);
      this.state.intentX[agent] = this.direction.x;
      this.state.intentY[agent] = this.direction.y;
    }
    this.previousState.copyFrom(this.state);
    this.nextState.copyFrom(this.state);
    this.clearWorkingState();
    this.crowdField.update(
      this.state,
      this.effectivePressureThreshold(),
      0,
      this.agentAreaWeights,
    );
    this.rebuildDynamicFlowFields();
    this.lastDynamicRebuildStep = this.stepCount;
    this.dynamicRebuildCountThisStep = 0;
    this.dynamicRebuildMsThisStep = 0;
    this.publishFieldDensity(this.state);
    this.metrics = {
      ...ZERO_METRICS,
      activeCount: this.state.count,
      dynamicRebuildIntervalSteps: this.dynamicRebuildInterval(),
    };
  }

  step(): void {
    const current = this.state;
    const next = this.nextState;
    this.previousState.copyFrom(current);
    this.deactivateArrivals(current);
    this.crowdField.update(
      current,
      this.effectivePressureThreshold(),
      this.config.fixedDelta,
      this.agentAreaWeights,
    );
    this.updateDynamicFlowFields();
    this.planDesiredVelocities(current);
    this.crowdFlow.solve(current, this.desiredVelocityX, this.desiredVelocityY, {
      targetDensity: this.effectivePressureThreshold(),
      pressureIterations: this.config.crowdPressureIterations,
      pressureRelaxationTime: this.config.crowdPressureRelaxationTime,
      velocityBlend: this.config.crowdVelocityBlend,
      maximumAcceleration: this.config.maxAcceleration,
      maximumSpeed: this.config.maxSpeed,
      fixedDelta: this.config.fixedDelta,
      areaWeights: this.agentAreaWeights,
    });
    const movement = this.movement.solve({
      current,
      next,
      index: this.contactGrid,
      desiredVelocityX: this.desiredVelocityX,
      desiredVelocityY: this.desiredVelocityY,
      solvedVelocityX: this.solvedVelocityX,
      solvedVelocityY: this.solvedVelocityY,
      recovery: this.recovery,
      overlapFlags: this.overlapFlags,
      agentRadius: this.config.agentRadius,
      agentRadii: this.agentRadii,
      maxAgentRadius: this.maxAgentRadius,
      agentGap: this.config.agentGap,
      maxSpeed: this.config.maxSpeed,
      maxAcceleration: this.config.maxAcceleration,
      fixedDelta: this.config.fixedDelta,
      contactCompliance: this.config.contactCompliance,
      contactFriction: this.config.contactFriction,
      maximumContactCorrection: this.config.maximumContactCorrection,
      wallClearance: this.config.agentRadius + this.config.wallMargin,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      obstacles: this.scenario.obstacles,
    });
    this.deactivateArrivals(next);
    this.finalizeMetrics(current, next, movement);
    this.state = next;
    this.nextState = current;
    this.stepCount += 1;
  }

  get goals(): readonly Vec2[] {
    return this.flowGoals;
  }

  get flowCount(): number {
    return this.flowGoals.length;
  }

  get navigators(): readonly FlowField[] {
    return this.flowNavigators;
  }

  flowId(flow: number): string {
    if (!Number.isInteger(flow) || flow < 0 || flow >= this.flowIds.length) {
      throw new RangeError(`Flow index ${flow} is outside 0..${this.flowIds.length - 1}.`);
    }
    return this.flowIds[flow]!;
  }

  goalForAgent(agent: number): Vec2 {
    if (!Number.isInteger(agent) || agent < 0 || agent >= this.state.count) {
      throw new RangeError(`Agent index ${agent} is outside 0..${this.state.count - 1}.`);
    }
    return this.flowGoals[this.agentFlow[agent]!]!;
  }

  sampleNavigationDirection(agent: number, x: number, y: number, out: Vec2): boolean {
    const flow = this.agentFlow[agent] ?? 0;
    // Body size changes clearance data, never the shared direction policy.
    const navigator = (this.agentRadii[agent]! > this.config.agentRadius
      ? this.largeFlowNavigators[flow] : this.flowNavigators[flow]) ?? this.navigator;
    // FlowField alone decides whether a direct-goal contribution is safe.
    // A failed sample must never turn into an unchecked direction through a wall.
    return navigator.sampleDirection(x, y, out);
  }

  stateHash(): string {
    let hash = 0x811c9dc5;
    const mix = (value: number): void => {
      hash ^= value | 0;
      hash = Math.imul(hash, 0x01000193);
    };
    mix(this.stepCount);
    for (const goal of this.flowGoals) {
      mix(Math.round(goal.x * 1000));
      mix(Math.round(goal.y * 1000));
    }
    for (let agent = 0; agent < this.state.count; agent += 1) {
      mix(Math.round(this.state.x[agent]! * 1000));
      mix(Math.round(this.state.y[agent]! * 1000));
      mix(Math.round(this.state.vx[agent]! * 1000));
      mix(Math.round(this.state.vy[agent]! * 1000));
      mix(this.state.active[agent]!);
      mix(Math.round(this.state.stalledFor[agent]! * 1000));
      mix(Math.round(this.state.intentX[agent]! * 1_000_000));
      mix(Math.round(this.state.intentY[agent]! * 1_000_000));
      mix(this.agentFlow[agent]!);
      mix(Math.round(this.agentRadii[agent]! * 1000));
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private configureFlows(): void {
    this.flowDefinitions = this.scenario.flows?.length
      ? this.scenario.flows
      : [{ id: this.scenario.id, spawn: this.scenario.spawn, goal: this.scenario.goal }];
    this.flowGoals = this.flowDefinitions.map((flow) => ({ ...flow.goal }));
    this.flowIds = this.flowDefinitions.map((flow) => flow.id);
    this.goal = { ...this.flowGoals[0]! };
    const clearance = this.config.agentRadius + this.config.wallMargin;
    const navigators = new Array<FlowField>(this.flowDefinitions.length);
    for (let flow = 0; flow < this.flowDefinitions.length; flow += 1) {
      const navigator = flow === 0
        ? this.navigator
        : this.flowNavigators[flow] ?? new FlowField(
            this.config.width,
            this.config.height,
            this.config.navCellSize,
          );
      navigator.rebuild(this.flowGoals[flow]!, this.scenario.obstacles, clearance);
      navigators[flow] = navigator;
    }
    this.flowNavigators = navigators;
    this.largeFlowNavigators = this.maxAgentRadius > this.config.agentRadius
      ? this.flowGoals.map((goal) => {
          const navigator = new FlowField(this.config.width, this.config.height, this.config.navCellSize);
          navigator.rebuild(goal, this.scenario.obstacles, this.maxAgentRadius + this.config.wallMargin);
          return navigator;
        }) : [];
    this.crowdField.setObstacles(this.scenario.obstacles, clearance);
    this.crowdFlow.setObstacles(this.scenario.obstacles, clearance);
  }

  private planDesiredVelocities(current: AgentBuffer): void {
    const slowSpan = Math.max(EPSILON, this.config.arrivalSlowRadius - this.config.goalRadius);
    const pressureThreshold = this.effectivePressureThreshold();
    for (let agent = 0; agent < current.count; agent += 1) {
      if (current.active[agent] !== 1) {
        this.desiredVelocityX[agent] = 0;
        this.desiredVelocityY[agent] = 0;
        continue;
      }
      const goal = this.flowGoals[this.agentFlow[agent]!]!;
      this.sampleNavigationDirection(agent, current.x[agent]!, current.y[agent]!, this.direction);
      current.intentX[agent] = this.direction.x;
      current.intentY[agent] = this.direction.y;
      this.removeReverseVelocity(current, agent, this.direction.x, this.direction.y);
      const distance = Math.sqrt(distanceSquared(
        current.x[agent]!,
        current.y[agent]!,
        goal.x,
        goal.y,
      ));
      const speed = this.config.maxSpeed * clamp(
        (distance - this.config.goalRadius) / slowSpan,
        0,
        1,
      );
      const positionX = current.x[agent]!;
      const positionY = current.y[agent]!;
      const density = this.crowdField.sampleDensity(positionX, positionY);
      this.density[agent] = density / pressureThreshold;

      this.desiredVelocityX[agent] = this.direction.x * speed;
      this.desiredVelocityY[agent] = this.direction.y * speed;
    }
  }

  private deactivateArrivals(state: AgentBuffer): void {
    const arrivalRadiusSquared = this.config.goalRadius * this.config.goalRadius;
    for (let agent = 0; agent < state.count; agent += 1) {
      if (state.active[agent] !== 1) continue;
      const goal = this.flowGoals[this.agentFlow[agent]!]!;
      if (distanceSquared(state.x[agent]!, state.y[agent]!, goal.x, goal.y) > arrivalRadiusSquared) continue;
      state.active[agent] = 0;
      state.vx[agent] = 0;
      state.vy[agent] = 0;
      state.stalledFor[agent] = 0;
      state.intentX[agent] = 0;
      state.intentY[agent] = 0;
    }
  }

  private removeReverseVelocity(
    state: AgentBuffer,
    agent: number,
    directionX: number,
    directionY: number,
  ): void {
    const progress = state.vx[agent]! * directionX + state.vy[agent]! * directionY;
    if (progress >= 0) return;
    state.vx[agent] = state.vx[agent]! - directionX * progress;
    state.vy[agent] = state.vy[agent]! - directionY * progress;
  }

  private finalizeMetrics(
    current: AgentBuffer,
    next: AgentBuffer,
    movement: CrowdMovementResult,
  ): void {
    let activeCount = 0;
    let speedSum = 0;
    let stalledCount = 0;
    let backwardCount = 0;
    let wallOverlapCount = 0;
    let velocityDeltaSum = 0;
    let maximumVelocityDelta = 0;
    let accelerationSum = 0;
    let maximumAcceleration = 0;
    for (let agent = 0; agent < next.count; agent += 1) {
      if (next.active[agent] !== 1) continue;
      const wallClearance = this.agentRadii[agent]! + this.config.wallMargin;
      const wallClearanceSquared = wallClearance * wallClearance;
      activeCount += 1;
      const speed = Math.hypot(next.vx[agent]!, next.vy[agent]!);
      speedSum += speed;
      next.stalledFor[agent] = speed < this.config.maxSpeed * 0.04
        ? current.stalledFor[agent]! + this.config.fixedDelta
        : 0;
      if (next.stalledFor[agent]! >= this.config.stallSeconds) stalledCount += 1;
      if (next.vx[agent]! * next.intentX[agent]! + next.vy[agent]! * next.intentY[agent]! < -1e-6) {
        backwardCount += 1;
      }
      const velocityDelta = Math.hypot(
        next.vx[agent]! - current.vx[agent]!,
        next.vy[agent]! - current.vy[agent]!,
      );
      velocityDeltaSum += velocityDelta;
      maximumVelocityDelta = Math.max(maximumVelocityDelta, velocityDelta);
      const acceleration = velocityDelta / this.config.fixedDelta;
      accelerationSum += acceleration;
      maximumAcceleration = Math.max(maximumAcceleration, acceleration);
      if (
        next.x[agent]! < wallClearance - EPSILON
        || next.y[agent]! < wallClearance - EPSILON
        || next.x[agent]! > this.config.width - wallClearance + EPSILON
        || next.y[agent]! > this.config.height - wallClearance + EPSILON
      ) {
        wallOverlapCount += 1;
        continue;
      }
      for (const obstacle of this.scenario.obstacles) {
        if (distanceSquaredToRect(next.x[agent]!, next.y[agent]!, obstacle) >= wallClearanceSquared - EPSILON) continue;
        wallOverlapCount += 1;
        break;
      }
    }
    const arrivedCount = next.count - activeCount;
    this.metrics = {
      activeCount,
      arrivedCount,
      arrivalRate: next.count > 0 ? arrivedCount / next.count : 0,
      averageSpeed: activeCount > 0 ? speedSum / activeCount : 0,
      overlapPairs: movement.overlapPairs,
      recoveredAgents: movement.recoveredAgents,
      maxRecoveryDistance: movement.maxRecoveryDistance,
      stalledCount,
      averageNeighbors: activeCount > 0 ? movement.totalNeighbors / activeCount : 0,
      maxNeighbors: movement.maxNeighbors,
      candidateChecks: movement.candidateChecks,
      backwardCount,
      wallOverlapCount,
      averageVelocityDelta: activeCount > 0 ? velocityDeltaSum / activeCount : 0,
      maxVelocityDelta: maximumVelocityDelta,
      averageAcceleration: activeCount > 0 ? accelerationSum / activeCount : 0,
      maxAcceleration: maximumAcceleration,
      contactChecks: movement.contactChecks,
      contactConstraints: movement.contactConstraints,
      constraintIterations: movement.constraintIterations,
      maxContacts: movement.maxContacts,
      contactCorrectedAgents: movement.contactCorrectedAgents,
      maxContactCorrection: movement.maxContactCorrection,
      staticProjectionCorrections: movement.staticProjectionCorrections,
      dynamicRebuildCount: this.dynamicRebuildCountThisStep,
      dynamicRebuildMs: this.dynamicRebuildMsThisStep,
      dynamicRebuildIntervalSteps: this.dynamicRebuildInterval(),
      dynamicRebuildAgeSteps: this.dynamicRebuildCountThisStep > 0
        ? 0
        : this.stepCount + 1 - this.lastDynamicRebuildStep,
    };
  }

  private updateDynamicFlowFields(): void {
    this.dynamicRebuildCountThisStep = 0;
    this.dynamicRebuildMsThisStep = 0;
    if (this.stepCount - this.lastDynamicRebuildStep < this.dynamicRebuildInterval()) return;
    const startedAt = performance.now();
    this.rebuildDynamicFlowFields();
    this.dynamicRebuildMsThisStep = performance.now() - startedAt;
    this.dynamicRebuildCountThisStep = this.flowNavigators.length + this.largeFlowNavigators.length;
    this.lastDynamicRebuildStep = this.stepCount;
  }

  private rebuildDynamicFlowFields(): void {
    const options = this.dynamicFlowOptions;
    options.densityScale = this.effectivePressureThreshold();
    options.targetDensity = this.config.dynamicFlowTargetDensity;
    options.densityWeight = this.config.dynamicFlowDensityWeight;
    options.overloadWeight = this.config.dynamicFlowOverloadWeight;
    options.counterFlowWeight = this.config.dynamicFlowCounterFlowWeight;
    options.wallWeight = this.config.dynamicFlowWallWeight;
    options.costSmoothing = this.config.dynamicFlowCostSmoothing;
    options.directionHysteresis = this.config.dynamicFlowDirectionHysteresis;
    options.maximumSpeed = this.config.maxSpeed;
    options.directGoalLowDensity = this.config.directGoalLowDensity;
    options.directGoalCounterFlow = this.config.directGoalCounterFlow;
    options.directGoalMinimumClearance = this.config.directGoalMinimumClearance;
    for (const navigator of this.flowNavigators) {
      navigator.rebuildDynamic(this.crowdField, options);
    }
    for (const navigator of this.largeFlowNavigators) {
      navigator.rebuildDynamic(this.crowdField, options);
    }
  }

  private dynamicRebuildInterval(): number {
    return Math.max(1, Math.trunc(this.config.dynamicFlowRebuildInterval));
  }

  private publishFieldDensity(state: AgentBuffer): void {
    const pressureThreshold = this.effectivePressureThreshold();
    for (let agent = 0; agent < state.count; agent += 1) {
      this.density[agent] = state.active[agent] === 1
        ? this.crowdField.sampleDensity(state.x[agent]!, state.y[agent]!) / pressureThreshold
        : 0;
    }
  }

  private effectivePressureThreshold(): number {
    const radiusScale = 3.2 / Math.max(EPSILON, this.config.agentRadius);
    const cellScale = this.config.crowdFieldCellSize / 24;
    return Math.max(
      EPSILON,
      this.config.pressureThreshold * radiusScale * radiusScale * cellScale * cellScale,
    );
  }

  private clearWorkingState(): void {
    this.desiredVelocityX.fill(0);
    this.desiredVelocityY.fill(0);
    this.solvedVelocityX.fill(0);
    this.solvedVelocityY.fill(0);
    this.density.fill(0);
    this.recovery.fill(0);
    this.overlapFlags.fill(0);
  }
}

export const DEFAULT_CONFIG: SimulationConfig = {
  width: 1200,
  height: 720,
  navCellSize: 24,
  crowdFieldCellSize: 24,
  contactCellSize: 24,
  agentCount: 1000,
  seed: 42,
  maxSpeed: 86,
  maxAcceleration: 210,
  agentRadius: 3.2,
  largeAgentPercent: 0,
  largeAgentScale: 2,
  neighborRadius: 28,
  agentGap: 0.4,
  wallMargin: 0.35,
  crowdPressureRelaxationTime: 0.25,
  goalRadius: 58,
  fixedDelta: 1 / 60,
  arrivalSlowRadius: 90,
  stallSeconds: 2.5,
  crowdPressureIterations: 8,
  pressureThreshold: 8,
  crowdVelocityBlend: 0.68,
  contactCompliance: 0.00001,
  contactFriction: 0.08,
  maximumContactCorrection: 1.25,
  dynamicFlowRebuildInterval: 8,
  dynamicFlowTargetDensity: 0.45,
  dynamicFlowDensityWeight: 6,
  dynamicFlowOverloadWeight: 0.35,
  dynamicFlowCounterFlowWeight: 2.5,
  dynamicFlowWallWeight: 0.15,
  dynamicFlowCostSmoothing: 0.35,
  dynamicFlowDirectionHysteresis: 0.2,
  directGoalLowDensity: 0.15,
  directGoalCounterFlow: 0.1,
  directGoalMinimumClearance: 36,
};
