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
import { CrowdPreference } from './crowd-preference';
import { PositionRelaxationSolver } from './position-relaxation';
import { PriorityVelocitySolver } from './priority-velocity-solver';
import { SeededRandom } from './random';
import type {
  AgentLayerTrace,
  CrowdDebugLayers,
  Rect,
  ScenarioDefinition,
  ScenarioFlowDefinition,
  SimulationConfig,
  StepMetrics,
  Vec2,
} from './types';
import { FlowField } from '../algorithms/flow-field/flow-field';
import {
  LocalMovementSolver,
  type LocalMovementInput,
  type LocalMovementOutput,
  type LocalSteeringIntent,
} from '../algorithms/steering/local-movement-solver';
import { OrcaVelocitySolver } from '../algorithms/steering/orca-velocity-solver';
import { CoupledVelocityProjector } from '../algorithms/steering/coupled-velocity-projector';
import { ReciprocalVelocitySolver } from '../algorithms/steering/reciprocal-velocity-solver';
import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import { SweptSpatialHash } from '../algorithms/spatial-hash/swept-spatial-hash';

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
  relaxationCorrectedCount: 0,
  maxRelaxationCorrection: 0,
  safetyFallbackCount: 0,
  maxSafetyFallbackVelocityChange: 0,
  unifiedInfeasibleCount: 0,
};

const FLOW_LANE_STEP = 0.6180339887498949;
const UINT32_RANGE = 0x1_0000_0000;
// Keep physical endpoints just outside the reporting contact band so exact
// AABB tangency cannot become a persistent all-directions-blocked state.
const STATIC_CONTACT_SKIN = 0.06;
// Minimal (P1/P2 experiment) pipeline tuning. The ORCA horizon is deliberately
// short of the legacy 2s so dense half-plane sets stay feasible, and the
// relaxation cap keeps per-frame positional corrections below one pixel.
// The ORCA neighbor query radius is derived as comfortRadius +
// maxSpeed * ORCA_TIME_HORIZON: a constraint then activates exactly when its
// speed bound reaches the agent's own speed, so entering the neighbor set
// never demands a discontinuous velocity change.
const ORCA_TIME_HORIZON = 0.5;
const ORCA_NEIGHBOR_CAP = 16;
// Hard static half-planes limit approach toward walls to gap / response time;
// the infeasibility repair never relaxes them.
const ORCA_STATIC_RESPONSE = 0.25;
const RELAXATION_ITERATIONS = 6;
const RELAXATION_CAP_RATIO = 0.5;
// Comfortable spacing is a preference, not a constraint: a gentle separation
// term in the preferred velocity keeps packed groups near the comfort radius
// while the ORCA constraints stay limited to actual collision safety.
const SEPARATION_RANGE_MARGIN = 2;
const SEPARATION_SPEED = 12;
const SEPARATION_SPEED_CAP = 18;
// Congestion slowdown: approaching a *slow* group ahead lowers desired speed
// before hard constraints have to, turning dash-and-stop into a smooth queue.
// A column moving at full speed is not congestion and is never slowed.
const DENSITY_RADIUS = 16;
const DENSITY_SATURATION = 10;
const DENSITY_MAX_SLOWDOWN = 0.4;
const DENSITY_SLOW_NEIGHBOR_FRACTION = 0.5;
// Unified pipeline: constraints enter continuously over this short horizon;
// the per-agent broad phase also includes the agent's own swept distance so
// opposite flows are discovered earlier than same-speed following traffic.
const UNIFIED_TIME_HORIZON = 0.5;
const UNIFIED_GUIDANCE_HORIZON = 0.4;
const UNIFIED_NEIGHBOR_CAP = 8;
// Corrupt/imported states can place hundreds of agents in one cell. Keeping
// every pair turns all downstream agreement and fallback passes quadratic and
// can freeze the render loop for seconds. Normal packed layouts stay well
// below these limits; above them a bounded deterministic subset is enough to
// recover the invalid cluster over subsequent fixed steps.
const MAX_CACHED_NEIGHBORS_PER_AGENT = 192;
const MAX_SOLVER_NEIGHBORS_PER_AGENT = 96;
const OVERLOAD_CACHED_NEIGHBORS_PER_AGENT = 16;
const OVERLOAD_SOLVER_NEIGHBORS_PER_AGENT = 8;
const UNIFIED_STATIC_RESPONSE = 0.5;
const UNIFIED_SOLVER_ACCELERATION_FRACTION = 1;
// Keep the velocity agreement just outside exact physical tangency. Without a
// tiny numerical skin, independently solved half-planes land at ~1e-4 px from
// contact and make the residual validator execute on otherwise safe pairs.
const UNIFIED_DYNAMIC_SKIN = 0;
const UNIFIED_RELAXATION_EPSILON = 0.01;
const FALLBACK_NONE = 0;
const FALLBACK_STATIC = 1;
const FALLBACK_DYNAMIC = 2;
const FALLBACK_DEPENETRATION = 3;
const FALLBACK_SOLVER = 4;

interface SpawnPlacement extends Vec2 {
  flow: number;
}

export class CrowdSimulation {
  state: AgentBuffer;
  private nextState: AgentBuffer;
  readonly navigator: FlowField;
  readonly neighbors: SpatialHash;
  private readonly sweptNeighbors: SweptSpatialHash;
  readonly movement = new LocalMovementSolver();
  private readonly reciprocalVelocitySolver = new ReciprocalVelocitySolver();
  scenario: ScenarioDefinition;
  goal: Vec2;
  readonly agentFlow: Uint16Array;
  stepCount = 0;
  metrics: StepMetrics = { ...ZERO_METRICS };
  overlapFlags: Uint8Array;
  unspawnedCount = 0;
  readonly debugLayers: CrowdDebugLayers;

  private flowNavigators: FlowField[] = [];
  private flowGoals: Vec2[] = [];
  private flowSpawns: Rect[] = [];
  private flowIds: string[] = [];
  private flowWeights: number[] = [];
  private flowApproachX = new Float64Array(0);
  private flowApproachY = new Float64Array(0);
  private flowActiveCounts = new Uint32Array(0);
  private flowInsideCounts = new Uint32Array(0);
  private flowControlOwner = 0;
  private flowControlPhaseStep = 0;
  private flowControlDraining = false;

  private queryAgent = 0;
  private queryRadius = 0;
  private cachedQuerySaturated = false;
  private solverQuerySaturated = false;
  private neighborCount = 0;
  private candidateChecks = 0;
  private overlapPairs = 0;
  private readonly neighborIndices: Int32Array;
  private readonly neighborOffsets: Int32Array;
  private cachedNeighborIndices: Int32Array;
  private cachedNeighborCount = 0;
  private cachedTotalNeighbors = 0;
  private cachedMaxNeighbors = 0;
  private readonly solverNeighborOffsets: Int32Array;
  private solverNeighborIndices: Int32Array;
  private solverNeighborCount = 0;
  private readonly preferredX: Float64Array;
  private readonly preferredY: Float64Array;
  private readonly plannedVelocityX: Float64Array;
  private readonly plannedVelocityY: Float64Array;
  private readonly desiredSpeed: Float64Array;
  private readonly localDensity: Float64Array;
  private readonly meanNeighborVelocityX: Float64Array;
  private readonly meanNeighborVelocityY: Float64Array;
  private readonly leaderId: Int32Array;
  private readonly leaderGap: Float64Array;
  private readonly leaderSpeed: Float64Array;
  private readonly minimumNeighborDistance: Float64Array;
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
  private readonly solverRelaxedAcceleration: Uint8Array;
  private readonly fallbackReason: Uint8Array;
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
  private readonly orcaVelocitySolver = new OrcaVelocitySolver();
  private readonly coupledVelocityProjector = new CoupledVelocityProjector();
  private readonly positionRelaxation = new PositionRelaxationSolver();
  private readonly crowdPreference = new CrowdPreference();
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
  private readonly visitCandidate = (candidate: number): boolean => this.accumulateCandidate(candidate);
  private readonly visitSolverCandidate = (candidate: number): boolean => this.accumulateSolverCandidate(candidate);
  private readonly visitStoppedCandidate = (candidate: number): void => this.findStoppedCandidate(candidate);

