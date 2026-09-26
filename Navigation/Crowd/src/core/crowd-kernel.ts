import { AgentBuffer } from './agent-state';
import { CrowdField } from './crowd-field';
import { CrowdFlowSolver } from './crowd-flow-solver';
import { clamp, distanceSquared } from './math';
import { distanceSquaredToRect } from './obstacle-collision';
import { CrowdMovementSolver, type CrowdMovementResult } from './crowd-movement-solver';
import { StaticObstacleIndex } from './static-obstacle-index';
import type {
  CrowdDebugLayers,
  Rect,
  CrowdConfig,
  StepMetrics,
  Vec2,
} from './types';
import { FlowField, type DynamicFlowFieldOptions } from '../algorithms/flow-field/flow-field';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import { ExternalInfluences, type ExternalInput } from './external-influences';
import { validateCrowdConfig, validateInitialState, type CrowdInitialState } from './kernel-input';

export type CrowdPass = 'density' | 'navigation' | 'desired' | 'avoidance' | 'contact';

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
export class CrowdKernel {
  readonly external: ExternalInfluences;
  state: AgentBuffer;
  previousState: AgentBuffer;
  protected nextState: AgentBuffer;
  readonly navigator: FlowField;
  readonly contactGrid: SpatialHash;
  readonly neighbors: SpatialHash;
  readonly crowdField: CrowdField;
  readonly crowdFlow: CrowdFlowSolver;
  obstacles: Rect[] = [];
  agentIds: string[] = [];
  private initialized = false;
  goal: Vec2 = { x: 0, y: 0 };
  readonly agentFlow: Uint16Array;
  readonly agentRadii: Float64Array;
  readonly agentAreaWeights: Float64Array;
  largeAgentCount = 0;
  maxAgentRadius = 0;
  stepCount = 0;
  metrics: StepMetrics = { ...ZERO_METRICS };
  overlapFlags: Uint8Array;
  readonly debugLayers: CrowdDebugLayers;
  protected terrainVersion = 0;

  protected get usesCustomNavigation(): boolean { return false; }
  protected get retainArrivals(): boolean { return false; }
  protected now(): number { return 0; }
  protected onPass(_pass: CrowdPass | null): void {}
  protected onInitialized(): void {}
  protected onGoalChanged(): void {}
  protected onObstaclesChanged(): void {}
  protected hashAdditionalState(_mix: (value: number) => void): void {}

  private flowNavigators: FlowField[] = [];
  private largeFlowNavigators: FlowField[] = [];
  private uniqueFlowNavigators: FlowField[] = [];
  protected uniqueNavigators: FlowField[] = [];
  private flowGoals: Vec2[] = [];
  private flowIds: string[] = [];
  protected readonly desiredVelocityX: Float64Array;
  protected readonly desiredVelocityY: Float64Array;
  protected readonly solvedVelocityX: Float64Array;
  protected readonly solvedVelocityY: Float64Array;
  private readonly density: Float64Array;
  private readonly recovery: Uint8Array;
  private readonly obstacleIndex = new StaticObstacleIndex();
  private readonly movement = new CrowdMovementSolver(this.obstacleIndex);
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
  protected dynamicRebuildCountThisStep = 0;
  protected dynamicRebuildMsThisStep = 0;

