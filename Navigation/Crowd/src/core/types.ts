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

export interface SimulationConfig {
  width: number;
  height: number;
  cellSize: number;
  agentCount: number;
  seed: number;
  maxSpeed: number;
  maxAcceleration: number;
  agentRadius: number;
  neighborRadius: number;
  separationWeight: number;
  alignmentWeight: number;
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
}

export interface NeighborIndex {
  rebuild(x: Float64Array, y: Float64Array, active: Uint8Array): void;
  forEachCandidate(x: number, y: number, radius: number, visit: (index: number) => void): void;
}

export interface GlobalNavigator {
  rebuild(goal: Vec2, obstacles: readonly Rect[]): void;
  sampleDirection(x: number, y: number, out: Vec2): boolean;
  isBlockedAt(x: number, y: number): boolean;
}

export interface Renderer {
  render(alpha: number): void;
}
