import { AgentBuffer } from './agent-state';
import { clamp, distanceSquared } from './math';
import {
  circleOverlapsRect,
  distanceSquaredToRect,
  segmentDistanceSquaredToRect,
  SweptCircleStaticIntegrator,
  type SweptCircleSlideOutput,
} from './obstacle-collision';
import { computeArrivalSlot } from './arrival-slots';
import { PriorityVelocitySolver } from './priority-velocity-solver';
import { SeededRandom } from './random';
import type { Rect, ScenarioDefinition, SimulationConfig, StepMetrics, Vec2 } from './types';
import { FlowField } from '../algorithms/flow-field/flow-field';
import {
  LocalMovementSolver,
  type LocalMovementInput,
  type LocalMovementOutput,
  type LocalSteeringIntent,
} from '../algorithms/steering/local-movement-solver';
import { ReciprocalVelocitySolver } from '../algorithms/steering/reciprocal-velocity-solver';
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
  backwardCount: 0,
  strongBackwardCount: 0,
  wallOverlapCount: 0,
  averageVelocityDelta: 0,
  maxVelocityDelta: 0,
  averageAcceleration: 0,
  maxAcceleration: 0,
  averageJerk: 0,
  maxJerk: 0,
  hardStopCount: 0,
  emergencyStopCount: 0,
  stopMoveStopCount: 0,
  sideSwitchCount: 0,
  longAdjacentStopCount: 0,
  reservationLimitedCount: 0,
  reservationStoppedCount: 0,
  maxReservationVelocityChange: 0,
  reciprocalConstraintCount: 0,
  reciprocalProjectionRepairCount: 0,
};

const FLOW_LANE_STEP = 0.6180339887498949;
const UINT32_RANGE = 0x1_0000_0000;
// Keep physical endpoints just outside the reporting contact band so exact
// AABB tangency cannot become a persistent all-directions-blocked state.
const STATIC_CONTACT_SKIN = 0.06;

export class CrowdSimulation {
  state: AgentBuffer;
  private nextState: AgentBuffer;
  readonly navigator: FlowField;
  readonly neighbors: SpatialHash;
  readonly movement = new LocalMovementSolver();
  private readonly reciprocalVelocitySolver = new ReciprocalVelocitySolver();
  scenario: ScenarioDefinition;
  goal: Vec2;
  stepCount = 0;
  metrics: StepMetrics = { ...ZERO_METRICS };
  overlapFlags: Uint8Array;
  unspawnedCount = 0;

  private queryAgent = 0;
  private queryRadius = 0;
  private neighborCount = 0;
  private candidateChecks = 0;
  private overlapPairs = 0;
  private readonly neighborIndices: Int32Array;
  private readonly neighborOffsets: Int32Array;
  private cachedNeighborIndices: Int32Array;
  private cachedNeighborCount = 0;
  private cachedTotalNeighbors = 0;
  private cachedMaxNeighbors = 0;
  private readonly preferredX: Float64Array;
  private readonly preferredY: Float64Array;
  private readonly plannedVelocityX: Float64Array;
  private readonly plannedVelocityY: Float64Array;
  private readonly desiredSpeed: Float64Array;
  private readonly intentDirectionX: Float64Array;
  private readonly intentDirectionY: Float64Array;
  private readonly intentVelocityX: Float64Array;
  private readonly intentVelocityY: Float64Array;
  private readonly intentBlocked: Uint8Array;
  private readonly intentForwardClearance: Float64Array;
  private readonly resolvedVelocityX: Float64Array;
  private readonly resolvedVelocityY: Float64Array;
  private readonly reconciledVelocityX: Float64Array;
  private readonly reconciledVelocityY: Float64Array;
  private readonly routeCost: Float64Array;
  private readonly emergencyStops: Uint8Array;
  private readonly activeThisStep: Uint8Array;
  private readonly arrivalSlotX: Float64Array;
  private readonly arrivalSlotY: Float64Array;
  private readonly formationUnitX: Float64Array;
  private readonly formationUnitY: Float64Array;
  private readonly flowDirection = { x: 0, y: 0 };
  private readonly arrivalSlot = { x: 0, y: 0 };
  private readonly movementIntent: LocalSteeringIntent = {
    directionX: 1,
    directionY: 0,
    avoidanceSide: 1,
    avoidanceHold: 0,
    blocked: false,
    forwardClearance: Number.POSITIVE_INFINITY,
  };
  private readonly movementOutput: LocalMovementOutput = {
    x: 0,
    y: 0,
    avoidanceSide: 1,
    avoidanceHold: 0,
    emergencyStop: false,
  };
  private readonly movementInput: LocalMovementInput;
  private readonly priorityVelocitySolver = new PriorityVelocitySolver();
  private readonly staticIntegrator = new SweptCircleStaticIntegrator();
  private readonly staticIntegration: SweptCircleSlideOutput = {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    normalX: 0,
    normalY: 0,
    contactCount: 0,
    startedOverlapping: false,
    exhausted: false,
  };
  private stoppedState: AgentBuffer | null = null;
  private stoppedAgent = 0;
  private stoppedNeighborFound = false;
  private readonly visitCandidate = (candidate: number): void => this.accumulateCandidate(candidate);
  private readonly visitStoppedCandidate = (candidate: number): void => this.findStoppedCandidate(candidate);

  constructor(public config: SimulationConfig, scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.goal = { ...scenario.goal };
    this.state = new AgentBuffer(config.agentCount);
    this.nextState = new AgentBuffer(config.agentCount);
    this.navigator = new FlowField(config.width, config.height, config.cellSize);
    this.neighbors = new SpatialHash(config.width, config.height, config.neighborRadius, config.agentCount);
    this.neighborIndices = new Int32Array(config.agentCount);
    this.neighborOffsets = new Int32Array(config.agentCount + 1);
    this.cachedNeighborIndices = new Int32Array(Math.max(1, config.agentCount * 64));
    this.preferredX = new Float64Array(config.agentCount);
    this.preferredY = new Float64Array(config.agentCount);
    this.plannedVelocityX = new Float64Array(config.agentCount);
    this.plannedVelocityY = new Float64Array(config.agentCount);
    this.desiredSpeed = new Float64Array(config.agentCount);
    this.intentDirectionX = new Float64Array(config.agentCount);
    this.intentDirectionY = new Float64Array(config.agentCount);
    this.intentVelocityX = new Float64Array(config.agentCount);
    this.intentVelocityY = new Float64Array(config.agentCount);
    this.intentBlocked = new Uint8Array(config.agentCount);
    this.intentForwardClearance = new Float64Array(config.agentCount);
    this.resolvedVelocityX = new Float64Array(config.agentCount);
    this.resolvedVelocityY = new Float64Array(config.agentCount);
    this.reconciledVelocityX = new Float64Array(config.agentCount);
    this.reconciledVelocityY = new Float64Array(config.agentCount);
    this.routeCost = new Float64Array(config.agentCount);
    this.emergencyStops = new Uint8Array(config.agentCount);
    this.activeThisStep = new Uint8Array(config.agentCount);
    this.arrivalSlotX = new Float64Array(config.agentCount);
    this.arrivalSlotY = new Float64Array(config.agentCount);
    this.formationUnitX = new Float64Array(config.agentCount);
    this.formationUnitY = new Float64Array(config.agentCount);
    this.overlapFlags = new Uint8Array(config.agentCount);
    this.movementInput = {
      agentIndex: 0,
      positionX: 0,
      positionY: 0,
      velocityX: 0,
      velocityY: 0,
      preferredX: 1,
      preferredY: 0,
      distanceToGoal: 0,
      maxSpeed: config.maxSpeed,
      maxAcceleration: config.maxAcceleration,
      maxTurnRate: config.maxTurnRate,
      fixedDelta: config.fixedDelta,
      arrivalSlowRadius: config.arrivalSlowRadius,
      agentRadius: config.agentRadius,
      agentGap: config.agentGap,
      wallMargin: config.wallMargin,
      avoidanceHorizon: config.avoidanceHorizon,
      avoidanceBiasSeconds: config.avoidanceBiasSeconds,
      avoidanceSide: 1,
      avoidanceHold: 0,
      neighborCount: 0,
      neighborIndices: this.neighborIndices,
      neighborX: this.state.x,
      neighborY: this.state.y,
      neighborVelocityX: this.state.vx,
      neighborVelocityY: this.state.vy,
      neighborIntentVelocityX: this.plannedVelocityX,
      neighborIntentVelocityY: this.plannedVelocityY,
      selfIntentVelocityX: 0,
      selfIntentVelocityY: 0,
      obstacles: scenario.obstacles,
      worldWidth: config.width,
      worldHeight: config.height,
      obstacleLookAhead: config.avoidanceHorizon,
    };
    this.reset();
  }

