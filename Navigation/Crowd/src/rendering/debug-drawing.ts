import type { CrowdSimulation } from '../core/simulation';

export interface DebugOptions {
  flowField: boolean;
  spatialGrid: boolean;
  velocity: boolean;
  desiredVelocity: boolean;
  density: boolean;
  recovery: boolean;
  neighborRadius: boolean;
  overlaps: boolean;
  stalled: boolean;
}

export const DEFAULT_DEBUG_OPTIONS: DebugOptions = {
  flowField: false,
  spatialGrid: false,
  velocity: false,
  desiredVelocity: false,
  density: false,
  recovery: true,
  neighborRadius: false,
  overlaps: true,
  stalled: true,
};

export function drawDebug(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  options: DebugOptions,
  alpha = 1,
): void {
  if (options.density) drawDensity(context, simulation, alpha);
  if (options.spatialGrid) drawSpatialGrid(context, simulation);
  if (options.flowField) drawFlowField(context, simulation);
  if (options.neighborRadius) drawNeighborRadii(context, simulation, alpha);
  if (options.desiredVelocity) drawDesiredVelocity(context, simulation, alpha);
  if (options.velocity) drawVelocity(context, simulation, alpha);
  if (options.recovery) drawRecovery(context, simulation, alpha);
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

function drawNeighborRadii(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  alpha: number,
): void {
  context.save();
  context.strokeStyle = 'rgba(167, 139, 250, 0.28)';
  context.lineWidth = 1;
  for (let agent = 0; agent < simulation.state.count; agent += 20) {
    if (simulation.state.active[agent] !== 1) continue;
    context.beginPath();
    context.arc(
      renderX(simulation, agent, alpha),
      renderY(simulation, agent, alpha),
      simulation.config.neighborRadius,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
  context.restore();
}

function drawVelocity(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  alpha: number,
): void {
  context.save();
  context.strokeStyle = 'rgba(250, 204, 21, 0.55)';
  context.lineWidth = 1;
  context.beginPath();
  for (let agent = 0; agent < simulation.state.count; agent += 5) {
    if (simulation.state.active[agent] !== 1) continue;
    const x = renderX(simulation, agent, alpha);
    const y = renderY(simulation, agent, alpha);
    context.moveTo(x, y);
    context.lineTo(x + simulation.state.vx[agent]! * 0.18, y + simulation.state.vy[agent]! * 0.18);
  }
  context.stroke();
  context.restore();
}

function drawDesiredVelocity(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  alpha: number,
): void {
  const layers = simulation.debugLayers;
  context.save();
  context.strokeStyle = 'rgba(34, 211, 238, 0.72)';
  context.lineWidth = 1;
  context.beginPath();
  for (let agent = 0; agent < simulation.state.count; agent += 5) {
    if (simulation.state.active[agent] !== 1) continue;
    const x = renderX(simulation, agent, alpha);
    const y = renderY(simulation, agent, alpha);
    context.moveTo(x, y);
    context.lineTo(
      x + layers.desiredVelocityX[agent]! * 0.18,
      y + layers.desiredVelocityY[agent]! * 0.18,
    );
  }
  context.stroke();
  context.restore();
}

function drawDensity(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  alpha: number,
): void {
  const density = simulation.debugLayers.density;
  const radius = simulation.config.agentRadius * 2.4;
  context.save();
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1 || density[agent]! <= 0.02) continue;
    const normalized = Math.min(1, Math.max(0, density[agent]!));
    context.fillStyle = `rgba(251, ${Math.round(191 - normalized * 120)}, 36, ${0.05 + normalized * 0.2})`;
    context.beginPath();
    context.arc(renderX(simulation, agent, alpha), renderY(simulation, agent, alpha), radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawRecovery(
  context: CanvasRenderingContext2D,
  simulation: CrowdSimulation,
  alpha: number,
): void {
  const recovery = simulation.debugLayers.recovery;
  context.save();
  context.strokeStyle = '#fb923c';
  context.lineWidth = 2.2;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (recovery[agent] !== 1 || simulation.state.active[agent] !== 1) continue;
    context.beginPath();
    context.arc(
      renderX(simulation, agent, alpha),
      renderY(simulation, agent, alpha),
      simulation.config.agentRadius + 4,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
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
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    const overlapping = options.overlaps && simulation.overlapFlags[agent] === 1;
    const stalled = options.stalled
      && simulation.state.active[agent] === 1
      && simulation.state.stalledFor[agent]! >= simulation.config.stallSeconds;
    if (!overlapping && !stalled) continue;
    context.strokeStyle = overlapping ? '#fb7185' : '#fbbf24';
    context.beginPath();
    context.arc(simulation.state.x[agent]!, simulation.state.y[agent]!, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function renderX(simulation: CrowdSimulation, agent: number, alpha: number): number {
  const interpolation = Math.min(1, Math.max(0, alpha));
  return simulation.previousState.x[agent]!
    + (simulation.state.x[agent]! - simulation.previousState.x[agent]!) * interpolation;
}

function renderY(simulation: CrowdSimulation, agent: number, alpha: number): number {
  const interpolation = Math.min(1, Math.max(0, alpha));
  return simulation.previousState.y[agent]!
    + (simulation.state.y[agent]! - simulation.previousState.y[agent]!) * interpolation;
}