  constructor(public config: SimulationConfig, scenario: ScenarioDefinition) {
    this.scenario = scenario;
    this.goal = { ...scenario.goal };
    this.state = new AgentBuffer(config.agentCount);
    this.nextState = new AgentBuffer(config.agentCount);
    this.navigator = new FlowField(config.width, config.height, config.cellSize);
    this.neighbors = new SpatialHash(config.width, config.height, config.neighborRadius, config.agentCount);
    this.sweptNeighbors = new SweptSpatialHash(
      config.width,
      config.height,
      config.neighborRadius,
      config.agentCount,
    );
    this.neighborIndices = new Int32Array(config.agentCount);
    this.neighborOffsets = new Int32Array(config.agentCount + 1);
    this.cachedNeighborIndices = new Int32Array(Math.max(1, config.agentCount * 64));
    this.solverNeighborOffsets = new Int32Array(config.agentCount + 1);
    this.solverNeighborIndices = new Int32Array(Math.max(1, config.agentCount * 24));
    this.preferredX = new Float64Array(config.agentCount);
    this.preferredY = new Float64Array(config.agentCount);
    this.plannedVelocityX = new Float64Array(config.agentCount);
    this.plannedVelocityY = new Float64Array(config.agentCount);
    this.desiredSpeed = new Float64Array(config.agentCount);
    this.localDensity = new Float64Array(config.agentCount);
    this.meanNeighborVelocityX = new Float64Array(config.agentCount);
    this.meanNeighborVelocityY = new Float64Array(config.agentCount);
    this.leaderId = new Int32Array(config.agentCount);
    this.leaderGap = new Float64Array(config.agentCount);
    this.leaderSpeed = new Float64Array(config.agentCount);
    this.minimumNeighborDistance = new Float64Array(config.agentCount);
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
    this.solverRelaxedAcceleration = new Uint8Array(config.agentCount);
    this.fallbackReason = new Uint8Array(config.agentCount);
    this.activeThisStep = new Uint8Array(config.agentCount);
    this.arrivalSlotX = new Float64Array(config.agentCount);
    this.arrivalSlotY = new Float64Array(config.agentCount);
    this.formationUnitX = new Float64Array(config.agentCount);
    this.formationUnitY = new Float64Array(config.agentCount);
    this.agentFlow = new Uint16Array(config.agentCount);
    this.debugLayers = {
      preferredVelocityX: this.plannedVelocityX,
      preferredVelocityY: this.plannedVelocityY,
      localVelocityX: this.resolvedVelocityX,
      localVelocityY: this.resolvedVelocityY,
      density: this.localDensity,
      fallbackReason: this.fallbackReason,
    };
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
    this.configureFlows();
    const positions = this.createSpawnPositions(random);
    this.unspawnedCount = Math.max(0, this.config.agentCount - positions.length);
    this.state = new AgentBuffer(positions.length);
    this.nextState = new AgentBuffer(positions.length);
    this.overlapFlags = new Uint8Array(positions.length);
    this.agentFlow.fill(0);
    for (let i = 0; i < positions.length; i += 1) {
      const flow = positions[i]!.flow;
      const spawn = this.flowSpawns[flow]!;
      this.agentFlow[i] = flow;
      this.state.x[i] = positions[i]!.x;
      this.state.y[i] = positions[i]!.y;
      this.state.active[i] = 1;
      this.state.avoidanceSide[i] = 0;
      this.state.motionPhase[i] = 1;
      this.formationUnitX[i] = clamp(
        (positions[i]!.x - spawn.x) / Math.max(spawn.width, 1e-9),
        0,
        1,
      );
      this.formationUnitY[i] = clamp(
        (positions[i]!.y - spawn.y) / Math.max(spawn.height, 1e-9),
        0,
        1,
      );
    }
    this.rebuildArrivalSlots();
    this.fallbackReason.fill(FALLBACK_NONE);
    this.leaderId.fill(-1);
    this.leaderGap.fill(Number.POSITIVE_INFINITY);
    this.minimumNeighborDistance.fill(Number.POSITIVE_INFINITY);
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
    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    for (let flow = 0; flow < this.flowGoals.length; flow += 1) {
      this.flowGoals[flow]!.x = this.goal.x;
      this.flowGoals[flow]!.y = this.goal.y;
      const spawn = this.flowSpawns[flow]!;
      const approachX = this.goal.x - (spawn.x + spawn.width * 0.5);
      const approachY = this.goal.y - (spawn.y + spawn.height * 0.5);
      const approachLength = Math.hypot(approachX, approachY);
      this.flowApproachX[flow] = approachLength > 1e-9 ? approachX / approachLength : 1;
      this.flowApproachY[flow] = approachLength > 1e-9 ? approachY / approachLength : 0;
      this.flowNavigators[flow]!.rebuild(this.flowGoals[flow]!, this.scenario.obstacles, clearance);
    }
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
    this.flowControlOwner = 0;
    this.flowControlPhaseStep = this.stepCount;
    this.flowControlDraining = false;
    this.nextState.copyFrom(this.state);
    this.overlapFlags.fill(0);
    this.metrics = { ...ZERO_METRICS, activeCount: this.state.count };
  }

  get goals(): readonly Vec2[] {
    return this.flowGoals;
  }

  get flowCount(): number {
    return this.flowGoals.length;
  }

  flowId(flow: number): string {
    if (!Number.isInteger(flow) || flow < 0 || flow >= this.flowIds.length) {
      throw new RangeError(`Flow index ${flow} is outside 0..${this.flowIds.length - 1}.`);
    }
    return this.flowIds[flow]!;
  }

  step(): void {
    const pipeline = this.config.pipeline ?? 'current';
    if (pipeline === 'minimal') {
      this.stepMinimal();
      return;
    }
    if (pipeline === 'unified') {
      this.stepUnified();
      return;
    }
    const current = this.state;
    const next = this.nextState;
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
    this.deactivateArrivals(current, next);
    this.planPreferredVelocities(current);
    this.neighbors.rebuild(current.x, current.y, this.activeThisStep);
    this.candidateChecks = 0;
    this.buildNeighborCache(current);
    this.overlapPairs = 0;
    this.overlapFlags.fill(0);
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
    this.finalizeStep(current, next, {
      reservationLimitedCount: reservation.limitedAgents,
      reservationStoppedCount: reservation.stoppedAgents,
      maxReservationVelocityChange: reservation.maximumVelocityChange,
      reciprocalConstraintCount,
      reciprocalProjectionRepairCount,
      relaxationCorrectedCount: 0,
      maxRelaxationCorrection: 0,
      safetyFallbackCount: 0,
      maxSafetyFallbackVelocityChange: 0,
      unifiedInfeasibleCount: 0,
    });
  }