  reset(): void {
    if (this.config.agentCount > this.activeThisStep.length) {
      throw new RangeError('Increasing agentCount requires constructing a new CrowdSimulation.');
    }
    const random = new SeededRandom(this.config.seed);
    this.goal = { ...this.scenario.goal };
    this.navigator.rebuild(
      this.goal,
      this.scenario.obstacles,
      this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN,
    );
    const positions = this.createSpawnPositions(random);
    this.unspawnedCount = Math.max(0, this.config.agentCount - positions.length);
    this.state = new AgentBuffer(positions.length);
    this.nextState = new AgentBuffer(positions.length);
    this.overlapFlags = new Uint8Array(positions.length);
    for (let i = 0; i < positions.length; i += 1) {
      this.state.x[i] = positions[i]!.x;
      this.state.y[i] = positions[i]!.y;
      this.state.active[i] = 1;
      this.state.avoidanceSide[i] = 0;
      this.state.motionPhase[i] = 1;
      this.formationUnitX[i] = clamp(
        (positions[i]!.x - this.scenario.spawn.x) / Math.max(this.scenario.spawn.width, 1e-9),
        0,
        1,
      );
      this.formationUnitY[i] = clamp(
        (positions[i]!.y - this.scenario.spawn.y) / Math.max(this.scenario.spawn.height, 1e-9),
        0,
        1,
      );
    }
    this.rebuildArrivalSlots();
    this.nextState.copyFrom(this.state);
    this.stepCount = 0;
    this.metrics = { ...ZERO_METRICS, activeCount: this.state.count };
  }

  changeScenario(scenario: ScenarioDefinition): void {
    this.scenario = scenario;
    this.reset();
  }

  setGoal(x: number, y: number): void {
    this.goal.x = clamp(x, 0, this.config.width - 0.001);
    this.goal.y = clamp(y, 0, this.config.height - 0.001);
    this.navigator.rebuild(
      this.goal,
      this.scenario.obstacles,
      this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN,
    );
    this.state.active.fill(1);
    this.state.stalledFor.fill(0);
    this.state.adjacentStoppedFor.fill(0);
    this.state.motionPhase.fill(1);
    this.state.accelerationX.fill(0);
    this.state.accelerationY.fill(0);
    this.state.intentX.fill(0);
    this.state.intentY.fill(0);
    this.state.avoidanceSide.fill(0);
    this.state.avoidanceHold.fill(0);
    this.rebuildArrivalSlots();
    this.nextState.copyFrom(this.state);
    this.overlapFlags.fill(0);
    this.metrics = { ...ZERO_METRICS, activeCount: this.state.count };
  }

