export interface Disk { id: number; x: number; y: number; radius: number }
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export type SceneName = 'uniform' | 'hole' | 'crack';
export interface ParticleScene {
  version: 1;
  name: SceneName;
  seed: number;
  diameter: number;
  speed: number;
  duration: number;
  support: Box;
  world: Box;
  repairRegion: Box | { x: number; y: number; radius: number };
  disks: Disk[];
  removedCount: number;
}
export interface ParticleState {
  x: Float64Array;
  y: Float64Array;
  /** Absolute world transport velocity, interleaved xy. */
  velocity: Float64Array;
  radius: Float64Array;
  mass: Float64Array;
}
export interface LinearRow {
  indices: number[];
  values: number[];
  bound: number;
  /** Positive weight introduces this row's own nonnegative density slack. */
  slackWeight?: number;
  cell?: number;
  kind: 'density' | 'contact' | 'wall';
}
export interface ProjectionResult {
  velocity: Float64Array;
  dual: Float64Array;
  slack: Float64Array;
  iterations: number;
  converged: boolean;
  primal: number;
  stationarity: number;
  complementarity: number;
  maxSlack: number;
}
export interface GeometryMetrics {
  voidArea: number;
  largestVoidArea: number;
  maxEmptyRadius: number;
  voidCount: number;
  footprintArea: number;
  extentX: number;
  extentY: number;
  mass: number;
  penetration: number;
}
export interface Sample extends GeometryMetrics {
  time: number;
  maxSpeed: number;
  maxObservedSpeed: number;
  maxAcceleration: number;
  maxSlack: number;
  primal: number;
  stationarity: number;
  complementarity: number;
  actualDensityViolation: number;
  iterations: number;
  substeps: number;
  failedSteps: number;
}
export function stateFromScene(scene: ParticleScene): ParticleState {
  const n = scene.disks.length;
  const state: ParticleState = {
    x: new Float64Array(n), y: new Float64Array(n), velocity: new Float64Array(2*n),
    radius: new Float64Array(n), mass: new Float64Array(n),
  };
  scene.disks.forEach((disk, i) => {
    state.x[i] = disk.x; state.y[i] = disk.y; state.radius[i] = disk.radius;
    state.mass[i] = Math.PI * disk.radius**2; state.velocity[2*i] = scene.speed;
  });
  return state;
}
