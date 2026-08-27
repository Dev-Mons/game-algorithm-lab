import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { distanceSquaredToRect } from '../src/core/obstacle-collision';
import { getScenario } from '../src/scenarios/scenarios';

const scenarioId = process.argv.find((value) => value.startsWith('--scenario='))
  ?.slice('--scenario='.length) ?? 'obstacle-field';
const steps = Number(
  process.argv.find((value) => value.startsWith('--steps='))?.slice('--steps='.length) ?? 900,
);
const simulation = new CrowdSimulation(
  { ...DEFAULT_CONFIG, seed: 42, agentCount: 1000 },
  getScenario(scenarioId),
);
const internals = simulation as unknown as {
  preferredX: Float64Array;
  preferredY: Float64Array;
  routeCost: Float64Array;
};
const previousVelocityX = new Float64Array(simulation.state.vx);
const previousVelocityY = new Float64Array(simulation.state.vy);
const events: object[] = [];
const regionCounts = new Map<string, number>();
let accelerationViolations = 0;
let reservationFrames = 0;

for (let step = 1; step <= steps; step += 1) {
  simulation.step();
  if (simulation.metrics.reservationLimitedCount > 0) reservationFrames += 1;
  const allowedDelta = simulation.config.maxAcceleration * simulation.config.fixedDelta;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const delta = Math.hypot(
      simulation.state.vx[agent]! - previousVelocityX[agent]!,
      simulation.state.vy[agent]! - previousVelocityY[agent]!,
    );
    if (delta > allowedDelta + 1e-9) {
      accelerationViolations += 1;
      const region = `${Math.floor(simulation.state.x[agent]! / 100) * 100},${
        Math.floor(simulation.state.y[agent]! / 100) * 100
      }`;
      regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
      if (events.length < 24) {
        let nearestObstacle = Number.POSITIVE_INFINITY;
        let obstacleIndex = -1;
        for (let index = 0; index < simulation.scenario.obstacles.length; index += 1) {
          const clearance = Math.sqrt(distanceSquaredToRect(
            simulation.state.x[agent]!,
            simulation.state.y[agent]!,
            simulation.scenario.obstacles[index]!,
          )) - simulation.config.agentRadius;
          if (clearance < nearestObstacle) {
            nearestObstacle = clearance;
            obstacleIndex = index;
          }
        }
        events.push({
          step,
          agent,
          delta: Number(delta.toFixed(4)),
          x: Number(simulation.state.x[agent]!.toFixed(3)),
          y: Number(simulation.state.y[agent]!.toFixed(3)),
          previousVx: Number(previousVelocityX[agent]!.toFixed(3)),
          previousVy: Number(previousVelocityY[agent]!.toFixed(3)),
          vx: Number(simulation.state.vx[agent]!.toFixed(3)),
          vy: Number(simulation.state.vy[agent]!.toFixed(3)),
          preferredX: Number(internals.preferredX[agent]!.toFixed(4)),
          preferredY: Number(internals.preferredY[agent]!.toFixed(4)),
          routeCost: Number(internals.routeCost[agent]!.toFixed(3)),
          obstacleIndex,
          obstacleClearance: Number.isFinite(nearestObstacle)
            ? Number(nearestObstacle.toFixed(3))
            : null,
          reservationLimited: simulation.metrics.reservationLimitedCount,
          reservationStopped: simulation.metrics.reservationStoppedCount,
        });
      }
    }
    previousVelocityX[agent] = simulation.state.vx[agent]!;
    previousVelocityY[agent] = simulation.state.vy[agent]!;
  }
}

process.stdout.write(`${JSON.stringify({
  scenario: scenarioId,
  steps,
  arrived: simulation.metrics.arrivedCount,
  reservationFrames,
  accelerationViolations,
  regions: [...regionCounts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 12),
  events,
}, null, 2)}\n`);