  step(): void {
    const current = this.state;
    const next = this.nextState;
    const goalRadiusSquared = this.config.goalRadius * this.config.goalRadius;
    const brakingDistance = this.config.maxAcceleration <= 0
      ? this.config.neighborRadius
      : (this.config.maxSpeed * this.config.maxSpeed) / (2 * this.config.maxAcceleration);
    this.queryRadius = Math.max(
      this.config.neighborRadius,
      this.config.agentRadius * 2 + this.config.agentGap + brakingDistance,
    );
    const obstacleLookAhead = Math.max(
      this.config.fixedDelta,
      this.queryRadius / Math.max(this.config.maxSpeed, 1),
      this.config.avoidanceHorizon,
      this.config.maxAcceleration > 0
        ? this.config.maxSpeed / this.config.maxAcceleration + 0.25
        : this.config.avoidanceHorizon,
    );
    next.copyFrom(current);
    this.activeThisStep.fill(0);
    this.activeThisStep.set(current.active);
    for (let i = 0; i < current.count; i += 1) {
      if (current.active[i] !== 1) continue;
      if (distanceSquared(current.x[i]!, current.y[i]!, this.goal.x, this.goal.y) > goalRadiusSquared) continue;
      this.activeThisStep[i] = 0;
      next.active[i] = 0;
      next.vx[i] = 0;
      next.vy[i] = 0;
      next.intentX[i] = 0;
      next.intentY[i] = 0;
      next.accelerationX[i] = 0;
      next.accelerationY[i] = 0;
      next.stalledFor[i] = 0;
      next.adjacentStoppedFor[i] = 0;
    }
    this.planPreferredVelocities(current);
    this.neighbors.rebuild(current.x, current.y, this.activeThisStep);
    this.candidateChecks = 0;
    this.buildNeighborCache(current);
    this.overlapPairs = 0;
    this.overlapFlags.fill(0);
    const totalNeighbors = this.cachedTotalNeighbors;
    const maxNeighbors = this.cachedMaxNeighbors;
    this.emergencyStops.fill(0);

    // Phase A: calculate every steering intent from the same immutable snapshot.
    for (let i = 0; i < current.count; i += 1) {
      if (this.activeThisStep[i] !== 1) {
        this.intentDirectionX[i] = 0;
        this.intentDirectionY[i] = 0;
        this.intentVelocityX[i] = 0;
        this.intentVelocityY[i] = 0;
        this.intentBlocked[i] = 0;
        this.intentForwardClearance[i] = Number.POSITIVE_INFINITY;
        continue;
      }
      this.loadCachedNeighbors(i);
      this.prepareMovementInput(i, current, obstacleLookAhead, this.plannedVelocityX, this.plannedVelocityY);
      this.movement.planIntent(this.movementInput, this.movementIntent);
      this.intentDirectionX[i] = this.movementIntent.directionX;
      this.intentDirectionY[i] = this.movementIntent.directionY;
      const plannedSpeed = Math.hypot(this.plannedVelocityX[i]!, this.plannedVelocityY[i]!);
      this.intentVelocityX[i] = this.movementIntent.directionX * plannedSpeed;
      this.intentVelocityY[i] = this.movementIntent.directionY * plannedSpeed;
      this.intentBlocked[i] = this.movementIntent.blocked ? 1 : 0;
      this.intentForwardClearance[i] = this.movementIntent.forwardClearance;
      next.intentX[i] = this.movementIntent.directionX;
      next.intentY[i] = this.movementIntent.directionY;
      next.avoidanceSide[i] = this.movementIntent.avoidanceSide;
      next.avoidanceHold[i] = this.movementIntent.avoidanceHold;
    }

    // Phase B: build a static-safe local proposal, then solve all dynamic agent
    // constraints in velocity space. The ORCA-style solver works inside each
    // agent's acceleration disk; no position has been integrated or corrected.
    this.resolveVelocityPass(
      current, next, obstacleLookAhead,
      this.intentVelocityX, this.intentVelocityY,
      this.reconciledVelocityX, this.reconciledVelocityY,
    );
    const reciprocal = this.reciprocalVelocitySolver.solve({
      current,
      active: this.activeThisStep,
      preferredVelocityX: this.reconciledVelocityX,
      preferredVelocityY: this.reconciledVelocityY,
      neighborOffsets: this.neighborOffsets,
      neighborIndices: this.cachedNeighborIndices,
      agentRadius: this.config.agentRadius,
      separationPadding: Math.min(0.35, Math.max(0, this.config.agentGap)),
      maxSpeed: this.config.maxSpeed,
      maxAcceleration: this.config.maxAcceleration,
      fixedDelta: this.config.fixedDelta,
      timeHorizon: Math.max(2, this.config.avoidanceHorizon),
      outputVelocityX: this.resolvedVelocityX,
      outputVelocityY: this.resolvedVelocityY,
    });
    const reciprocalConstraintCount = reciprocal.constraintCount;
    const reciprocalProjectionRepairCount = reciprocal.projectionRepairAgents;

    // Phase C: apply the dynamic agreement once, then resolve exact static
    // contacts. Re-running the reciprocal projection after a wall slide uses
    // the same beginning-of-step velocity centre and can contradict the first
    // agreement, producing artificial stop/go pulses at corridor entrances.
    this.integrateStaticProposals(
      current,
      next,
      this.resolvedVelocityX,
      this.resolvedVelocityY,
    );

    const reservation = this.priorityVelocitySolver.solve({
      current,
      next,
      active: this.activeThisStep,
      preferredDirectionX: this.preferredX,
      preferredDirectionY: this.preferredY,
      routeCost: this.routeCost,
      neighborOffsets: this.neighborOffsets,
      neighborIndices: this.cachedNeighborIndices,
      agentRadius: this.config.agentRadius,
      fixedDelta: this.config.fixedDelta,
      overlapFlags: this.overlapFlags,
    });
    this.candidateChecks += reservation.candidateChecks;
    this.overlapPairs = reservation.remainingOverlapPairs;

    // The reserved displacement is the final kinematic motion authority. Keep
    // persisted velocity equal to actual displacement so a yielded proposal
    // cannot repeat next frame as hidden velocity.
    for (let i = 0; i < current.count; i += 1) {
      if (this.activeThisStep[i] !== 1) continue;
      const actualVelocityX = (next.x[i]! - current.x[i]!) / this.config.fixedDelta;
      const actualVelocityY = (next.y[i]! - current.y[i]!) / this.config.fixedDelta;
      if (Math.hypot(
        actualVelocityX - current.vx[i]!,
        actualVelocityY - current.vy[i]!,
      ) > this.config.maxAcceleration * this.config.fixedDelta + 1e-9) {
        this.emergencyStops[i] = 1;
      }
      next.vx[i] = actualVelocityX;
      next.vy[i] = actualVelocityY;
    }

    // Phase D: update persistent state and aggregate smoothness/safety metrics.
    let activeCount = 0;
    let arrivedCount = 0;
    let stalledCount = 0;
    let totalSpeed = 0;
    let backwardCount = 0;
    let strongBackwardCount = 0;
    let wallOverlapCount = 0;
    let velocityDeltaSum = 0;
    let maximumVelocityDelta = 0;
    let accelerationSum = 0;
    let maximumAcceleration = 0;
    let jerkSum = 0;
    let maximumJerk = 0;
    let hardStopCount = 0;
    let emergencyStopCount = 0;
    let stopMoveStopCount = 0;
    let sideSwitchCount = 0;
    for (let i = 0; i < next.count; i += 1) {
      if (next.active[i] !== 1) {
        arrivedCount += 1;
        continue;
      }
      activeCount += 1;
      const speed = Math.hypot(next.vx[i]!, next.vy[i]!);
      const previousSpeed = Math.hypot(current.vx[i]!, current.vy[i]!);
      const deltaX = next.vx[i]! - current.vx[i]!;
      const deltaY = next.vy[i]! - current.vy[i]!;
      const velocityDelta = Math.hypot(deltaX, deltaY);
      const accelerationX = deltaX / this.config.fixedDelta;
      const accelerationY = deltaY / this.config.fixedDelta;
      const acceleration = Math.hypot(accelerationX, accelerationY);
      const jerk = Math.hypot(
        accelerationX - current.accelerationX[i]!,
        accelerationY - current.accelerationY[i]!,
      ) / this.config.fixedDelta;
      next.accelerationX[i] = accelerationX;
      next.accelerationY[i] = accelerationY;
      totalSpeed += speed;
      velocityDeltaSum += velocityDelta;
      maximumVelocityDelta = Math.max(maximumVelocityDelta, velocityDelta);
      accelerationSum += acceleration;
      maximumAcceleration = Math.max(maximumAcceleration, acceleration);
      jerkSum += jerk;
      maximumJerk = Math.max(maximumJerk, jerk);
      if (previousSpeed >= this.config.maxSpeed * 0.5 && speed < this.config.maxSpeed * 0.08) hardStopCount += 1;
      emergencyStopCount += this.emergencyStops[i]!;
      let motionPhase = current.motionPhase[i] || 1;
      if (motionPhase === 1 && speed >= this.config.maxSpeed * 0.35) motionPhase = 2;
      if (motionPhase === 2 && speed < this.config.maxSpeed * 0.08) {
        stopMoveStopCount += 1;
        motionPhase = 1;
      }
      next.motionPhase[i] = motionPhase;
      if (
        current.avoidanceSide[i] !== 0
        && next.avoidanceSide[i] !== 0
        && current.avoidanceSide[i] !== next.avoidanceSide[i]
      ) sideSwitchCount += 1;
      next.stalledFor[i] = speed < this.config.maxSpeed * 0.08
        ? current.stalledFor[i]! + this.config.fixedDelta
        : 0;
      if (next.stalledFor[i]! >= this.config.stallSeconds) stalledCount += 1;
      const progressSpeed = next.vx[i]! * this.preferredX[i]! + next.vy[i]! * this.preferredY[i]!;
      if (progressSpeed < -1e-6) backwardCount += 1;
      if (progressSpeed < -this.config.maxSpeed * 0.25) strongBackwardCount += 1;
      if (
        next.x[i]! < this.config.agentRadius - 1e-9
        || next.y[i]! < this.config.agentRadius - 1e-9
        || next.x[i]! > this.config.width - this.config.agentRadius + 1e-9
        || next.y[i]! > this.config.height - this.config.agentRadius + 1e-9
      ) {
        wallOverlapCount += 1;
      } else {
        for (const obstacle of this.scenario.obstacles) {
          if (!circleOverlapsRect(next.x[i]!, next.y[i]!, this.config.agentRadius, obstacle)) continue;
          wallOverlapCount += 1;
          break;
        }
      }
    }
    let longAdjacentStopCount = 0;
    const stoppedThreshold = this.config.maxSpeed * 0.08;
    const adjacencyRadius = this.config.agentRadius * 2 + this.config.agentGap + 0.25;
    this.neighbors.rebuild(next.x, next.y, next.active);
    this.stoppedState = next;
    for (let i = 0; i < next.count; i += 1) {
      if (next.active[i] !== 1 || Math.hypot(next.vx[i]!, next.vy[i]!) >= stoppedThreshold) {
        next.adjacentStoppedFor[i] = 0;
        continue;
      }
      this.stoppedAgent = i;
      this.stoppedNeighborFound = false;
      this.neighbors.forEachCandidate(next.x[i]!, next.y[i]!, adjacencyRadius, this.visitStoppedCandidate);
      next.adjacentStoppedFor[i] = this.stoppedNeighborFound
        ? current.adjacentStoppedFor[i]! + this.config.fixedDelta
        : 0;
      if (next.adjacentStoppedFor[i]! >= 1) longAdjacentStopCount += 1;
    }
    this.stoppedState = null;
    this.state = next;
    this.nextState = current;
    this.stepCount += 1;
    this.metrics = {
      activeCount,
      arrivedCount,
      arrivalRate: current.count === 0 ? 1 : arrivedCount / current.count,
      averageSpeed: activeCount === 0 ? 0 : totalSpeed / activeCount,
      overlapPairs: this.overlapPairs,
      stalledCount,
      averageNeighbors: activeCount === 0 ? 0 : totalNeighbors / activeCount,
      maxNeighbors,
      candidateChecks: this.candidateChecks,
      backwardCount,
      strongBackwardCount,
      wallOverlapCount,
      averageVelocityDelta: activeCount === 0 ? 0 : velocityDeltaSum / activeCount,
      maxVelocityDelta: maximumVelocityDelta,
      averageAcceleration: activeCount === 0 ? 0 : accelerationSum / activeCount,
      maxAcceleration: maximumAcceleration,
      averageJerk: activeCount === 0 ? 0 : jerkSum / activeCount,
      maxJerk: maximumJerk,
      hardStopCount,
      emergencyStopCount,
      stopMoveStopCount,
      sideSwitchCount,
      longAdjacentStopCount,
      reservationLimitedCount: reservation.limitedAgents,
      reservationStoppedCount: reservation.stoppedAgents,
      maxReservationVelocityChange: reservation.maximumVelocityChange,
      reciprocalConstraintCount,
      reciprocalProjectionRepairCount,
    };
  }