  /**
   * P1 experiment pipeline: flow-field preferred velocity → full-velocity-space
   * ORCA → integration with a swept static slide → symmetric capped position
   * relaxation. One dynamic-avoidance authority, one non-penetration authority,
   * no reverse-projection invariants, and no velocity/displacement re-sync —
   * persisted velocity is the solver agreement, and relaxation corrections stay
   * spatial.
   */
  private stepMinimal(): void {
    const current = this.state;
    const next = this.nextState;
    next.copyFrom(current);
    this.activeThisStep.fill(0);
    this.activeThisStep.set(current.active);
    this.deactivateArrivals(current, next);

    // The neighbor cache is built before planning so frontal density can shape
    // desired speed. The radius makes ORCA constraint activation seamless (see
    // the constant block).
    const comfortRadius = this.config.agentRadius * 2 + Math.max(0, this.config.agentGap);
    this.queryRadius = Math.max(
      this.config.neighborRadius,
      comfortRadius + this.config.maxSpeed * ORCA_TIME_HORIZON,
    );
    this.neighbors.rebuild(current.x, current.y, this.activeThisStep);
    this.candidateChecks = 0;
    this.buildNeighborCache(current);
    this.overlapFlags.fill(0);
    this.emergencyStops.fill(0);

    // Preferred velocity: acceleration-limited pursuit of the flow direction,
    // slowed by the packing density ahead. This is the only place the
    // acceleration budget shapes motion; the ORCA agreement below is applied
    // as solved.
    const arrivalRadius = Math.max(this.config.arrivalSlowRadius, this.config.goalRadius * 1.5);
    const maximumDelta = Math.max(0, this.config.maxAcceleration) * this.config.fixedDelta;
    const densityRadiusSquared = DENSITY_RADIUS * DENSITY_RADIUS;
    const physicalDiameter = this.config.agentRadius * 2;
    const separationRange = physicalDiameter
      + Math.max(0, this.config.agentGap)
      + SEPARATION_RANGE_MARGIN;
    const separationRangeSquared = separationRange * separationRange;
    const separationFalloff = Math.max(1e-9, separationRange - physicalDiameter);
    for (let i = 0; i < current.count; i += 1) {
      if (this.activeThisStep[i] !== 1) {
        this.preferredX[i] = 0;
        this.preferredY[i] = 0;
        this.plannedVelocityX[i] = 0;
        this.plannedVelocityY[i] = 0;
        continue;
      }
      const flow = this.agentFlow[i]!;
      const goal = this.flowGoals[flow]!;
      this.flowNavigators[flow]!.sampleDirection(current.x[i]!, current.y[i]!, this.flowDirection);
      this.preferredX[i] = this.flowDirection.x;
      this.preferredY[i] = this.flowDirection.y;
      const distanceToGoal = Math.sqrt(
        distanceSquared(current.x[i]!, current.y[i]!, goal.x, goal.y),
      );
      let congestedCount = 0;
      let separationX = 0;
      let separationY = 0;
      const slowNeighborSpeed = this.config.maxSpeed * DENSITY_SLOW_NEIGHBOR_FRACTION;
      const start = this.neighborOffsets[i]!;
      const end = this.neighborOffsets[i + 1]!;
      for (let offset = start; offset < end; offset += 1) {
        const neighbor = this.cachedNeighborIndices[offset]!;
        const offsetX = current.x[neighbor]! - current.x[i]!;
        const offsetY = current.y[neighbor]! - current.y[i]!;
        const offsetSquared = offsetX * offsetX + offsetY * offsetY;
        if (offsetSquared > densityRadiusSquared || offsetSquared <= 1e-12) continue;
        const distance = Math.sqrt(offsetSquared);
        if (offsetSquared < separationRangeSquared) {
          const weight = Math.min(1, (separationRange - distance) / separationFalloff);
          separationX -= (offsetX / distance) * weight * SEPARATION_SPEED;
          separationY -= (offsetY / distance) * weight * SEPARATION_SPEED;
        }
        const forward = offsetX * this.flowDirection.x + offsetY * this.flowDirection.y;
        if (forward <= 0.3 * distance) continue;
        const neighborForwardSpeed = current.vx[neighbor]! * this.flowDirection.x
          + current.vy[neighbor]! * this.flowDirection.y;
        if (neighborForwardSpeed < slowNeighborSpeed) congestedCount += 1;
      }
      const separationLength = Math.hypot(separationX, separationY);
      if (separationLength > SEPARATION_SPEED_CAP) {
        separationX *= SEPARATION_SPEED_CAP / separationLength;
        separationY *= SEPARATION_SPEED_CAP / separationLength;
      }
      const densityScale = 1
        - DENSITY_MAX_SLOWDOWN * Math.min(1, congestedCount / DENSITY_SATURATION);
      const desiredSpeed = this.config.maxSpeed
        * Math.min(1, distanceToGoal / Math.max(arrivalRadius, 1e-9))
        * densityScale;
      const deltaX = this.flowDirection.x * desiredSpeed + separationX - current.vx[i]!;
      const deltaY = this.flowDirection.y * desiredSpeed + separationY - current.vy[i]!;
      const deltaLength = Math.hypot(deltaX, deltaY);
      const scale = deltaLength > maximumDelta && deltaLength > 1e-9
        ? maximumDelta / deltaLength
        : 1;
      this.plannedVelocityX[i] = current.vx[i]! + deltaX * scale;
      this.plannedVelocityY[i] = current.vy[i]! + deltaY * scale;
      next.intentX[i] = this.flowDirection.x;
      next.intentY[i] = this.flowDirection.y;
    }

    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    const orca = this.orcaVelocitySolver.solve({
      current,
      active: this.activeThisStep,
      preferredVelocityX: this.plannedVelocityX,
      preferredVelocityY: this.plannedVelocityY,
      neighborOffsets: this.neighborOffsets,
      neighborIndices: this.cachedNeighborIndices,
      neighborCap: ORCA_NEIGHBOR_CAP,
      agentRadius: this.config.agentRadius,
      separationPadding: Math.max(0, this.config.agentGap),
      maxSpeed: this.config.maxSpeed,
      fixedDelta: this.config.fixedDelta,
      timeHorizon: ORCA_TIME_HORIZON,
      obstacles: this.scenario.obstacles,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      wallClearance: clearance,
      staticResponseTime: ORCA_STATIC_RESPONSE,
      outputVelocityX: this.resolvedVelocityX,
      outputVelocityY: this.resolvedVelocityY,
    });

    // Integrate the agreement against statics. The slide result is both the
    // next position and the persisted velocity — no displacement re-sync.
    for (let i = 0; i < current.count; i += 1) {
      if (this.activeThisStep[i] !== 1) continue;
      this.staticIntegrator.integrate(
        current.x[i]!,
        current.y[i]!,
        this.resolvedVelocityX[i]!,
        this.resolvedVelocityY[i]!,
        this.config.fixedDelta,
        clearance,
        this.config.width,
        this.config.height,
        this.scenario.obstacles,
        4,
        this.staticIntegration,
      );
      next.x[i] = this.staticIntegration.x;
      next.y[i] = this.staticIntegration.y;
      next.vx[i] = this.staticIntegration.velocityX;
      next.vy[i] = this.staticIntegration.velocityY;
      if (Math.hypot(
        next.vx[i]! - current.vx[i]!,
        next.vy[i]! - current.vy[i]!,
      ) > maximumDelta + 1e-9) {
        this.emergencyStops[i] = 1;
      }
    }

    const relaxation = this.positionRelaxation.solve({
      next,
      active: this.activeThisStep,
      neighborOffsets: this.neighborOffsets,
      neighborIndices: this.cachedNeighborIndices,
      agentRadius: this.config.agentRadius,
      maxCorrection: this.config.agentRadius * RELAXATION_CAP_RATIO,
      iterations: RELAXATION_ITERATIONS,
      obstacles: this.scenario.obstacles,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      staticClearance: clearance,
      overlapFlags: this.overlapFlags,
    });
    this.candidateChecks += relaxation.candidateChecks;
    this.overlapPairs = relaxation.remainingOverlapPairs;

    this.finalizeStep(current, next, {
      reservationLimitedCount: 0,
      reservationStoppedCount: 0,
      maxReservationVelocityChange: 0,
      reciprocalConstraintCount: orca.constraintCount,
      reciprocalProjectionRepairCount: orca.infeasibleAgents,
      relaxationCorrectedCount: relaxation.correctedAgents,
      maxRelaxationCorrection: relaxation.maxCorrection,
      safetyFallbackCount: 0,
      maxSafetyFallbackVelocityChange: 0,
      unifiedInfeasibleCount: 0,
    });
  }

  /**
   * Production redesign: crowd guidance creates one preferred velocity and an
   * acceleration-aware ORCA LP owns routine dynamic/static velocity choice.
   * Swept integration, reservation, and tiny depenetration are validators for
   * residual numerical conflicts only; every correction is synchronized back
   * to actual displacement before the state is published.
   */
  private stepUnified(): void {
    const current = this.state;
    const next = this.nextState;
    next.copyFrom(current);
    this.activeThisStep.fill(0);
    this.activeThisStep.set(current.active);
    this.deactivateArrivals(current, next);
    this.planPreferredVelocities(current);

    const comfortRadius = this.config.agentRadius * 2 + Math.max(0, this.config.agentGap);
    this.queryRadius = Math.max(
      this.config.neighborRadius,
      comfortRadius + this.config.maxSpeed * UNIFIED_GUIDANCE_HORIZON,
    );
    this.neighbors.rebuild(current.x, current.y, this.activeThisStep);
    this.candidateChecks = 0;
    this.buildNeighborCache(current);
    this.overlapFlags.fill(0);
    this.emergencyStops.fill(0);
    this.solverRelaxedAcceleration.fill(0);
    this.fallbackReason.fill(FALLBACK_NONE);

    this.crowdPreference.build({
      current,
      active: this.activeThisStep,
      globalDirectionX: this.preferredX,
      globalDirectionY: this.preferredY,
      goalSpeed: this.desiredSpeed,
      neighborOffsets: this.neighborOffsets,
      neighborIndices: this.cachedNeighborIndices,
      agentRadius: this.config.agentRadius,
      agentGap: this.config.agentGap,
      maxSpeed: this.config.maxSpeed,
      maxAcceleration: this.config.maxAcceleration,
      fixedDelta: this.config.fixedDelta,
      leaderHorizon: UNIFIED_GUIDANCE_HORIZON,
      preserveLongitudinalSpeed: this.scenario.obstacles.length === 0,
      outputVelocityX: this.plannedVelocityX,
      outputVelocityY: this.plannedVelocityY,
      outputDesiredSpeed: this.desiredSpeed,
      outputDensity: this.localDensity,
      outputMeanVelocityX: this.meanNeighborVelocityX,
      outputMeanVelocityY: this.meanNeighborVelocityY,
      outputLeaderId: this.leaderId,
      outputLeaderGap: this.leaderGap,
      outputLeaderSpeed: this.leaderSpeed,
      outputMinimumDistance: this.minimumNeighborDistance,
    });
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      next.intentX[agent] = this.preferredX[agent]!;
      next.intentY[agent] = this.preferredY[agent]!;
    }
    this.buildSweptSolverNeighborCache(current);

    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    const orca = this.orcaVelocitySolver.solve({
      current,
      active: this.activeThisStep,
      preferredVelocityX: this.plannedVelocityX,
      preferredVelocityY: this.plannedVelocityY,
      neighborOffsets: this.solverNeighborOffsets,
      neighborIndices: this.solverNeighborIndices,
      neighborCap: UNIFIED_NEIGHBOR_CAP,
      agentRadius: this.config.agentRadius + UNIFIED_DYNAMIC_SKIN,
      separationPadding: 0,
      maxSpeed: this.config.maxSpeed,
      maxAcceleration: this.config.maxAcceleration * UNIFIED_SOLVER_ACCELERATION_FRACTION,
      fixedDelta: this.config.fixedDelta,
      timeHorizon: UNIFIED_TIME_HORIZON,
      rankNeighborsByPredictedSeparation: true,
      accelerationRelaxed: this.solverRelaxedAcceleration,
      obstacles: this.scenario.obstacles,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      wallClearance: clearance,
      staticResponseTime: UNIFIED_STATIC_RESPONSE,
      outputVelocityX: this.resolvedVelocityX,
      outputVelocityY: this.resolvedVelocityY,
    });
    const anticipatoryProjection = this.coupledVelocityProjector.solve({
      current,
      active: this.activeThisStep,
      neighborOffsets: this.solverNeighborOffsets,
      neighborIndices: this.solverNeighborIndices,
      velocityX: this.resolvedVelocityX,
      velocityY: this.resolvedVelocityY,
      agentRadius: this.config.agentRadius,
      fixedDelta: this.config.fixedDelta,
      maxAcceleration: this.config.maxAcceleration,
      maxSpeed: this.config.maxSpeed,
      iterations: 8,
      separationSkin: this.scenario.obstacles.length > 0 ? 0.7 : 0.01,
      timeHorizon: 0.4,
      obstacles: this.scenario.obstacles,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      wallClearance: clearance,
      staticResponseTime: UNIFIED_STATIC_RESPONSE,
    });
    const anticipatoryCandidateChecks = anticipatoryProjection.candidateChecks;
    const coupledProjection = this.coupledVelocityProjector.solve({
      current,
      active: this.activeThisStep,
      neighborOffsets: this.solverNeighborOffsets,
      neighborIndices: this.solverNeighborIndices,
      velocityX: this.resolvedVelocityX,
      velocityY: this.resolvedVelocityY,
      agentRadius: this.config.agentRadius,
      fixedDelta: this.config.fixedDelta,
      maxAcceleration: this.config.maxAcceleration,
      maxSpeed: this.config.maxSpeed,
      iterations: 32,
      separationSkin: 0.001,
      obstacles: this.scenario.obstacles,
      worldWidth: this.config.width,
      worldHeight: this.config.height,
      wallClearance: clearance,
      staticResponseTime: UNIFIED_STATIC_RESPONSE,
    });
    this.candidateChecks += anticipatoryCandidateChecks + coupledProjection.candidateChecks;

