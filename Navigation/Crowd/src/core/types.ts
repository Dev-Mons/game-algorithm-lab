export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 'current' runs the legacy layered pipeline (free-gap + reciprocal + priority
 * reservation). 'minimal' keeps the P1 experiment for historical A/B results.
 * 'unified' gives one acceleration-aware velocity solver routine movement
 * authority and uses reservation/depenetration only as residual safety guards.
 * Undefined behaves as 'current' for backwards compatibility.
 */
export type PipelineKind = 'current' | 'minimal' | 'unified';

export interface SimulationConfig {
  width: number;
  height: number;
  cellSize: number;
  agentCount: number;
  seed: number;
  pipeline?: PipelineKind;
  maxSpeed: number;
  maxAcceleration: number;
  /** Maximum steering-heading rotation in radians per second. */
  maxTurnRate: number;
  agentRadius: number;
  neighborRadius: number;
  agentGap: number;
  wallMargin: number;
  avoidanceHorizon: number;
  avoidanceBiasSeconds: number;
  goalRadius: number;
  fixedDelta: number;
  arrivalSlowRadius: number;
  stallSeconds: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  goal: Vec2;
  obstacles: Rect[];
  spawn: Rect;
  /** Optional independent command streams sharing the same physical world. */
  flows?: readonly ScenarioFlowDefinition[];
  /** Optional deterministic capacity control for a shared merge/crossing zone. */
  flowControl?: FlowControlDefinition;
}

export interface ScenarioFlowDefinition {
  id: string;
  spawn: Rect;
  goal: Vec2;
  /** Relative spawn allocation; omitted values default to one. */
  weight?: number;
}

export interface FlowControlDefinition {
  center: Vec2;
  /** Radius of the conflict zone that must drain before ownership changes. */
  radius: number;
  /** Distance before the stop line over which a red flow smoothly brakes. */
  approachDistance: number;
  /** Maximum fixed steps admitted for one flow before drain-and-switch. */
  greenSteps: number;
  /** Optional right-hand lane center offset for opposing bidirectional flows. */
  laneOffset?: number;
  /** Formation-preserving width allocated around the lane center. */
  laneWidth?: number;
}

export interface StepMetrics {
  activeCount: number;
  arrivedCount: number;
  arrivalRate: number;
  averageSpeed: number;
  overlapPairs: number;
  stalledCount: number;
  averageNeighbors: number;
  maxNeighbors: number;
  candidateChecks: number;
  backwardCount: number;
  strongBackwardCount: number;
  wallOverlapCount: number;
  averageVelocityDelta: number;
  maxVelocityDelta: number;
  averageAcceleration: number;
  maxAcceleration: number;
  averageJerk: number;
  maxJerk: number;
  hardStopCount: number;
  emergencyStopCount: number;
  stopMoveStopCount: number;
  sideSwitchCount: number;
  longAdjacentStopCount: number;
  /** Agents whose own proposal was shortened by front-to-back reservation. */
  reservationLimitedCount: number;
  /** Limited agents that yielded their complete proposed displacement. */
  reservationStoppedCount: number;
  /** Largest velocity reduction caused by reservation in this step. */
  maxReservationVelocityChange: number;
  /** Number of reciprocal velocity half-planes built in this step. */
  reciprocalConstraintCount: number;
  /** Agents requiring the deterministic half-plane projection repair pass. */
  reciprocalProjectionRepairCount: number;
  /** Minimal pipeline: agents whose position was moved by symmetric relaxation. */
  relaxationCorrectedCount: number;
  /** Minimal pipeline: largest per-agent relaxation correction this step, in px. */
  maxRelaxationCorrection: number;
  /** Unified pipeline: agents changed by the residual swept safety fallback. */
  safetyFallbackCount: number;
  /** Unified pipeline: largest velocity change made by the safety fallback. */
  maxSafetyFallbackVelocityChange: number;
  /** Unified pipeline: active agents for which the hard velocity set was infeasible. */
  unifiedInfeasibleCount: number;
}

/** Allocation-on-request debug view; simulation hot paths store scalar arrays. */
export interface AgentLayerTrace {
  agent: number;
  flow: number;
  goal: Vec2;
  step: number;
  active: boolean;
  position: Vec2;
  currentVelocity: Vec2;
  globalDirection: Vec2;
  routeCost: number;
  localDensity: number;
  meanNeighborVelocity: Vec2;
  leaderId: number;
  leaderGap: number;
  leaderSpeed: number;
  desiredSpeed: number;
  plannedVelocity: Vec2;
  localVelocity: Vec2;
  finalVelocity: Vec2;
  fallbackReason: 'none' | 'solver-relaxation' | 'static-slide' | 'dynamic-reservation' | 'depenetration';
  neighborCount: number;
  minimumDistance: number;
  limitingNeighborId: number;
  minimumTimeToCollision: number;
  layerVelocityDelta: {
    crowdPreference: number;
    localSolver: number;
    safetyFallback: number;
  };
}

/** Zero-copy, read-only-by-convention buffers used by optional debug drawing. */
export interface CrowdDebugLayers {
  preferredVelocityX: Float64Array;
  preferredVelocityY: Float64Array;
  localVelocityX: Float64Array;
  localVelocityY: Float64Array;
  density: Float64Array;
  fallbackReason: Uint8Array;
}

export interface NeighborIndex {
  rebuild(x: Float64Array, y: Float64Array, active: Uint8Array): void;
  forEachCandidate(x: number, y: number, radius: number, visit: (index: number) => void): void;
}

export interface GlobalNavigator {
  rebuild(goal: Vec2, obstacles: readonly Rect[], clearance?: number): void;
  sampleDirection(x: number, y: number, out: Vec2): boolean;
  isBlockedAt(x: number, y: number): boolean;
}

export interface Renderer {
  render(alpha: number): void;
}
