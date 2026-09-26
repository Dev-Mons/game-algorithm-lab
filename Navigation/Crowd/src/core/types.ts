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

export interface SimulationConfig extends CrowdConfig {
  /** Lab-only preset and placement settings. */
  preset?: string;
  experiment?: Partial<{ destination: 'exit' | 'slots'; [key: string]: string | number | boolean }>;
  agentCount: number;
  seed: number;
  largeAgentPercent: number;
  largeAgentScale: number;
  neighborRadius: number;
}

export interface CrowdConfig {
  width: number;
  height: number;
  navCellSize: number;
  crowdFieldCellSize: number;
  contactCellSize: number;
  maxSpeed: number;
  maxAcceleration: number;
  /** Maximum commanded movement heading change in degrees per simulation second. */
  turnSpeed: number;
  agentRadius: number;
  agentGap: number;
  wallMargin: number;
  crowdPressureRelaxationTime: number;
  goalRadius: number;
  fixedDelta: number;
  arrivalSlowRadius: number;
  stallSeconds: number;
  crowdPressureIterations: number;
  pressureThreshold: number;
  crowdVelocityBlend: number;
  contactCompliance: number;
  contactFriction: number;
  maximumContactCorrection: number;
  /** Opt-in legacy congestion routing; the interactive app uses a fixed field. */
  dynamicRouting: boolean;
  dynamicFlowRebuildInterval: number;
  dynamicFlowTargetDensity: number;
  dynamicFlowDensityWeight: number;
  dynamicFlowOverloadWeight: number;
  dynamicFlowCounterFlowWeight: number;
  dynamicFlowWallWeight: number;
  dynamicFlowCostSmoothing: number;
  dynamicFlowDirectionHysteresis: number;
  directGoalLowDensity: number;
  directGoalCounterFlow: number;
  directGoalMinimumClearance: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  goal: Vec2;
  obstacles: Rect[];
  spawn: Rect;
  flows?: readonly ScenarioFlowDefinition[];
  routeGates?: readonly ScenarioRouteGateDefinition[];
}

export interface ScenarioFlowDefinition {
  id: string;
  spawn: Rect;
  goal: Vec2;
  weight?: number;
}

export interface ScenarioRouteGateDefinition {
  id: string;
  region: Rect;
  capacity?: number;
  /** Travel axis; a door and a long corridor cannot be distinguished from the rectangle alone. */
  axis?: 'x' | 'y';
}

export interface StepMetrics {
  activeCount: number;
  arrivedCount: number;
  arrivalRate: number;
  averageSpeed: number;
  overlapPairs: number;
  recoveredAgents: number;
  maxRecoveryDistance: number;
  stalledCount: number;
  averageNeighbors: number;
  maxNeighbors: number;
  candidateChecks: number;
  backwardCount: number;
  wallOverlapCount: number;
  averageVelocityDelta: number;
  maxVelocityDelta: number;
  averageAcceleration: number;
  maxAcceleration: number;
  contactChecks: number;
  contactConstraints: number;
  constraintIterations: number;
  maxContacts: number;
  contactCorrectedAgents: number;
  maxContactCorrection: number;
  staticProjectionCorrections: number;
  dynamicRebuildCount: number;
  dynamicRebuildMs: number;
  dynamicRebuildIntervalSteps: number;
  dynamicRebuildAgeSteps: number;
}

export interface CrowdDebugLayers {
  desiredVelocityX: Float64Array;
  desiredVelocityY: Float64Array;
  solvedVelocityX: Float64Array;
  solvedVelocityY: Float64Array;
  density: Float64Array;
  recovery: Uint8Array;
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