    // Exact static sweep validates the LP's linearized wall constraints.
    let needsPriorityFallback = coupledProjection.remainingOverlapPairs > 0;
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      if (this.solverRelaxedAcceleration[agent] === 1) {
        this.fallbackReason[agent] = FALLBACK_SOLVER;
        this.emergencyStops[agent] = 1;
      }
      this.staticIntegrator.integrate(
        current.x[agent]!,
        current.y[agent]!,
        this.resolvedVelocityX[agent]!,
        this.resolvedVelocityY[agent]!,
        this.config.fixedDelta,
        clearance,
        this.config.width,
        this.config.height,
        this.scenario.obstacles,
        4,
        this.staticIntegration,
      );
      next.x[agent] = this.staticIntegration.x;
      next.y[agent] = this.staticIntegration.y;
      next.vx[agent] = this.staticIntegration.velocityX;
      next.vy[agent] = this.staticIntegration.velocityY;
      const staticChanged = (
        this.staticIntegration.startedOverlapping
        || this.staticIntegration.exhausted
        || Math.hypot(
          next.vx[agent]! - this.resolvedVelocityX[agent]!,
          next.vy[agent]! - this.resolvedVelocityY[agent]!,
        ) > 1e-6
      );
      if (staticChanged) {
        this.fallbackReason[agent] = FALLBACK_STATIC;
        needsPriorityFallback = true;
      }
      this.reconciledVelocityX[agent] = next.x[agent]!;
      this.reconciledVelocityY[agent] = next.y[agent]!;
    }

    // Only residual endpoint conflicts left by the unified agreement or a wall
    // slide reach the legacy solver. A zero limited count means it was purely
    // observational; routine movement authority stays in the unified LP.
    let remainingFallbackOverlaps = 0;
    if (needsPriorityFallback) {
      const priorityFallback = this.priorityVelocitySolver.solve({
        current,
        next,
        active: this.activeThisStep,
        preferredDirectionX: this.preferredX,
        preferredDirectionY: this.preferredY,
        routeCost: this.routeCost,
        neighborOffsets: this.solverNeighborOffsets,
        neighborIndices: this.solverNeighborIndices,
        agentRadius: this.config.agentRadius,
        fixedDelta: this.config.fixedDelta,
        allowLateralSearch: true,
        maxAcceleration: this.config.maxAcceleration,
        maxSpeed: this.config.maxSpeed,
        obstacles: this.scenario.obstacles,
        worldWidth: this.config.width,
        worldHeight: this.config.height,
        staticClearance: clearance,
        overlapFlags: this.overlapFlags,
      });
      this.candidateChecks += priorityFallback.candidateChecks;
      remainingFallbackOverlaps = priorityFallback.remainingOverlapPairs;
      if (priorityFallback.remainingOverlapPairs > 0) {
        const cleanup = this.priorityVelocitySolver.solve({
          current,
          next,
          active: this.activeThisStep,
          preferredDirectionX: this.preferredX,
          preferredDirectionY: this.preferredY,
          routeCost: this.routeCost,
          neighborOffsets: this.solverNeighborOffsets,
          neighborIndices: this.solverNeighborIndices,
          agentRadius: this.config.agentRadius,
          fixedDelta: this.config.fixedDelta,
          overlapFlags: this.overlapFlags,
        });
        this.candidateChecks += cleanup.candidateChecks;
        remainingFallbackOverlaps = cleanup.remainingOverlapPairs;
      }
    }
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      if (Math.hypot(
          next.x[agent]! - this.reconciledVelocityX[agent]!,
          next.y[agent]! - this.reconciledVelocityY[agent]!,
        ) > 1e-9) this.fallbackReason[agent] = FALLBACK_DYNAMIC;
      this.intentVelocityX[agent] = next.x[agent]!;
      this.intentVelocityY[agent] = next.y[agent]!;
    }

    let relaxationCorrectedCount = 0;
    let maximumRelaxationCorrection = 0;
    this.overlapPairs = remainingFallbackOverlaps;
    if (remainingFallbackOverlaps > 0) {
      const relaxation = this.positionRelaxation.solve({
        next,
        active: this.activeThisStep,
        neighborOffsets: this.neighborOffsets,
        neighborIndices: this.cachedNeighborIndices,
        agentRadius: this.config.agentRadius,
        maxCorrection: UNIFIED_RELAXATION_EPSILON,
        iterations: 4,
        obstacles: this.scenario.obstacles,
        worldWidth: this.config.width,
        worldHeight: this.config.height,
        staticClearance: clearance,
        overlapFlags: this.overlapFlags,
      });
      this.candidateChecks += relaxation.candidateChecks;
      this.overlapPairs = relaxation.remainingOverlapPairs;
      relaxationCorrectedCount = relaxation.correctedAgents;
      maximumRelaxationCorrection = relaxation.maxCorrection;
    }

    let safetyFallbackCount = 0;
    let maximumSafetyVelocityChange = 0;
    const maximumDelta = Math.max(0, this.config.maxAcceleration) * this.config.fixedDelta;
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      if (Math.hypot(
        next.x[agent]! - this.intentVelocityX[agent]!,
        next.y[agent]! - this.intentVelocityY[agent]!,
      ) > 1e-9) this.fallbackReason[agent] = FALLBACK_DEPENETRATION;
      const actualVelocityX = (next.x[agent]! - current.x[agent]!) / this.config.fixedDelta;
      const actualVelocityY = (next.y[agent]! - current.y[agent]!) / this.config.fixedDelta;
      maximumSafetyVelocityChange = Math.max(
        maximumSafetyVelocityChange,
        Math.hypot(
          actualVelocityX - this.resolvedVelocityX[agent]!,
          actualVelocityY - this.resolvedVelocityY[agent]!,
        ),
      );
      if (this.fallbackReason[agent] !== FALLBACK_NONE) safetyFallbackCount += 1;
      if (Math.hypot(
        actualVelocityX - current.vx[agent]!,
        actualVelocityY - current.vy[agent]!,
      ) > maximumDelta + 1e-7) this.emergencyStops[agent] = 1;
      next.vx[agent] = actualVelocityX;
      next.vy[agent] = actualVelocityY;
    }
    // Publish arrivals in the frame that enters the goal disk. The legacy
    // start-of-step check remains for backwards compatibility, while this
    // unified end-of-step check makes step-N metrics describe the step-N state.
    this.deactivateArrivals(next, next);

    this.finalizeStep(current, next, {
      reservationLimitedCount: 0,
      reservationStoppedCount: 0,
      maxReservationVelocityChange: 0,
      reciprocalConstraintCount: orca.constraintCount,
      reciprocalProjectionRepairCount: orca.infeasibleAgents,
      relaxationCorrectedCount,
      maxRelaxationCorrection: maximumRelaxationCorrection,
      safetyFallbackCount,
      maxSafetyFallbackVelocityChange: maximumSafetyVelocityChange,
      unifiedInfeasibleCount: coupledProjection.remainingOverlapPairs,
    });
  }

  private deactivateArrivals(current: AgentBuffer, next: AgentBuffer): void {
    // Unified's pass-through policy completes when the moving agent disk first
    // touches the goal disk. Legacy pipelines retain their historical
    // center-inside-radius behavior for stable A/B comparisons.
    const arrivalRadius = this.config.goalRadius + (
      (this.config.pipeline ?? 'current') === 'unified' ? this.config.agentRadius : 0
    );
    const goalRadiusSquared = arrivalRadius * arrivalRadius;
    for (let i = 0; i < current.count; i += 1) {
      if (current.active[i] !== 1) continue;
      const goal = this.flowGoals[this.agentFlow[i]!]!;
      if (distanceSquared(current.x[i]!, current.y[i]!, goal.x, goal.y) > goalRadiusSquared) continue;
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
  }

  /** Shared Phase D: persistent state, smoothness/safety metrics, buffer swap. */
  private finalizeStep(
    current: AgentBuffer,
    next: AgentBuffer,
    extras: {
      reservationLimitedCount: number;
      reservationStoppedCount: number;
      maxReservationVelocityChange: number;
      reciprocalConstraintCount: number;
      reciprocalProjectionRepairCount: number;
      relaxationCorrectedCount: number;
      maxRelaxationCorrection: number;
      safetyFallbackCount: number;
      maxSafetyFallbackVelocityChange: number;
      unifiedInfeasibleCount: number;
    },
  ): void {
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
      averageNeighbors: activeCount === 0 ? 0 : this.cachedTotalNeighbors / activeCount,
      maxNeighbors: this.cachedMaxNeighbors,
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
      reservationLimitedCount: extras.reservationLimitedCount,
      reservationStoppedCount: extras.reservationStoppedCount,
      maxReservationVelocityChange: extras.maxReservationVelocityChange,
      reciprocalConstraintCount: extras.reciprocalConstraintCount,
      reciprocalProjectionRepairCount: extras.reciprocalProjectionRepairCount,
      relaxationCorrectedCount: extras.relaxationCorrectedCount,
      maxRelaxationCorrection: extras.maxRelaxationCorrection,
      safetyFallbackCount: extras.safetyFallbackCount,
      maxSafetyFallbackVelocityChange: extras.maxSafetyFallbackVelocityChange,
      unifiedInfeasibleCount: extras.unifiedInfeasibleCount,
    };
  }

  getAgentTrace(agent: number): AgentLayerTrace {
    if (!Number.isInteger(agent) || agent < 0 || agent >= this.state.count) {
      throw new RangeError(`Agent index ${agent} is outside 0..${this.state.count - 1}.`);
    }
    const fallback = this.fallbackReason[agent]!;
    const limiting = this.findLimitingNeighbor(agent);
    const fallbackReason = fallback === FALLBACK_STATIC
      ? 'static-slide'
      : fallback === FALLBACK_DYNAMIC
        ? 'dynamic-reservation'
        : fallback === FALLBACK_DEPENETRATION
          ? 'depenetration'
          : fallback === FALLBACK_SOLVER
            ? 'solver-relaxation'
          : 'none';
    return {
      agent,
      flow: this.agentFlow[agent]!,
      goal: { ...this.flowGoals[this.agentFlow[agent]!]! },
      step: this.stepCount,
      active: this.state.active[agent] === 1,
      position: { x: this.state.x[agent]!, y: this.state.y[agent]! },
      currentVelocity: { x: this.nextState.vx[agent]!, y: this.nextState.vy[agent]! },
      globalDirection: { x: this.preferredX[agent]!, y: this.preferredY[agent]! },
      routeCost: this.routeCost[agent]!,
      localDensity: this.localDensity[agent]!,
      meanNeighborVelocity: {
        x: this.meanNeighborVelocityX[agent]!,
        y: this.meanNeighborVelocityY[agent]!,
      },
      leaderId: this.leaderId[agent]!,
      leaderGap: this.leaderGap[agent]!,
      leaderSpeed: this.leaderSpeed[agent]!,
      desiredSpeed: this.desiredSpeed[agent]!,
      plannedVelocity: { x: this.plannedVelocityX[agent]!, y: this.plannedVelocityY[agent]! },
      localVelocity: { x: this.resolvedVelocityX[agent]!, y: this.resolvedVelocityY[agent]! },
      finalVelocity: { x: this.state.vx[agent]!, y: this.state.vy[agent]! },
      fallbackReason,
      neighborCount: this.neighborOffsets[agent + 1]! - this.neighborOffsets[agent]!,
      minimumDistance: this.minimumNeighborDistance[agent]!,
      limitingNeighborId: limiting.id,
      minimumTimeToCollision: limiting.timeToCollision,
      layerVelocityDelta: {
        crowdPreference: Math.hypot(
          this.plannedVelocityX[agent]! - this.nextState.vx[agent]!,
          this.plannedVelocityY[agent]! - this.nextState.vy[agent]!,
        ),
        localSolver: Math.hypot(
          this.resolvedVelocityX[agent]! - this.plannedVelocityX[agent]!,
          this.resolvedVelocityY[agent]! - this.plannedVelocityY[agent]!,
        ),
        safetyFallback: Math.hypot(
          this.state.vx[agent]! - this.resolvedVelocityX[agent]!,
          this.state.vy[agent]! - this.resolvedVelocityY[agent]!,
        ),
      },
    };
  }

  /** Previous fixed-step snapshot retained by the simulation's double buffer. */
  get previousState(): AgentBuffer {
    return this.nextState;
  }

  private findLimitingNeighbor(agent: number): { id: number; timeToCollision: number } {
    const current = this.nextState;
    const start = this.solverNeighborOffsets[agent]!;
    const end = this.solverNeighborOffsets[agent + 1]!;
    let id = -1;
    let minimumPredictedSeparation = Number.POSITIVE_INFINITY;
    let minimumTimeToCollision = Number.POSITIVE_INFINITY;
    const combinedRadius = this.config.agentRadius * 2;
    for (let offset = start; offset < end; offset += 1) {
      const other = this.solverNeighborIndices[offset]!;
      if (other < 0 || other >= current.count || current.active[other] !== 1) continue;
      const dx = current.x[other]! - current.x[agent]!;
      const dy = current.y[other]! - current.y[agent]!;
      const relativeVelocityX = this.plannedVelocityX[other]! - this.plannedVelocityX[agent]!;
      const relativeVelocityY = this.plannedVelocityY[other]! - this.plannedVelocityY[agent]!;
      const relativeSpeedSquared = relativeVelocityX * relativeVelocityX
        + relativeVelocityY * relativeVelocityY;
      const closestTime = relativeSpeedSquared > 1e-9
        ? clamp(
            -(dx * relativeVelocityX + dy * relativeVelocityY) / relativeSpeedSquared,
            0,
            UNIFIED_TIME_HORIZON,
          )
        : 0;
      const closestX = dx + relativeVelocityX * closestTime;
      const closestY = dy + relativeVelocityY * closestTime;
      const predictedSeparation = closestX * closestX + closestY * closestY;
      if (
        predictedSeparation < minimumPredictedSeparation - 1e-12
        || (Math.abs(predictedSeparation - minimumPredictedSeparation) <= 1e-12 && other < id)
      ) {
        minimumPredictedSeparation = predictedSeparation;
        id = other;
      }

      const currentDistanceSquared = dx * dx + dy * dy;
      const collisionConstant = currentDistanceSquared - combinedRadius * combinedRadius;
      if (collisionConstant <= 0) {
        minimumTimeToCollision = 0;
        continue;
      }
      if (relativeSpeedSquared <= 1e-9) continue;
      const linear = 2 * (dx * relativeVelocityX + dy * relativeVelocityY);
      const discriminant = linear * linear - 4 * relativeSpeedSquared * collisionConstant;
      if (linear >= 0 || discriminant < 0) continue;
      const time = (-linear - Math.sqrt(discriminant)) / (2 * relativeSpeedSquared);
      if (time >= 0 && time <= UNIFIED_TIME_HORIZON) {
        minimumTimeToCollision = Math.min(minimumTimeToCollision, time);
      }
    }
    return { id, timeToCollision: minimumTimeToCollision };
  }

  goalForAgent(agent: number): Readonly<Vec2> {
    if (!Number.isInteger(agent) || agent < 0 || agent >= this.state.count) {
      throw new RangeError(`Agent index ${agent} is outside 0..${this.state.count - 1}.`);
    }
    return this.flowGoals[this.agentFlow[agent]!]!;
  }

  sampleNavigationDirection(agent: number, x: number, y: number, out: Vec2): boolean {
    if (!Number.isInteger(agent) || agent < 0 || agent >= this.state.count) {
      throw new RangeError(`Agent index ${agent} is outside 0..${this.state.count - 1}.`);
    }
    return this.flowNavigators[this.agentFlow[agent]!]!.sampleDirection(x, y, out);
  }

  stateHash(): string {
    let hash = 0x811c9dc5;
    const mix = (value: number): void => {
      hash ^= value | 0;
      hash = Math.imul(hash, 0x01000193);
    };
    mix(this.stepCount);
    mix(this.unspawnedCount);
    for (const goal of this.flowGoals) {
      mix(Math.round(goal.x * 1000));
      mix(Math.round(goal.y * 1000));
    }
    if (this.flowCount > 1) {
      mix(this.flowControlOwner);
      mix(this.flowControlPhaseStep);
      mix(this.flowControlDraining ? 1 : 0);
    }
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
      if (this.flowCount > 1) mix(this.agentFlow[i]!);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private buildNeighborCache(current: AgentBuffer, sweptHorizon = 0): void {
    this.cachedNeighborCount = 0;
    this.cachedTotalNeighbors = 0;
    this.cachedMaxNeighbors = 0;
    for (let agent = 0; agent < current.count; agent += 1) {
      this.neighborOffsets[agent] = this.cachedNeighborCount;
      if (this.activeThisStep[agent] !== 1) continue;
      this.queryAgent = agent;
      this.cachedQuerySaturated = false;
      if (sweptHorizon > 0) {
        const comfortRadius = this.config.agentRadius * 2 + Math.max(0, this.config.agentGap);
        this.queryRadius = Math.max(
          this.config.neighborRadius,
          comfortRadius + (
            this.config.maxSpeed + Math.hypot(current.vx[agent]!, current.vy[agent]!)
          ) * sweptHorizon,
        );
      }
      this.neighbors.forEachCandidateUntil(
        current.x[agent]!,
        current.y[agent]!,
        this.queryRadius,
        this.visitCandidate,
      );
      const start = this.neighborOffsets[agent]!;
      if (this.cachedQuerySaturated) {
        this.cachedNeighborCount = start + OVERLOAD_CACHED_NEIGHBORS_PER_AGENT;
      }
      this.sortCachedNeighborRange(start, this.cachedNeighborCount);
      const count = this.cachedNeighborCount - start;
      this.cachedTotalNeighbors += count;
      this.cachedMaxNeighbors = Math.max(this.cachedMaxNeighbors, count);
    }
    this.neighborOffsets[current.count] = this.cachedNeighborCount;
  }

  private buildSweptSolverNeighborCache(current: AgentBuffer): void {
    this.solverNeighborCount = 0;
    const expansion = this.config.agentRadius + Math.max(0, this.config.agentGap) * 0.5 + 1;
    this.sweptNeighbors.rebuild(
      current.x,
      current.y,
      this.plannedVelocityX,
      this.plannedVelocityY,
      this.activeThisStep,
      UNIFIED_TIME_HORIZON,
      expansion,
    );
    for (let agent = 0; agent < current.count; agent += 1) {
      this.solverNeighborOffsets[agent] = this.solverNeighborCount;
      if (this.activeThisStep[agent] !== 1) continue;
      this.queryAgent = agent;
      this.solverQuerySaturated = false;
      this.sweptNeighbors.forEachCandidateUntil(
        agent,
        current.x[agent]!,
        current.y[agent]!,
        this.plannedVelocityX[agent]!,
        this.plannedVelocityY[agent]!,
        UNIFIED_TIME_HORIZON,
        expansion,
        this.visitSolverCandidate,
      );
      if (this.solverQuerySaturated) {
        this.solverNeighborCount = this.solverNeighborOffsets[agent]!
          + OVERLOAD_SOLVER_NEIGHBORS_PER_AGENT;
      }
      this.sortSolverNeighborRange(this.solverNeighborOffsets[agent]!, this.solverNeighborCount);
    }
    this.solverNeighborOffsets[current.count] = this.solverNeighborCount;
  }

  private accumulateSolverCandidate(candidate: number): boolean {
    if (candidate === this.queryAgent || this.activeThisStep[candidate] !== 1) return true;
    this.candidateChecks += 1;
    const current = this.state;
    const dx = current.x[candidate]! - current.x[this.queryAgent]!;
    const dy = current.y[candidate]! - current.y[this.queryAgent]!;
    const relativeVelocityX = this.plannedVelocityX[candidate]! - this.plannedVelocityX[this.queryAgent]!;
    const relativeVelocityY = this.plannedVelocityY[candidate]! - this.plannedVelocityY[this.queryAgent]!;
    const relativeSpeedSquared = relativeVelocityX * relativeVelocityX
      + relativeVelocityY * relativeVelocityY;
    const closestTime = relativeSpeedSquared > 1e-9
      ? clamp(
        -(dx * relativeVelocityX + dy * relativeVelocityY) / relativeSpeedSquared,
        0,
        UNIFIED_TIME_HORIZON,
      )
      : 0;
    const closestX = dx + relativeVelocityX * closestTime;
    const closestY = dy + relativeVelocityY * closestTime;
    const comfortRadius = this.config.agentRadius * 2 + Math.max(0, this.config.agentGap);
    const activationRadius = comfortRadius + 2;
    const currentDistanceSquared = dx * dx + dy * dy;
    if (
      closestX * closestX + closestY * closestY > activationRadius * activationRadius
      && currentDistanceSquared > activationRadius * activationRadius
    ) return true;
    const start = this.solverNeighborOffsets[this.queryAgent]!;
    if (this.solverNeighborCount - start >= MAX_SOLVER_NEIGHBORS_PER_AGENT) {
      this.solverQuerySaturated = true;
      return false;
    }
    if (this.solverNeighborCount >= this.solverNeighborIndices.length) {
      const grown = new Int32Array(Math.max(1, this.solverNeighborIndices.length * 2));
      grown.set(this.solverNeighborIndices);
      this.solverNeighborIndices = grown;
    }
    this.solverNeighborIndices[this.solverNeighborCount] = candidate;
    this.solverNeighborCount += 1;
    const keepScanning = this.solverNeighborCount - start < MAX_SOLVER_NEIGHBORS_PER_AGENT;
    this.solverQuerySaturated = !keepScanning;
    return keepScanning;
  }

  private sortSolverNeighborRange(start: number, end: number): void {
    const length = end - start;
    if (length >= 16) {
      for (let root = Math.floor(length * 0.5) - 1; root >= 0; root -= 1) {
        this.siftSolverNeighborHeap(start, length, root);
      }
      for (let last = length - 1; last > 0; last -= 1) {
        const value = this.solverNeighborIndices[start]!;
        this.solverNeighborIndices[start] = this.solverNeighborIndices[start + last]!;
        this.solverNeighborIndices[start + last] = value;
        this.siftSolverNeighborHeap(start, last, 0);
      }
      return;
    }
    for (let index = start + 1; index < end; index += 1) {
      const value = this.solverNeighborIndices[index]!;
      let target = index - 1;
      while (target >= start && this.solverNeighborIndices[target]! > value) {
        this.solverNeighborIndices[target + 1] = this.solverNeighborIndices[target]!;
        target -= 1;
      }
      this.solverNeighborIndices[target + 1] = value;
    }
  }

  private siftSolverNeighborHeap(start: number, length: number, root: number): void {
    let parent = root;
    const value = this.solverNeighborIndices[start + parent]!;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= length) break;
      const right = left + 1;
      const child = right < length
        && this.solverNeighborIndices[start + right]! > this.solverNeighborIndices[start + left]!
        ? right
        : left;
      if (this.solverNeighborIndices[start + child]! <= value) break;
      this.solverNeighborIndices[start + parent] = this.solverNeighborIndices[start + child]!;
      parent = child;
    }
    this.solverNeighborIndices[start + parent] = value;
  }

  private loadCachedNeighbors(agent: number): void {
    const start = this.neighborOffsets[agent]!;
    const end = this.neighborOffsets[agent + 1]!;
    this.neighborCount = end - start;
    for (let offset = 0; offset < this.neighborCount; offset += 1) {
      this.neighborIndices[offset] = this.cachedNeighborIndices[start + offset]!;
    }
  }

  private accumulateCandidate(candidate: number): boolean {
    if (candidate === this.queryAgent || this.activeThisStep[candidate] !== 1) return true;
    this.candidateChecks += 1;
    const dx = this.state.x[this.queryAgent]! - this.state.x[candidate]!;
    const dy = this.state.y[this.queryAgent]! - this.state.y[candidate]!;
    const squared = dx * dx + dy * dy;
    if (squared > this.queryRadius * this.queryRadius) return true;
    const start = this.neighborOffsets[this.queryAgent]!;
    if (this.cachedNeighborCount - start >= MAX_CACHED_NEIGHBORS_PER_AGENT) {
      this.cachedQuerySaturated = true;
      return false;
    }
    if (this.cachedNeighborCount >= this.cachedNeighborIndices.length) {
      const grown = new Int32Array(Math.max(1, this.cachedNeighborIndices.length * 2));
      grown.set(this.cachedNeighborIndices);
      this.cachedNeighborIndices = grown;
    }
    this.cachedNeighborIndices[this.cachedNeighborCount] = candidate;
    this.cachedNeighborCount += 1;
    const keepScanning = this.cachedNeighborCount - start < MAX_CACHED_NEIGHBORS_PER_AGENT;
    this.cachedQuerySaturated = !keepScanning;
    return keepScanning;
  }

  private sortCachedNeighborRange(start: number, end: number): void {
    const length = end - start;
    if (length >= 16) {
      for (let root = Math.floor(length * 0.5) - 1; root >= 0; root -= 1) {
        this.siftCachedNeighborHeap(start, length, root);
      }
      for (let last = length - 1; last > 0; last -= 1) {
        const value = this.cachedNeighborIndices[start]!;
        this.cachedNeighborIndices[start] = this.cachedNeighborIndices[start + last]!;
        this.cachedNeighborIndices[start + last] = value;
        this.siftCachedNeighborHeap(start, last, 0);
      }
      return;
    }
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

  private siftCachedNeighborHeap(start: number, length: number, root: number): void {
    let parent = root;
    const value = this.cachedNeighborIndices[start + parent]!;
    while (true) {
      const left = parent * 2 + 1;
      if (left >= length) break;
      const right = left + 1;
      const child = right < length
        && this.cachedNeighborIndices[start + right]! > this.cachedNeighborIndices[start + left]!
        ? right
        : left;
      if (this.cachedNeighborIndices[start + child]! <= value) break;
      this.cachedNeighborIndices[start + parent] = this.cachedNeighborIndices[start + child]!;
      parent = child;
    }
    this.cachedNeighborIndices[start + parent] = value;
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
    const goal = this.flowGoals[this.agentFlow[agent]!]!;
    input.distanceToGoal = Math.sqrt(distanceSquared(
      current.x[agent]!,
      current.y[agent]!,
      goal.x,
      goal.y,
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
    this.updateFlowControl(current);
    const hasFlowControl = this.scenario.flowControl !== undefined && this.flowCount > 1;
    // Unified uses a pass-through/despawn arrival policy: entering the goal
    // disk completes the route, so braking toward the disk center would only
    // delay completion. Legacy pipelines retain their center-target slowdown.
    const arrivalRadius = (this.config.pipeline ?? 'current') === 'unified'
      ? this.config.goalRadius
      : Math.max(this.config.arrivalSlowRadius, this.config.goalRadius * 1.5);
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
      const flow = this.agentFlow[i]!;
      const goal = this.flowGoals[flow]!;
      const spawn = this.flowSpawns[flow]!;
      const navigator = this.flowNavigators[flow]!;
      const approachUnitX = this.flowApproachX[flow]!;
      const approachUnitY = this.flowApproachY[flow]!;
      this.routeCost[i] = navigator.sampleCost(current.x[i]!, current.y[i]!);
      const distanceToGoal = Math.sqrt(distanceSquared(current.x[i]!, current.y[i]!, goal.x, goal.y));
      navigator.sampleDirection(current.x[i]!, current.y[i]!, this.flowDirection);
      if (
        (this.config.pipeline ?? 'current') === 'unified'
        && this.scenario.obstacles.length === 0
      ) {
        // Preserve formation in open space instead of steering every packed
        // row toward the same point from frame one. The flow direction blends
        // back near the goal, where agents fan into their arrival slots.
        const parallelWeight = clamp(
          (distanceToGoal - arrivalRadius * 2) / Math.max(arrivalRadius, 1e-9),
          0,
          1,
        );
        const parallelX = this.flowDirection.x * (1 - parallelWeight) + approachUnitX * parallelWeight;
        const parallelY = this.flowDirection.y * (1 - parallelWeight) + approachUnitY * parallelWeight;
        const parallelLength = Math.hypot(parallelX, parallelY);
        if (parallelLength > 1e-9) {
          this.flowDirection.x = parallelX / parallelLength;
          this.flowDirection.y = parallelY / parallelLength;
        }
      }
      if (hasFlowControl) {
        this.applyFlowLaneGuidance(
          i,
          current.x[i]!,
          current.y[i]!,
          approachUnitX,
          approachUnitY,
          spawn,
        );
      }
      this.applyCorridorDispersion(i, current.x[i]!, current.y[i]!, goal, spawn);
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
      const goalPlaneOffset = (current.x[i]! - goal.x) * approachUnitX
        + (current.y[i]! - goal.y) * approachUnitY;
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
      const freeSpeed = this.config.maxSpeed * Math.min(1, distanceToGoal / Math.max(arrivalRadius, 1e-9));
      const desiredSpeed = hasFlowControl
        ? this.applyFlowControlSpeed(
            i,
            current.x[i]!,
            current.y[i]!,
            preferredX,
            preferredY,
            freeSpeed,
          )
        : freeSpeed;
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
  private applyCorridorDispersion(
    agent: number,
    x: number,
    y: number,
    goal: Vec2,
    spawn: Rect,
  ): void {
    if (this.scenario.obstacles.length === 0) return;
    const toGoalX = goal.x - x;
    const toGoalY = goal.y - y;
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
      const goalCoordinate = horizontal ? goal.x : goal.y;
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
      if ((goalCoordinate - far) * progressSign <= 0) continue;
      // Hand route authority to the next portal as soon as this obstacle's far
      // face is physically clear. Keeping the previous lane target for the
      // whole exit lead makes alternating portals start their lateral turn too
      // late and creates a dense 90-degree queue at the following gate.
      const lateralPosition = horizontal ? y : x;
      const outsidePortal = lateralPosition <= minimum - this.config.agentGap
        || lateralPosition >= maximum + this.config.agentGap;
      const earlyHandoff = outsidePortal
        && (position - far) * progressSign > -this.config.cellSize * 0.5;
      if (
        distanceToNear > activationDistance
        || (position - far) * progressSign > 0
        || earlyHandoff
      ) continue;

      const lateralFlow = horizontal ? this.flowDirection.y : this.flowDirection.x;
      let side = lateralPosition < minimum - 1e-9
        ? -1
        : lateralPosition > maximum + 1e-9 ? 1 : Math.sign(lateralFlow);
      if (isSplitter && (position - far) * progressSign <= exitLead) {
        const formationUnit = horizontal ? this.formationUnitY[agent]! : this.formationUnitX[agent]!;
        const spawnMinimum = horizontal ? spawn.y : spawn.x;
        const spawnSpan = horizontal ? spawn.height : spawn.width;
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
    let usableLaneMinimum = laneMinimum + laneMargin;
    let usableLaneMaximum = laneMaximum - laneMargin;
    if (bestIsSplitter) {
      // Keep the same usable portal width but bias it toward the splitter's
      // inner edge. Centering it in the outside pocket made every route travel
      // tens of pixels toward the world boundary and then undo that detour at
      // the next alternating portal.
      const usableSpan = (usableLaneMaximum - usableLaneMinimum) * 0.85;
      const innerInset = Math.max(0.5, this.config.agentGap);
      if (bestSide < 0) {
        usableLaneMaximum = laneMaximum - innerInset;
        usableLaneMinimum = usableLaneMaximum - usableSpan;
      } else {
        usableLaneMinimum = laneMinimum + innerInset;
        usableLaneMaximum = usableLaneMinimum + usableSpan;
      }
    }
    const formationUnit = horizontal ? this.formationUnitY[agent]! : this.formationUnitX[agent]!;
    const spawnMinimum = horizontal ? spawn.y : spawn.x;
    const spawnSpan = horizontal ? spawn.height : spawn.width;
    const obstacleCenter = horizontal
      ? obstacle.y + obstacle.height * 0.5
      : obstacle.x + obstacle.width * 0.5;
    const routeCut = clamp((obstacleCenter - spawnMinimum) / Math.max(spawnSpan, 1e-9), 0, 1);
    let laneUnit = bestSide < 0
      ? routeCut > 1e-9 ? clamp(formationUnit / routeCut, 0, 1) : formationUnit
      : routeCut < 1 - 1e-9 ? clamp((formationUnit - routeCut) / (1 - routeCut), 0, 1) : formationUnit;
    if (bestIsSplitter) {
      // Preserve lateral ordering while giving the shorter inner portal lanes
      // more of the spawn width. Depending on longitudinal rank here makes a
      // single row cross itself and creates seed-sensitive merge shocks.
      laneUnit = bestSide < 0
        ? Math.sqrt(laneUnit)
        : 1 - Math.sqrt(1 - laneUnit);
    }
    const lane = usableLaneMinimum + (usableLaneMaximum - usableLaneMinimum) * laneUnit;
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

  private configureFlows(): void {
    const definitions: readonly ScenarioFlowDefinition[] = this.scenario.flows?.length
      ? this.scenario.flows
      : [{
          id: this.scenario.id,
          spawn: this.scenario.spawn,
          goal: this.scenario.goal,
        }];
    this.flowGoals = definitions.map((flow) => ({ ...flow.goal }));
    this.flowSpawns = definitions.map((flow) => ({ ...flow.spawn }));
    this.flowIds = definitions.map((flow) => flow.id);
    this.flowWeights = definitions.map((flow) => Math.max(0, flow.weight ?? 1));
    this.flowApproachX = new Float64Array(definitions.length);
    this.flowApproachY = new Float64Array(definitions.length);
    this.flowActiveCounts = new Uint32Array(definitions.length);
    this.flowInsideCounts = new Uint32Array(definitions.length);
    this.flowControlOwner = 0;
    this.flowControlPhaseStep = 0;
    this.flowControlDraining = false;
    this.goal = { ...this.flowGoals[0]! };
    const clearance = this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN;
    const navigators = new Array<FlowField>(definitions.length);
    for (let flow = 0; flow < definitions.length; flow += 1) {
      const spawn = this.flowSpawns[flow]!;
      const goal = this.flowGoals[flow]!;
      const approachX = goal.x - (spawn.x + spawn.width * 0.5);
      const approachY = goal.y - (spawn.y + spawn.height * 0.5);
      const approachLength = Math.hypot(approachX, approachY);
      this.flowApproachX[flow] = approachLength > 1e-9 ? approachX / approachLength : 1;
      this.flowApproachY[flow] = approachLength > 1e-9 ? approachY / approachLength : 0;
      const navigator = flow === 0
        ? this.navigator
        : this.flowNavigators[flow] ?? new FlowField(
            this.config.width,
            this.config.height,
            this.config.cellSize,
          );
      navigator.rebuild(this.flowGoals[flow]!, this.scenario.obstacles, clearance);
      navigators[flow] = navigator;
    }
    this.flowNavigators = navigators;
  }

  private updateFlowControl(current: AgentBuffer): void {
    const control = this.scenario.flowControl;
    if (!control || this.flowCount <= 1) return;
    this.flowActiveCounts.fill(0);
    this.flowInsideCounts.fill(0);
    const radiusSquared = Math.max(0, control.radius) ** 2;
    let inside = 0;
    for (let agent = 0; agent < current.count; agent += 1) {
      if (this.activeThisStep[agent] !== 1) continue;
      const flow = this.agentFlow[agent]!;
      this.flowActiveCounts[flow] = this.flowActiveCounts[flow]! + 1;
      const dx = current.x[agent]! - control.center.x;
      const dy = current.y[agent]! - control.center.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      this.flowInsideCounts[flow] = this.flowInsideCounts[flow]! + 1;
      inside += 1;
    }

    if (
      !this.flowControlDraining
      && this.stepCount - this.flowControlPhaseStep >= Math.max(1, control.greenSteps)
    ) this.flowControlDraining = true;

    if (
      (this.flowControlDraining && inside === 0)
      || this.flowActiveCounts[this.flowControlOwner] === 0
    ) {
      const next = this.nextActiveFlow(this.flowControlOwner);
      if (next >= 0) this.flowControlOwner = next;
      this.flowControlPhaseStep = this.stepCount;
      this.flowControlDraining = false;
    }
  }

  private nextActiveFlow(after: number): number {
    for (let offset = 1; offset <= this.flowCount; offset += 1) {
      const flow = (after + offset) % this.flowCount;
      if (this.flowActiveCounts[flow]! > 0) return flow;
    }
    return -1;
  }

  private applyFlowControlSpeed(
    agent: number,
    x: number,
    y: number,
    directionX: number,
    directionY: number,
    desiredSpeed: number,
  ): number {
    const control = this.scenario.flowControl;
    if (!control || this.flowCount <= 1) return desiredSpeed;
    const flow = this.agentFlow[agent]!;
    if (flow === this.flowControlOwner && !this.flowControlDraining) return desiredSpeed;
    const offsetX = control.center.x - x;
    const offsetY = control.center.y - y;
    const forward = offsetX * directionX + offsetY * directionY;
    const radius = Math.max(0, control.radius);
    if (forward <= radius) return desiredSpeed;
    const lateral = Math.abs(offsetX * -directionY + offsetY * directionX);
    if (lateral > radius * 1.6 + this.config.agentRadius * 2) return desiredSpeed;
    const approachDistance = Math.max(this.config.agentRadius * 2, control.approachDistance);
    const distanceToStop = forward - radius - this.config.agentRadius * 2;
    if (distanceToStop >= approachDistance) return desiredSpeed;
    const speedScale = clamp(distanceToStop / approachDistance, 0, 1);
    return Math.min(desiredSpeed, this.config.maxSpeed * speedScale);
  }

  private applyFlowLaneGuidance(
    agent: number,
    x: number,
    y: number,
    approachX: number,
    approachY: number,
    spawn: Rect,
  ): void {
    const control = this.scenario.flowControl;
    const laneOffset = control?.laneOffset ?? 0;
    const laneWidth = Math.max(0, control?.laneWidth ?? 0);
    if (!control || laneOffset <= 0 || laneWidth <= 0) return;
    const rightX = -approachY;
    const rightY = approachX;
    const initialX = spawn.x + this.formationUnitX[agent]! * spawn.width;
    const initialY = spawn.y + this.formationUnitY[agent]! * spawn.height;
    const first = (spawn.x - control.center.x) * rightX
      + (spawn.y - control.center.y) * rightY;
    const second = (spawn.x + spawn.width - control.center.x) * rightX
      + (spawn.y - control.center.y) * rightY;
    const third = (spawn.x - control.center.x) * rightX
      + (spawn.y + spawn.height - control.center.y) * rightY;
    const fourth = (spawn.x + spawn.width - control.center.x) * rightX
      + (spawn.y + spawn.height - control.center.y) * rightY;
    const minimum = Math.min(first, second, third, fourth);
    const maximum = Math.max(first, second, third, fourth);
    const initialProjection = (initialX - control.center.x) * rightX
      + (initialY - control.center.y) * rightY;
    const formation = clamp(
      (initialProjection - minimum) / Math.max(maximum - minimum, 1e-9),
      0,
      1,
    );
    const targetLateral = laneOffset + (formation - 0.5) * laneWidth;
    const currentLateral = (x - control.center.x) * rightX
      + (y - control.center.y) * rightY;
    const correction = clamp(
      (targetLateral - currentLateral) / Math.max(control.approachDistance, 1e-9),
      -0.55,
      0.55,
    );
    let guidedX = this.flowDirection.x + rightX * correction;
    let guidedY = this.flowDirection.y + rightY * correction;
    const progress = guidedX * approachX + guidedY * approachY;
    if (progress < 0) {
      guidedX -= approachX * progress;
      guidedY -= approachY * progress;
    }
    const length = Math.hypot(guidedX, guidedY);
    if (length <= 1e-9) return;
    this.flowDirection.x = guidedX / length;
    this.flowDirection.y = guidedY / length;
  }

  private rebuildArrivalSlots(): void {
    for (let i = 0; i < this.state.count; i += 1) {
      const goal = this.flowGoals[this.agentFlow[i]!]!;
      computeArrivalSlot(
        i,
        this.config.seed,
        goal,
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

  private createSpawnPositions(random: SeededRandom): SpawnPlacement[] {
    const spacing = this.config.agentRadius * 2 + Math.max(this.config.agentGap, 0.08);
    const placementIndex = new PlacementIndex(this.config.agentRadius * 2 + 0.01);
    const selected: SpawnPlacement[] = [];
    const counts = this.allocateFlowCounts(this.config.agentCount);
    const world: Rect = { x: 0, y: 0, width: this.config.width, height: this.config.height };
    for (let flow = 0; flow < this.flowSpawns.length; flow += 1) {
      const target = counts[flow]!;
      let placed = 0;
      const spawn = this.flowSpawns[flow]!;
      const spawnCandidates = this.createHexCandidates(spawn, this.config.agentRadius, spacing)
        .filter((position) => this.isValidPlacement(position));
      this.shuffle(spawnCandidates, random);
      for (const position of spawnCandidates) {
        if (placed >= target) break;
        if (!placementIndex.canAdd(position)) continue;
        selected.push({ ...position, flow });
        placementIndex.add(position);
        placed += 1;
      }
      if (placed >= target) continue;

      const overflowCandidates = this.createHexCandidates(
        world,
        this.config.agentRadius + this.config.wallMargin + STATIC_CONTACT_SKIN,
        spacing,
      ).filter((position) => this.isValidPlacement(position));
      overflowCandidates.sort((first, second) => {
        const distanceDifference = distanceSquaredToRect(first.x, first.y, spawn)
          - distanceSquaredToRect(second.x, second.y, spawn);
        return distanceDifference || first.y - second.y || first.x - second.x;
      });
      for (const position of overflowCandidates) {
        if (placed >= target) break;
        if (!placementIndex.canAdd(position)) continue;
        selected.push({ ...position, flow });
        placementIndex.add(position);
        placed += 1;
      }
    }
    return selected;
  }

  private allocateFlowCounts(total: number): number[] {
    const weights = this.flowWeights;
    let weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    if (weightSum <= 0) weightSum = weights.length;
    const counts = new Array<number>(weights.length).fill(0);
    const remainders = new Float64Array(weights.length);
    let assigned = 0;
    for (let flow = 0; flow < weights.length; flow += 1) {
      const weight = weightSum === weights.length && weights.every((value) => value <= 0)
        ? 1
        : weights[flow]!;
      const exact = total * weight / weightSum;
      counts[flow] = Math.floor(exact);
      remainders[flow] = exact - counts[flow]!;
      assigned += counts[flow]!;
    }
    while (assigned < total) {
      let best = 0;
      for (let flow = 1; flow < remainders.length; flow += 1) {
        if (remainders[flow]! > remainders[best]! + 1e-12) best = flow;
      }
      counts[best] = counts[best]! + 1;
      remainders[best] = -1;
      assigned += 1;
    }
    return counts;
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
  pipeline: 'current',
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
