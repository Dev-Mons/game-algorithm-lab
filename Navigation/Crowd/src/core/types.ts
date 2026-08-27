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
 * 'current' runs the full layered pipeline (free-gap + reciprocal + priority
 * reservation). 'minimal' runs the P1 experiment pipeline: flow-field preferred
 * velocity → full-velocity-space ORCA → static slide → symmetric position
 * relaxation. Undefined behaves as 'current'.
 */
export type PipelineKind = 'current' | 'minimal';

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