  stateHash(): string {
    let hash = 0x811c9dc5;
    const mix = (value: number): void => {
      hash ^= value | 0;
      hash = Math.imul(hash, 0x01000193);
    };
    mix(this.stepCount);
    mix(this.unspawnedCount);
    mix(Math.round(this.goal.x * 1000));
    mix(Math.round(this.goal.y * 1000));
    for (let i = 0; i < this.state.count; i += 1) {
      mix(Math.round(this.state.x[i]! * 1000));
      mix(Math.round(this.state.y[i]! * 1000));
      mix(Math.round(this.state.vx[i]! * 1000));
      mix(Math.round(this.state.vy[i]! * 1000));
      mix(this.state.active[i]!);
      mix(Math.round(this.state.stalledFor[i]! * 1000));
      mix(this.state.avoidanceSide[i]!);
      mix(Math.round(this.state.avoidanceHold[i]! * 1000));
      mix(Math.round(this.state.intentX[i]! * 1_000_000));
      mix(Math.round(this.state.intentY[i]! * 1_000_000));
      mix(Math.round(this.state.accelerationX[i]! * 1000));
      mix(Math.round(this.state.accelerationY[i]! * 1000));
      mix(Math.round(this.state.adjacentStoppedFor[i]! * 1000));
      mix(this.state.motionPhase[i]!);
      mix(Math.round(this.arrivalSlotX[i]! * 1000));
      mix(Math.round(this.arrivalSlotY[i]! * 1000));
      mix(Math.round(this.formationUnitX[i]! * 1_000_000));
      mix(Math.round(this.formationUnitY[i]! * 1_000_000));
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private buildNeighborCache(current: AgentBuffer): void {
    this.cachedNeighborCount = 0;
    this.cachedTotalNeighbors = 0;
    this.cachedMaxNeighbors = 0;
    for (let agent = 0; agent < current.count; agent += 1) {
      this.neighborOffsets[agent] = this.cachedNeighborCount;
      if (this.activeThisStep[agent] !== 1) continue;
      this.queryAgent = agent;
      this.neighbors.forEachCandidate(
        current.x[agent]!,
        current.y[agent]!,
        this.queryRadius,
        this.visitCandidate,
      );
      const start = this.neighborOffsets[agent]!;
      this.sortCachedNeighborRange(start, this.cachedNeighborCount);
      const count = this.cachedNeighborCount - start;
      this.cachedTotalNeighbors += count;
      this.cachedMaxNeighbors = Math.max(this.cachedMaxNeighbors, count);
    }
    this.neighborOffsets[current.count] = this.cachedNeighborCount;
  }

  private loadCachedNeighbors(agent: number): void {
    const start = this.neighborOffsets[agent]!;
    const end = this.neighborOffsets[agent + 1]!;
    this.neighborCount = end - start;
    for (let offset = 0; offset < this.neighborCount; offset += 1) {
      this.neighborIndices[offset] = this.cachedNeighborIndices[start + offset]!;
    }
  }

  private accumulateCandidate(candidate: number): void {
    if (candidate === this.queryAgent || this.activeThisStep[candidate] !== 1) return;
    this.candidateChecks += 1;
    const dx = this.state.x[this.queryAgent]! - this.state.x[candidate]!;
    const dy = this.state.y[this.queryAgent]! - this.state.y[candidate]!;
    const squared = dx * dx + dy * dy;
    if (squared > this.queryRadius * this.queryRadius) return;
    if (this.cachedNeighborCount >= this.cachedNeighborIndices.length) {
      const grown = new Int32Array(Math.max(1, this.cachedNeighborIndices.length * 2));
      grown.set(this.cachedNeighborIndices);
      this.cachedNeighborIndices = grown;
    }
    this.cachedNeighborIndices[this.cachedNeighborCount] = candidate;
    this.cachedNeighborCount += 1;
  }

  private sortCachedNeighborRange(start: number, end: number): void {
    for (let index = start + 1; index < end; index += 1) {
      const value = this.cachedNeighborIndices[index]!;
      let target = index - 1;
      while (target >= start && this.cachedNeighborIndices[target]! > value) {
        this.cachedNeighborIndices[target + 1] = this.cachedNeighborIndices[target]!;
        target -= 1;
      }
      this.cachedNeighborIndices[target + 1] = value;
    }
  }

  private prepareMovementInput(
    agent: number,
    current: AgentBuffer,
    obstacleLookAhead: number,
    neighborIntentVelocityX: Float64Array,
    neighborIntentVelocityY: Float64Array,
  ): void {
    const input = this.movementInput;
    input.agentIndex = agent;
    input.positionX = current.x[agent]!;
    input.positionY = current.y[agent]!;
    input.velocityX = current.vx[agent]!;
    input.velocityY = current.vy[agent]!;
    input.preferredX = this.preferredX[agent]!;
    input.preferredY = this.preferredY[agent]!;
    input.distanceToGoal = Math.sqrt(distanceSquared(
      current.x[agent]!,
      current.y[agent]!,
      this.goal.x,
      this.goal.y,
    ));
    input.maxSpeed = this.config.maxSpeed;
    input.maxAcceleration = this.config.maxAcceleration;
    input.maxTurnRate = this.config.maxTurnRate;
    input.fixedDelta = this.config.fixedDelta;
    input.arrivalSlowRadius = Math.max(this.config.arrivalSlowRadius, this.config.goalRadius * 1.5);
    input.agentRadius = this.config.agentRadius;
    input.agentGap = this.config.agentGap;
    input.wallMargin = this.config.wallMargin + STATIC_CONTACT_SKIN;
    input.avoidanceHorizon = this.config.avoidanceHorizon;
    input.avoidanceBiasSeconds = this.config.avoidanceBiasSeconds;
    input.avoidanceSide = current.avoidanceSide[agent]!;
    input.avoidanceHold = current.avoidanceHold[agent]!;
    input.neighborCount = this.neighborCount;
    input.neighborX = current.x;
    input.neighborY = current.y;
    input.neighborVelocityX = current.vx;
    input.neighborVelocityY = current.vy;
    input.neighborIntentVelocityX = neighborIntentVelocityX;
    input.neighborIntentVelocityY = neighborIntentVelocityY;
    input.selfIntentVelocityX = neighborIntentVelocityX[agent]!;
    input.selfIntentVelocityY = neighborIntentVelocityY[agent]!;
    input.obstacles = this.scenario.obstacles;
    input.worldWidth = this.config.width;
    input.worldHeight = this.config.height;
    input.obstacleLookAhead = obstacleLookAhead;
  }

  private integrateStaticProposals(
    current: AgentBuffer,
    next: AgentBuffer,
    velocityX: Float64Array,
    velocityY: Float64Array,
  ): void {
    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      const x = current.x[agent]!;
      const y = current.y[agent]!;
      let vx = velocityX[agent]!;
      let vy = velocityY[agent]!;
      const preferredX = this.preferredX[agent]!;
      const preferredY = this.preferredY[agent]!;
      const reverseSpeed = vx * preferredX + vy * preferredY;
      if (reverseSpeed < 0) {
        vx -= preferredX * reverseSpeed;
        vy -= preferredY * reverseSpeed;
      }
      this.staticIntegrator.integrate(
        x,
        y,
        vx,
        vy,
        this.config.fixedDelta,
        clearance,
        this.config.width,
        this.config.height,
        this.scenario.obstacles,
        4,
        this.staticIntegration,
      );
      let nx = this.staticIntegration.x;
      let ny = this.staticIntegration.y;
      const reverseDisplacement = (nx - x) * preferredX + (ny - y) * preferredY;
      if (reverseDisplacement < 0) {
        const safeX = nx - preferredX * reverseDisplacement;
        const safeY = ny - preferredY * reverseDisplacement;
        let safe = safeX >= clearance && safeY >= clearance
          && safeX <= this.config.width - clearance
          && safeY <= this.config.height - clearance;
        for (const obstacle of this.scenario.obstacles) {
          if (circleOverlapsRect(safeX, safeY, clearance, obstacle)) safe = false;
        }
        nx = safe ? safeX : x;
        ny = safe ? safeY : y;
        if (!safe) this.emergencyStops[agent] = 1;
      }
      vx = (nx - x) / this.config.fixedDelta;
      vy = (ny - y) / this.config.fixedDelta;
      const staticVelocityDelta = Math.hypot(
        vx - current.vx[agent]!,
        vy - current.vy[agent]!,
      );
      if (
        this.staticIntegration.startedOverlapping
        || this.staticIntegration.exhausted
        || staticVelocityDelta > this.config.maxAcceleration * this.config.fixedDelta + 1e-9
      ) this.emergencyStops[agent] = 1;
      next.x[agent] = nx;
      next.y[agent] = ny;
      next.vx[agent] = vx;
      next.vy[agent] = vy;
    }
  }

  private resolveVelocityPass(
    current: AgentBuffer,
    next: AgentBuffer,
    obstacleLookAhead: number,
    snapshotVelocityX: Float64Array,
    snapshotVelocityY: Float64Array,
    outputVelocityX: Float64Array,
    outputVelocityY: Float64Array,
  ): void {
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) {
        outputVelocityX[agent] = 0;
        outputVelocityY[agent] = 0;
        continue;
      }
      this.loadCachedNeighbors(agent);
      this.prepareMovementInput(
        agent,
        current,
        obstacleLookAhead,
        snapshotVelocityX,
        snapshotVelocityY,
      );
      this.movementIntent.directionX = this.intentDirectionX[agent]!;
      this.movementIntent.directionY = this.intentDirectionY[agent]!;
      this.movementIntent.avoidanceSide = next.avoidanceSide[agent]!;
      this.movementIntent.avoidanceHold = next.avoidanceHold[agent]!;
      this.movementIntent.blocked = this.intentBlocked[agent] === 1;
      this.movementIntent.forwardClearance = this.intentForwardClearance[agent]!;
      this.movement.resolveVelocity(this.movementInput, this.movementIntent, this.movementOutput);
      outputVelocityX[agent] = this.movementOutput.x;
      outputVelocityY[agent] = this.movementOutput.y;
      if (this.movementOutput.emergencyStop === true) this.emergencyStops[agent] = 1;
    }
  }

  private findStoppedCandidate(candidate: number): void {
    const state = this.stoppedState;
    if (!state || candidate === this.stoppedAgent || state.active[candidate] !== 1) return;
    this.candidateChecks += 1;
    const radius = this.config.agentRadius * 2 + this.config.agentGap + 0.25;
    const dx = state.x[this.stoppedAgent]! - state.x[candidate]!;
    const dy = state.y[this.stoppedAgent]! - state.y[candidate]!;
    if (dx * dx + dy * dy > radius * radius) return;
    if (Math.hypot(state.vx[candidate]!, state.vy[candidate]!) >= this.config.maxSpeed * 0.08) return;
    this.stoppedNeighborFound = true;
  }

  private planPreferredVelocities(current: AgentBuffer): void {
    const maximumDelta = this.config.maxAcceleration * this.config.fixedDelta;
    const approachX = this.goal.x - (this.scenario.spawn.x + this.scenario.spawn.width * 0.5);
    const approachY = this.goal.y - (this.scenario.spawn.y + this.scenario.spawn.height * 0.5);
    const approachLength = Math.hypot(approachX, approachY);
    const approachUnitX = approachLength > 1e-9 ? approachX / approachLength : 1;
    const approachUnitY = approachLength > 1e-9 ? approachY / approachLength : 0;
    for (let i = 0; i < current.count; i += 1) {
      if (this.activeThisStep[i] !== 1) {
        this.preferredX[i] = 0;
        this.preferredY[i] = 0;
        this.plannedVelocityX[i] = 0;
        this.plannedVelocityY[i] = 0;
        this.desiredSpeed[i] = 0;
        this.routeCost[i] = Number.POSITIVE_INFINITY;
        continue;
      }
      this.routeCost[i] = this.navigator.sampleCost(current.x[i]!, current.y[i]!);
      this.navigator.sampleDirection(current.x[i]!, current.y[i]!, this.flowDirection);
      this.applyCorridorDispersion(i, current.x[i]!, current.y[i]!);
      const distanceToGoal = Math.sqrt(distanceSquared(current.x[i]!, current.y[i]!, this.goal.x, this.goal.y));
      const arrivalRadius = Math.max(this.config.arrivalSlowRadius, this.config.goalRadius * 1.5);
      const slotX = this.arrivalSlotX[i]! - current.x[i]!;
      const slotY = this.arrivalSlotY[i]! - current.y[i]!;
      const slotLength = Math.hypot(slotX, slotY);
      const slotBlend = distanceToGoal < arrivalRadius * 1.5
        && slotLength > 1e-9
        && this.isArrivalSegmentSafe(current.x[i]!, current.y[i]!, this.arrivalSlotX[i]!, this.arrivalSlotY[i]!)
        ? clamp((arrivalRadius * 1.5 - distanceToGoal) / Math.max(arrivalRadius, 1e-9), 0, 0.25)
        : 0;
      let preferredX = this.flowDirection.x * (1 - slotBlend) + (slotX / Math.max(slotLength, 1e-9)) * slotBlend;
      let preferredY = this.flowDirection.y * (1 - slotBlend) + (slotY / Math.max(slotLength, 1e-9)) * slotBlend;
      const preferredLength = Math.hypot(preferredX, preferredY);
      if (preferredLength <= 1e-9) {
        preferredX = slotLength > 1e-9 ? slotX / slotLength : 1;
        preferredY = slotLength > 1e-9 ? slotY / slotLength : 0;
      } else {
        preferredX /= preferredLength;
        preferredY /= preferredLength;
      }
      const reverseApproach = preferredX * approachUnitX + preferredY * approachUnitY;
      const goalPlaneOffset = (current.x[i]! - this.goal.x) * approachUnitX
        + (current.y[i]! - this.goal.y) * approachUnitY;
      if (goalPlaneOffset <= 0 && reverseApproach < 0) {
        preferredX -= approachUnitX * reverseApproach;
        preferredY -= approachUnitY * reverseApproach;
        const projectedLength = Math.hypot(preferredX, preferredY);
        if (projectedLength > 1e-9) {
          preferredX /= projectedLength;
          preferredY /= projectedLength;
        } else {
          preferredX = approachUnitX;
          preferredY = approachUnitY;
        }
      }
      // Direction changes across the global approach axis are damped through a
      // zero-lateral phase. A packed contact island can be sliding along a wall
      // while an individual lane target has already moved to its other side;
      // instantaneously flipping that member's preference would label the same
      // safe tangent motion as reverse progress and feed a stop-go oscillation.
      const lateralUnitX = -approachUnitY;
      const lateralUnitY = approachUnitX;
      const lateralVelocity = current.vx[i]! * lateralUnitX + current.vy[i]! * lateralUnitY;
      const preferredLateral = preferredX * lateralUnitX + preferredY * lateralUnitY;
      if (lateralVelocity * preferredLateral < -1e-9) {
        preferredX -= lateralUnitX * preferredLateral;
        preferredY -= lateralUnitY * preferredLateral;
        const dampedLength = Math.hypot(preferredX, preferredY);
        if (dampedLength > 1e-9) {
          preferredX /= dampedLength;
          preferredY /= dampedLength;
        } else {
          preferredX = approachUnitX;
          preferredY = approachUnitY;
        }
      }
      this.preferredX[i] = preferredX;
      this.preferredY[i] = preferredY;
      const desiredSpeed = this.config.maxSpeed * Math.min(1, distanceToGoal / Math.max(arrivalRadius, 1e-9));
      this.desiredSpeed[i] = desiredSpeed;
      const targetX = preferredX * desiredSpeed;
      const targetY = preferredY * desiredSpeed;
      const deltaX = targetX - current.vx[i]!;
      const deltaY = targetY - current.vy[i]!;
      const deltaLength = Math.hypot(deltaX, deltaY);
      const scale = deltaLength > maximumDelta && deltaLength > 1e-9 ? maximumDelta / deltaLength : 1;
      let plannedX = current.vx[i]! + deltaX * scale;
      let plannedY = current.vy[i]! + deltaY * scale;
      const reverseSpeed = plannedX * preferredX + plannedY * preferredY;
      if (reverseSpeed < 0) {
        plannedX -= preferredX * reverseSpeed;
        plannedY -= preferredY * reverseSpeed;
      }
      this.plannedVelocityX[i] = plannedX;
      this.plannedVelocityY[i] = plannedY;
    }
  }

  /**
   * Spreads a shortest-path stream across the width of the next axis-aligned
   * portal. Reverse-Dijkstra remains the route authority: its perpendicular
   * component selects which side of a blocking rectangle is reachable. The
   * spawn-order-preserving lateral coordinate then spreads the stream without
   * making agents cross merely to reach a random lane. This is a planning
   * preference only; steering and Phase C still own dynamic and physical
   * non-penetration.
   */
  private applyCorridorDispersion(agent: number, x: number, y: number): void {
    if (this.scenario.obstacles.length === 0) return;
    const toGoalX = this.goal.x - x;
    const toGoalY = this.goal.y - y;
    const horizontal = Math.abs(toGoalX) >= Math.abs(toGoalY);
    const progressSign = horizontal ? Math.sign(toGoalX) : Math.sign(toGoalY);
    if (progressSign === 0) return;

    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    const baseActivationDistance = Math.max(this.config.cellSize * 8, this.config.neighborRadius * 4);
    const exitLead = this.config.cellSize * 2;
    let bestObstacle = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestSide = 0;
    let bestActivationDistance = baseActivationDistance;
    let bestIsSplitter = false;

    for (let obstacleIndex = 0; obstacleIndex < this.scenario.obstacles.length; obstacleIndex += 1) {
      const obstacle = this.scenario.obstacles[obstacleIndex]!;
      const near = horizontal
        ? progressSign > 0 ? obstacle.x - clearance : obstacle.x + obstacle.width + clearance
        : progressSign > 0 ? obstacle.y - clearance : obstacle.y + obstacle.height + clearance;
      const far = horizontal
        ? progressSign > 0 ? obstacle.x + obstacle.width + clearance : obstacle.x - clearance
        : progressSign > 0 ? obstacle.y + obstacle.height + clearance : obstacle.y - clearance;
      const position = horizontal ? x : y;
      const goal = horizontal ? this.goal.x : this.goal.y;
      const distanceToNear = (near - position) * progressSign;
      const minimum = horizontal ? obstacle.y - clearance : obstacle.x - clearance;
      const maximum = horizontal
        ? obstacle.y + obstacle.height + clearance
        : obstacle.x + obstacle.width + clearance;
      const lateralWorld = horizontal ? this.config.height : this.config.width;
      // A barrier occupying at least half the cross-axis is a true stream
      // splitter. Its contact component can reach several local-neighbor radii
      // behind the leading wall contact, so establish a coherent route side
      // before that component forms.
      const isSplitter = maximum - minimum >= lateralWorld * 0.5;
      const activationDistance = isSplitter
        ? Math.max(baseActivationDistance * 2, this.config.cellSize * 16)
        : baseActivationDistance;
      if ((goal - far) * progressSign <= 0) continue;
      if (distanceToNear > activationDistance || (position - far) * progressSign > exitLead) continue;

      const lateralPosition = horizontal ? y : x;
      const lateralFlow = horizontal ? this.flowDirection.y : this.flowDirection.x;
      let side = lateralPosition < minimum - 1e-9
        ? -1
        : lateralPosition > maximum + 1e-9 ? 1 : Math.sign(lateralFlow);
      if (isSplitter && (position - far) * progressSign <= exitLead) {
        const formationUnit = horizontal ? this.formationUnitY[agent]! : this.formationUnitX[agent]!;
        const spawnMinimum = horizontal ? this.scenario.spawn.y : this.scenario.spawn.x;
        const spawnSpan = horizontal ? this.scenario.spawn.height : this.scenario.spawn.width;
        const obstacleCenter = (minimum + maximum) * 0.5;
        const routeCut = clamp(
          (obstacleCenter - spawnMinimum) / Math.max(spawnSpan, 1e-9),
          0,
          1,
        );
        side = formationUnit < routeCut ? -1 : 1;
      }
      if (side === 0) side = this.stableLaneUnit(agent, obstacleIndex) < 0.5 ? -1 : 1;

      const score = Math.max(0, distanceToNear);
      if (score >= bestDistance - 1e-9) continue;
      bestDistance = score;
      bestObstacle = obstacleIndex;
      bestSide = side;
      bestActivationDistance = activationDistance;
      bestIsSplitter = isSplitter;
    }
    if (bestObstacle < 0) return;

    const obstacle = this.scenario.obstacles[bestObstacle]!;
    const crossing = horizontal
      ? obstacle.x + obstacle.width * 0.5
      : obstacle.y + obstacle.height * 0.5;
    const obstacleMinimum = horizontal ? obstacle.y - clearance : obstacle.x - clearance;
    const obstacleMaximum = horizontal
      ? obstacle.y + obstacle.height + clearance
      : obstacle.x + obstacle.width + clearance;
    let laneMinimum = bestSide < 0 ? clearance : obstacleMaximum;
    let laneMaximum = bestSide < 0
      ? obstacleMinimum
      : (horizontal ? this.config.height : this.config.width) - clearance;

    // Rectangles sharing the crossing line bound the actual portal. This keeps
    // the chosen lane inside a gap between barriers instead of merely outside
    // the one rectangle that caused the detour.
    for (let obstacleIndex = 0; obstacleIndex < this.scenario.obstacles.length; obstacleIndex += 1) {
      if (obstacleIndex === bestObstacle) continue;
      const other = this.scenario.obstacles[obstacleIndex]!;
      const otherNear = horizontal ? other.x - clearance : other.y - clearance;
      const otherFar = horizontal
        ? other.x + other.width + clearance
        : other.y + other.height + clearance;
      if (crossing < otherNear - 1e-9 || crossing > otherFar + 1e-9) continue;
      const otherMinimum = horizontal ? other.y - clearance : other.x - clearance;
      const otherMaximum = horizontal
        ? other.y + other.height + clearance
        : other.x + other.width + clearance;
      if (bestSide < 0 && otherMaximum <= obstacleMinimum + 1e-9) {
        laneMinimum = Math.max(laneMinimum, otherMaximum);
      } else if (bestSide > 0 && otherMinimum >= obstacleMaximum - 1e-9) {
        laneMaximum = Math.min(laneMaximum, otherMinimum);
      }
    }

    const laneSpan = laneMaximum - laneMinimum;
    if (laneSpan <= this.config.agentRadius * 2 + 1e-9) return;
    const laneMargin = Math.min(
      this.config.agentRadius * 4 + Math.max(0, this.config.agentGap),
      laneSpan * 0.25,
    );
    const formationUnit = horizontal ? this.formationUnitY[agent]! : this.formationUnitX[agent]!;
    const spawnMinimum = horizontal ? this.scenario.spawn.y : this.scenario.spawn.x;
    const spawnSpan = horizontal ? this.scenario.spawn.height : this.scenario.spawn.width;
    const obstacleCenter = horizontal
      ? obstacle.y + obstacle.height * 0.5
      : obstacle.x + obstacle.width * 0.5;
    const routeCut = clamp((obstacleCenter - spawnMinimum) / Math.max(spawnSpan, 1e-9), 0, 1);
    const laneUnit = bestSide < 0
      ? routeCut > 1e-9 ? clamp(formationUnit / routeCut, 0, 1) : formationUnit
      : routeCut < 1 - 1e-9 ? clamp((formationUnit - routeCut) / (1 - routeCut), 0, 1) : formationUnit;
    const lane = laneMinimum + laneMargin
      + (laneSpan - laneMargin * 2) * laneUnit;
    const nearEdge = horizontal
      ? progressSign > 0 ? obstacle.x - clearance : obstacle.x + obstacle.width + clearance
      : progressSign > 0 ? obstacle.y - clearance : obstacle.y + obstacle.height + clearance;
    const farEdge = horizontal
      ? progressSign > 0 ? obstacle.x + obstacle.width + clearance : obstacle.x - clearance
      : progressSign > 0 ? obstacle.y + obstacle.height + clearance : obstacle.y - clearance;
    const progressPosition = horizontal ? x : y;
    const lateralPosition = horizontal ? y : x;
    const laneTolerance = this.config.agentRadius * 2 + Math.max(0, this.config.agentGap);
    const alignedBeforeGate = Math.abs(lateralPosition - lane) <= laneTolerance;
    const beforeGate = (progressPosition - nearEdge) * progressSign < 0;
    // First fan out on the near side. A direct ray to the far gate would make
    // every obstacle interval choose the same tangent corner before the lane
    // preference had any chance to take effect.
    let targetProgress = farEdge + progressSign * exitLead;
    if (beforeGate && !alignedBeforeGate) {
      const preGate = nearEdge - progressSign * exitLead;
      targetProgress = (preGate - progressPosition) * progressSign > this.config.cellSize * 0.5
        ? preGate
        : progressPosition + progressSign * this.config.cellSize * 0.5;
    }
    let targetLateral = lane;
    const beforeFarExit = (progressPosition - farEdge) * progressSign <= exitLead;
    if (
      bestIsSplitter
      && beforeFarExit
      && (
        (bestSide < 0 && targetLateral > lateralPosition)
        || (bestSide > 0 && targetLateral < lateralPosition)
      )
    ) {
      // A rigid wall-contact island may still be sliding toward its portal even
      // after an individual lane has been reached. Do not ask that member to
      // turn back into the island until the splitter's far face is cleared.
      targetLateral = lateralPosition;
    }
    const targetX = horizontal ? targetProgress : targetLateral;
    const targetY = horizontal ? targetLateral : targetProgress;
    const laneX = targetX - x;
    const laneY = targetY - y;
    const laneLength = Math.hypot(laneX, laneY);
    if (laneLength <= 1e-9) return;

    const near = horizontal
      ? progressSign > 0 ? obstacle.x - clearance - x : x - obstacle.x - obstacle.width - clearance
      : progressSign > 0 ? obstacle.y - clearance - y : y - obstacle.y - obstacle.height - clearance;
    const proximity = clamp(
      (bestActivationDistance - Math.max(0, near)) / bestActivationDistance,
      0,
      1,
    );
    const blend = proximity * 0.85;
    const originalFlowX = this.flowDirection.x;
    const originalFlowY = this.flowDirection.y;
    let combinedX = originalFlowX * (1 - blend) + (laneX / laneLength) * blend;
    let combinedY = originalFlowY * (1 - blend) + (laneY / laneLength) * blend;
    const reverseFlow = combinedX * originalFlowX + combinedY * originalFlowY;
    if (reverseFlow < 0) {
      combinedX -= originalFlowX * reverseFlow;
      combinedY -= originalFlowY * reverseFlow;
    }
    if (bestIsSplitter && beforeFarExit) {
      if (horizontal && bestSide < 0 && combinedY > 0) combinedY = 0;
      else if (horizontal && bestSide > 0 && combinedY < 0) combinedY = 0;
      else if (!horizontal && bestSide < 0 && combinedX > 0) combinedX = 0;
      else if (!horizontal && bestSide > 0 && combinedX < 0) combinedX = 0;
    }
    const combinedLength = Math.hypot(combinedX, combinedY);
    if (combinedLength <= 1e-9) return;
    this.flowDirection.x = combinedX / combinedLength;
    this.flowDirection.y = combinedY / combinedLength;
  }

  private stableLaneUnit(agent: number, obstacle: number): number {
    let rotation = Math.imul(this.config.seed | 0, 0x45d9f3b)
      ^ Math.imul(obstacle + 1, 0x27d4eb2d);
    rotation = Math.imul(rotation ^ (rotation >>> 16), 0x7feb352d);
    rotation = Math.imul(rotation ^ (rotation >>> 15), 0x846ca68b);
    rotation = (rotation ^ (rotation >>> 16)) >>> 0;
    const value = rotation / UINT32_RANGE + (agent + 1) * FLOW_LANE_STEP;
    return value - Math.floor(value);
  }

  private rebuildArrivalSlots(): void {
    for (let i = 0; i < this.state.count; i += 1) {
      computeArrivalSlot(
        i,
        this.config.seed,
        this.goal,
        Math.max(
          0,
          this.config.goalRadius
            - this.config.agentRadius
            - this.config.wallMargin
            - STATIC_CONTACT_SKIN,
        ),
        this.config.agentRadius,
        this.config.wallMargin + STATIC_CONTACT_SKIN,
        this.config.width,
        this.config.height,
        this.scenario.obstacles,
        this.arrivalSlot,
      );
      this.arrivalSlotX[i] = this.arrivalSlot.x;
      this.arrivalSlotY[i] = this.arrivalSlot.y;
    }
  }

  private isArrivalSegmentSafe(startX: number, startY: number, endX: number, endY: number): boolean {
    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    if (
      endX < clearance
      || endY < clearance
      || endX > this.config.width - clearance
      || endY > this.config.height - clearance
    ) return false;
    const clearanceSquared = clearance * clearance;
    for (const obstacle of this.scenario.obstacles) {
      if (segmentDistanceSquaredToRect(startX, startY, endX, endY, obstacle) < clearanceSquared - 1e-9) return false;
    }
    return true;
  }

  private createSpawnPositions(random: SeededRandom): Vec2[] {
    const spacing = this.config.agentRadius * 2 + Math.max(this.config.agentGap, 0.08);
    const spawnCandidates = this.createHexCandidates(this.scenario.spawn, this.config.agentRadius, spacing)
      .filter((position) => this.isValidPlacement(position));
    this.shuffle(spawnCandidates, random);
    const selected = spawnCandidates.slice(0, this.config.agentCount);
    if (selected.length >= this.config.agentCount) return selected;

    const placementIndex = new PlacementIndex(this.config.agentRadius * 2 + 0.01);
    for (const position of selected) placementIndex.add(position);
    const world: Rect = { x: 0, y: 0, width: this.config.width, height: this.config.height };
    const overflowCandidates = this.createHexCandidates(
      world,
      this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN,
      spacing,
    ).filter((position) => this.isValidPlacement(position));
    overflowCandidates.sort((first, second) => {
      const distanceDifference = distanceSquaredToRect(first.x, first.y, this.scenario.spawn)
        - distanceSquaredToRect(second.x, second.y, this.scenario.spawn);
      return distanceDifference || first.y - second.y || first.x - second.x;
    });
    for (const position of overflowCandidates) {
      if (selected.length >= this.config.agentCount) break;
      if (!placementIndex.canAdd(position)) continue;
      selected.push(position);
      placementIndex.add(position);
    }
    return selected;
  }

  private createHexCandidates(rect: Rect, padding: number, spacing: number): Vec2[] {
    const candidates: Vec2[] = [];
    const minimumX = rect.x + padding;
    const maximumX = rect.x + rect.width - padding;
    const minimumY = rect.y + padding;
    const maximumY = rect.y + rect.height - padding;
    const rowSpacing = spacing * Math.sqrt(3) * 0.5;
    let row = 0;
    for (let y = minimumY; y <= maximumY + 1e-9; y += rowSpacing) {
      const offset = (row & 1) === 0 ? 0 : spacing * 0.5;
      for (let x = minimumX + offset; x <= maximumX + 1e-9; x += spacing) {
        candidates.push({ x, y });
      }
      row += 1;
    }
    return candidates;
  }

  private isValidPlacement(position: Vec2): boolean {
    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    if (
      position.x < clearance
      || position.y < clearance
      || position.x > this.config.width - clearance
      || position.y > this.config.height - clearance
    ) return false;
    for (const obstacle of this.scenario.obstacles) {
      if (distanceSquaredToRect(position.x, position.y, obstacle) < clearance * clearance - 1e-9) return false;
    }
    return true;
  }

  private shuffle(values: Vec2[], random: SeededRandom): void {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random.next() * (index + 1));
      [values[index], values[target]] = [values[target]!, values[index]!];
    }
  }
}