  constructor(public config: CrowdConfig, capacity: number) {
    validateCrowdConfig(config);
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('Invalid crowd capacity.');
    this.external = new ExternalInfluences(capacity, config.width, config.height, () => this.now());
    this.state = new AgentBuffer(capacity);
    this.previousState = new AgentBuffer(capacity);
    this.nextState = new AgentBuffer(capacity);
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
      capacity,
    );
    // Backward-compatible public alias used by debug drawing and quality
    // instrumentation. Movement uses this grid only for circle contacts.
    this.neighbors = this.contactGrid;
    this.agentFlow = new Uint16Array(capacity);
    this.agentRadii = new Float64Array(capacity);
    this.agentAreaWeights = new Float64Array(capacity);
    this.desiredVelocityX = new Float64Array(capacity);
    this.desiredVelocityY = new Float64Array(capacity);
    this.solvedVelocityX = new Float64Array(capacity);
    this.solvedVelocityY = new Float64Array(capacity);
    this.density = new Float64Array(capacity);
    this.recovery = new Uint8Array(capacity);
    this.overlapFlags = new Uint8Array(capacity);
    this.debugLayers = {
      desiredVelocityX: this.desiredVelocityX,
      desiredVelocityY: this.desiredVelocityY,
      solvedVelocityX: this.solvedVelocityX,
      solvedVelocityY: this.solvedVelocityY,
      density: this.density,
      recovery: this.recovery,
    };
  }

  dispose():void {this.movement.dispose();}

  /** Start at tick zero from owned copies of explicit data. Not a mid-run restore. */
  initialize(initial: CrowdInitialState): void {
    validateInitialState(initial, this.config, this.agentFlow.length);
    this.external.reset();
    this.terrainVersion = 0;
    this.obstacles = initial.obstacles.map(rect => ({ ...rect }));
    this.agentIds = initial.agents.map(agent => agent.id);
    this.maxAgentRadius = initial.maxAgentRadius;
    this.flowGoals = initial.flows.map(flow => ({ ...flow.goal }));
    this.flowIds = initial.flows.map(flow => flow.id);
    this.goal = { ...this.flowGoals[0]! };
    this.configureNavigators();
    const clearance = this.config.agentRadius + this.config.wallMargin;
    this.crowdField.setObstacles(this.obstacles, clearance);
    this.crowdFlow.setObstacles(this.obstacles, clearance);
    this.state = new AgentBuffer(initial.agents.length);
    this.previousState = new AgentBuffer(initial.agents.length);
    this.nextState = new AgentBuffer(initial.agents.length);
    this.overlapFlags = new Uint8Array(initial.agents.length);
    this.agentFlow.fill(0);
    this.agentRadii.fill(this.config.agentRadius);
    this.agentAreaWeights.fill(1);
    this.largeAgentCount = 0;
    for (let agent = 0; agent < initial.agents.length; agent++) {
      const input = initial.agents[agent]!;
      this.agentFlow[agent] = input.flow;
      this.agentRadii[agent] = input.radius;
      this.agentAreaWeights[agent] = (input.radius / this.config.agentRadius) ** 2;
      if (input.radius > this.config.agentRadius) this.largeAgentCount++;
      this.state.x[agent] = input.x;
      this.state.y[agent] = input.y;
      this.state.vx[agent] = input.vx ?? 0;
      this.state.vy[agent] = input.vy ?? 0;
      this.state.active[agent] = input.active ?? 1;
      this.state.stalledFor[agent] = input.stalledFor ?? 0;
      this.sampleNavigationDirection(agent, input.x, input.y, this.direction);
      this.state.intentX[agent] = input.intentX ?? this.direction.x;
      this.state.intentY[agent] = input.intentY ?? this.direction.y;
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
    const activeCount = this.state.active.reduce((count, active) => count + active, 0);
    this.metrics = {
      ...ZERO_METRICS,
      activeCount,
      arrivedCount: this.state.count - activeCount,
      arrivalRate: this.state.count ? (this.state.count - activeCount) / this.state.count : 0,
      dynamicRebuildIntervalSteps: this.dynamicRebuildInterval(),
    };
    this.onInitialized();
    for (let agent = 0; agent < this.state.count; agent += 1) {
      this.sampleNavigationDirection(agent, this.state.x[agent]!, this.state.y[agent]!, this.direction);
      this.state.heading[agent] = initial.agents[agent]!.heading ?? Math.atan2(this.direction.y, this.direction.x);
    }
    this.previousState.heading.set(this.state.heading);
    this.nextState.heading.set(this.state.heading);
    this.initialized = true;
  }

  /**
   * A new command changes route intent immediately. Momentum and heading are
   * preserved; the movement solver brakes and turns under the configured limits.
   */
  setGoal(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Goal coordinates must be finite.');
    this.goal.x = clamp(x, 0, this.config.width - 0.001);
    this.goal.y = clamp(y, 0, this.config.height - 0.001);
    for (let flow = 0; flow < this.flowGoals.length; flow += 1) {
      this.flowGoals[flow]!.x = this.goal.x;
      this.flowGoals[flow]!.y = this.goal.y;
    }
    this.configureNavigators();
    this.onGoalChanged();
    for (let agent = 0; agent < this.state.count; agent += 1) {
      this.state.active[agent] = 1;
      this.state.stalledFor[agent] = 0;
      this.sampleNavigationDirection(
        agent,
        this.state.x[agent]!,
        this.state.y[agent]!,
        this.direction,
      );
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
    if (!this.initialized) throw new Error('Initialize the crowd before stepping.');
    const current = this.state;
    const next = this.nextState;
    this.previousState.copyFrom(current);
    this.deactivateArrivals(current);
    this.external.begin(current, this.agentFlow, this.stepCount, this.config.fixedDelta, this.agentRadii);
    this.onPass('density');
    this.crowdField.update(
      current,
      this.effectivePressureThreshold(),
      this.config.fixedDelta,
      this.agentAreaWeights,
    );
    this.onPass('navigation');
    this.updateDynamicFlowFields();
    this.onPass('desired');
    this.planDesiredVelocities(current);
    this.onPass('avoidance');
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
    this.onPass('contact');
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
      turnSpeed: Number.isFinite(this.config.turnSpeed) ? this.config.turnSpeed : 360,
      fixedDelta: this.config.fixedDelta,
      contactCompliance: this.config.contactCompliance,
      contactFriction: this.config.contactFriction,
      maximumContactCorrection: this.config.maximumContactCorrection,
      wallClearance: this.config.agentRadius + this.config.wallMargin,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      obstacles: this.obstacles,
    });
    // Legacy movement is a fused contacts/integration pass; the combined time is labeled contact.
    this.onPass(null);
    this.deactivateArrivals(next);
    this.finalizeMetrics(current, next, movement);
    this.state = next;
    this.nextState = current;
    this.stepCount += 1;
  }

  get goals(): readonly Vec2[] {
    return this.flowGoals;
  }

  enqueueExternal(input: ExternalInput): boolean {
    return this.external.enqueue(input, this.stepCount, this.state.count, this.config.fixedDelta);
  }

  get flowCount(): number {
    return this.flowGoals.length;
  }

  get navigators(): readonly FlowField[] {
    return this.uniqueFlowNavigators;
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
    // Heading affects subsequent movement and belongs to deterministic state.
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
    this.hashAdditionalState(mix);
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
      mix(Math.round(this.state.heading[agent]! * 1_000_000));
    }
    const external = this.external.fingerprint();
    for (let i = 0; i < external.length; i++) mix(external.charCodeAt(i));
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /** Conservative global invalidation propagates terrain edits to every dependent field/corridor. */
  updateObstacles(obstacles: readonly Rect[]): void {
    for (const obstacle of obstacles) {
      if (![obstacle.x, obstacle.y, obstacle.width, obstacle.height].every(Number.isFinite)
        || obstacle.width < 0 || obstacle.height < 0) throw new RangeError('Invalid obstacle geometry.');
    }
    const retainArrivals = this.retainArrivals;
    for (let agent = 0; agent < this.state.count; agent += 1) {
      if (this.state.active[agent] !== 1 && !retainArrivals) continue;
      const clearance = Math.max(0, this.agentRadii[agent]! + this.config.wallMargin - 1e-6);
      for (const obstacle of obstacles) {
        if (distanceSquaredToRect(this.state.x[agent]!, this.state.y[agent]!, obstacle) < clearance * clearance) {
          throw new RangeError(`Construction intersects occupied agent ${agent}; move the unit or choose free terrain.`);
        }
      }
    }
    this.obstacles = obstacles.map(obstacle => ({ ...obstacle }));
    this.terrainVersion += 1;
    this.configureNavigators();
    const clearance = this.config.agentRadius + this.config.wallMargin;
    this.crowdField.setObstacles(this.obstacles, clearance);
    this.crowdFlow.setObstacles(this.obstacles, clearance);
    this.crowdField.update(this.state, this.effectivePressureThreshold(), 0, this.agentAreaWeights);
    this.onObstaclesChanged();
    this.rebuildDynamicFlowFields();
    this.lastDynamicRebuildStep = this.stepCount;
    this.previousState.copyFrom(this.state); this.nextState.copyFrom(this.state);
  }

  private configureNavigators(): void {
    if (this.usesCustomNavigation) {
      this.flowNavigators = []; this.largeFlowNavigators = [];
      this.uniqueFlowNavigators = []; this.uniqueNavigators = [];
      return;
    }
    // Spawn cohorts are metadata, not distinct navigation fields. A common goal
    // shares one field; size-specific clearance still protects larger bodies.
    const build = (clearance: number, primary?: FlowField): FlowField[] => {
      const goals = new Map<string, FlowField>();
      return this.flowGoals.map((goal) => {
        const key = `${goal.x},${goal.y}`;
        let navigator = goals.get(key);
        if (!navigator) {
          navigator = goals.size === 0 && primary ? primary
            : new FlowField(this.config.width, this.config.height, this.config.navCellSize);
          navigator.rebuild(goal, this.obstacles, clearance);
          goals.set(key, navigator);
        }
        return navigator;
      });
    };
    this.flowNavigators = build(this.config.agentRadius + this.config.wallMargin, this.navigator);
    this.largeFlowNavigators = this.maxAgentRadius > this.config.agentRadius
      ? build(this.maxAgentRadius + this.config.wallMargin) : [];
    this.uniqueFlowNavigators = [...new Set(this.flowNavigators)];
    this.uniqueNavigators = [...new Set([...this.flowNavigators, ...this.largeFlowNavigators])];
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

  protected finalizeMetrics(
    current: AgentBuffer,
    next: AgentBuffer,
    movement: CrowdMovementResult,
  ): void {
    this.obstacleIndex.update(this.obstacles);
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
      const wallTolerance = this.usesCustomNavigation ? 1e-6 : EPSILON;
      const wallClearanceSquared = this.usesCustomNavigation ? Math.max(0, wallClearance - wallTolerance) ** 2 : wallClearance * wallClearance;
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
        next.vx[agent]! - this.previousState.vx[agent]!,
        next.vy[agent]! - this.previousState.vy[agent]!,
      );
      velocityDeltaSum += velocityDelta;
      maximumVelocityDelta = Math.max(maximumVelocityDelta, velocityDelta);
      const acceleration = velocityDelta / this.config.fixedDelta;
      accelerationSum += acceleration;
      maximumAcceleration = Math.max(maximumAcceleration, acceleration);
      if (
        next.x[agent]! < wallClearance - wallTolerance
        || next.y[agent]! < wallClearance - wallTolerance
        || next.x[agent]! > this.config.width - wallClearance + wallTolerance
        || next.y[agent]! > this.config.height - wallClearance + wallTolerance
      ) {
        wallOverlapCount += 1;
        continue;
      }
      for (const index of this.obstacleIndex.query(next.x[agent]! - wallClearance, next.y[agent]! - wallClearance,
        next.x[agent]! + wallClearance, next.y[agent]! + wallClearance)) {
        const obstacle = this.obstacles[index]!;
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
      dynamicRebuildAgeSteps: !this.config.dynamicRouting || this.dynamicRebuildCountThisStep > 0
        ? 0
        : this.stepCount + 1 - this.lastDynamicRebuildStep,
    };
  }

  private updateDynamicFlowFields(): void {
    this.dynamicRebuildCountThisStep = 0;
    this.dynamicRebuildMsThisStep = 0;
    if (!this.config.dynamicRouting) return;
    if (this.stepCount - this.lastDynamicRebuildStep < this.dynamicRebuildInterval()) return;
    const startedAt = this.now();
    this.rebuildDynamicFlowFields();
    this.dynamicRebuildMsThisStep = this.now() - startedAt;
    this.dynamicRebuildCountThisStep = this.uniqueNavigators.length;
    this.lastDynamicRebuildStep = this.stepCount;
  }

  private rebuildDynamicFlowFields(): void {
    if (!this.config.dynamicRouting) return;
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
    for (const navigator of this.uniqueNavigators) {
      navigator.rebuildDynamic(this.crowdField, options);
    }
  }

  private dynamicRebuildInterval(): number {
    return this.config.dynamicRouting ? Math.max(1, Math.trunc(this.config.dynamicFlowRebuildInterval)) : 0;
  }

  protected publishFieldDensity(state: AgentBuffer): void {
    const pressureThreshold = this.effectivePressureThreshold();
    for (let agent = 0; agent < state.count; agent += 1) {
      this.density[agent] = state.active[agent] === 1
        ? this.crowdField.sampleDensity(state.x[agent]!, state.y[agent]!) / pressureThreshold
        : 0;
    }
  }

  protected effectivePressureThreshold(): number {
    const radiusScale = 3.2 / Math.max(EPSILON, this.config.agentRadius);
    const cellScale = this.config.crowdFieldCellSize / 24;
    return Math.max(
      EPSILON,
      this.config.pressureThreshold * radiusScale * radiusScale * cellScale * cellScale,
    );
  }

  protected clearWorkingState(): void {
    this.desiredVelocityX.fill(0);
    this.desiredVelocityY.fill(0);
    this.solvedVelocityX.fill(0);
    this.solvedVelocityY.fill(0);
    this.density.fill(0);
    this.recovery.fill(0);
    this.overlapFlags.fill(0);
  }
}
