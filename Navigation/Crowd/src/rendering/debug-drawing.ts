import type { CrowdSimulation } from '../core/simulation';

export interface DebugOptions {
  flowField: boolean;
  spatialGrid: boolean;
  velocity: boolean;
  neighborRadius: boolean;
  overlaps: boolean;
  stalled: boolean;
}

export const DEFAULT_DEBUG_OPTIONS: DebugOptions = {
  flowField: false,
  spatialGrid: false,
  velocity: false,
  neighborRadius: false,
  overlaps: true,
  stalled: true,
};

export function drawDebug(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  options: DebugOptions,
): void {
  if (options.spatialGrid) drawSpatialGrid(context, simulation);
  if (options.flowField) drawFlowField(context, simulation);
  if (options.neighborRadius) drawNeighborRadii(context, simulation);
  if (options.velocity) drawVelocity(context, simulation);
  if (options.overlaps || options.stalled) drawWarnings(context, simulation, options);
}

function drawSpatialGrid(context: CanvasRenderingContext2D, simulation: CrowdSimulation): void {
  context.save();
  context.strokeStyle = 'rgba(74, 222, 128, 0.12)';
  context.lineWidth = 1;
  context.beginPath();
  const size = simulation.neighbors.cellSize;
  for (let x = size; x < simulation.config.width; x += size) {
    context.moveTo(x, 0);
    context.lineTo(x, simulation.config.height);
  }
  for (let y = size; y < simulation.config.height; y += size) {
    context.moveTo(0, y);
    context.lineTo(simulation.config.width, y);
  }
  context.stroke();
  context.restore();
}

function drawFlowField(context: CanvasRenderingContext2D, simulation: CrowdSimulation): void {
  const field = simulation.navigator;
  const half = field.cellSize * 0.5;
  const arrow = field.cellSize * 0.28;
  context.save();
  context.strokeStyle = 'rgba(96, 165, 250, 0.5)';
  context.lineWidth = 1.25;
  context.beginPath();
  for (let row = 0; row < field.rows; row += 1) {
    for (let column = 0; column < field.columns; column += 1) {
      const index = row * field.columns + column;
      const dx = field.directionX[index]!;
      const dy = field.directionY[index]!;
      if (dx === 0 && dy === 0) continue;
      const x = column * field.cellSize + half;
      const y = row * field.cellSize + half;
      context.moveTo(x - dx * arrow * 0.35, y - dy * arrow * 0.35);
      context.lineTo(x + dx * arrow, y + dy * arrow);
    }
  }
  context.stroke();
  context.restore();
}

function drawNeighborRadii(context: CanvasRenderingContext2D, simulation: CrowdSimulation): void {
  context.save();
  context.strokeStyle = 'rgba(167, 139, 250, 0.28)';
  context.lineWidth = 1;
  for (let i = 0; i < simulation.state.count; i += 20) {
    if (simulation.state.active[i] !== 1) continue;
    context.beginPath();
    context.arc(simulation.state.x[i]!, simulation.state.y[i]!, simulation.config.neighborRadius, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawVelocity(context: CanvasRenderingContext2D, simulation: CrowdSimulation): void {
  context.save();
  context.strokeStyle = 'rgba(250, 204, 21, 0.55)';
  context.lineWidth = 1;
  context.beginPath();
  for (let i = 0; i < simulation.state.count; i += 5) {
    if (simulation.state.active[i] !== 1) continue;
    const x = simulation.state.x[i]!;
    const y = simulation.state.y[i]!;
    context.moveTo(x, y);
    context.lineTo(x + simulation.state.vx[i]! * 0.18, y + simulation.state.vy[i]! * 0.18);
  }
  context.stroke();
  context.restore();
}

function drawWarnings(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  options: DebugOptions,
): void {
  const radius = simulation.config.agentRadius + 2.2;
  context.save();
  context.lineWidth = 1.5;
  for (let i = 0; i < simulation.state.count; i += 1) {
    const overlapping = options.overlaps && simulation.overlapFlags[i] === 1;
    const stalled = options.stalled
      && simulation.state.active[i] === 1
      && simulation.state.stalledFor[i]! >= simulation.config.stallSeconds;
    if (!overlapping && !stalled) continue;
    context.strokeStyle = overlapping ? '#fb7185' : '#fbbf24';
    context.beginPath();
    context.arc(simulation.state.x[i]!, simulation.state.y[i]!, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}