class PlacementIndex {
  private readonly buckets = new Map<number, Vec2[]>();

  constructor(private readonly minimumDistance: number) {}

  canAdd(position: Vec2): boolean {
    const column = Math.floor(position.x / this.minimumDistance);
    const row = Math.floor(position.y / this.minimumDistance);
    const minimumSquared = this.minimumDistance * this.minimumDistance;
    for (let y = row - 1; y <= row + 1; y += 1) {
      for (let x = column - 1; x <= column + 1; x += 1) {
        const bucket = this.buckets.get(this.key(x, y));
        if (!bucket) continue;
        for (const other of bucket) {
          if (distanceSquared(position.x, position.y, other.x, other.y) < minimumSquared - 1e-9) return false;
        }
      }
    }
    return true;
  }

  add(position: Vec2): void {
    const column = Math.floor(position.x / this.minimumDistance);
    const row = Math.floor(position.y / this.minimumDistance);
    const key = this.key(column, row);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(position);
    else this.buckets.set(key, [position]);
  }

  private key(column: number, row: number): number {
    return row * 100_000 + column;
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
  maxTurnRate: 4.5,
  agentRadius: 3.2,
  neighborRadius: 28,
  agentGap: 0.4,
  wallMargin: 0.35,
  avoidanceHorizon: 0.3,
  avoidanceBiasSeconds: 0.8,
  goalRadius: 58,
  fixedDelta: 1 / 60,
  arrivalSlowRadius: 90,
  stallSeconds: 2.5,
};
