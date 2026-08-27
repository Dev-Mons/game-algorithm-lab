import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { distanceSquaredToRect } from '../src/core/obstacle-collision';
import { getScenario } from '../src/scenarios/scenarios';

const scenarioId = process.argv.find((value) => value.startsWith('--scenario='))
  ?.slice('--scenario='.length) ?? 'open-field';
const steps = Number(process.argv.find((value) => value.startsWith('--steps='))?.slice('--steps='.length) ?? 1800);
const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, seed: 42, agentCount: 1000 }, getScenario(scenarioId));
const internals = simulation as unknown as {
  preferredX: Float64Array;
  preferredY: Float64Array;
  neighborOffsets: Int32Array;
};
const traceAgent = Number(
  process.argv.find((value) => value.startsWith('--agent='))?.slice('--agent='.length) ?? -1,
);
let maximumBackward = 0;
let minimumProgressSpeed = 0;
const events: object[] = [];
const contactFrames = new Uint32Array(simulation.state.count);
let maximumContactFrames = 0;
let maximumContactSnapshot: object | null = null;
const contactTrace: object[] = [];
let maximumReservationLimited = 0;
let maximumReservationStopped = 0;
let maximumReservationVelocityChange = 0;

for (let step = 1; step <= steps; step += 1) {
  simulation.step();
  maximumReservationLimited = Math.max(
    maximumReservationLimited,
    simulation.metrics.reservationLimitedCount,
  );
  maximumReservationStopped = Math.max(
    maximumReservationStopped,
    simulation.metrics.reservationStoppedCount,
  );
  maximumReservationVelocityChange = Math.max(
    maximumReservationVelocityChange,
    simulation.metrics.maxReservationVelocityChange,
  );
  const contactDistanceSquared = (
    simulation.config.agentRadius + simulation.config.wallMargin + 0.05
  ) ** 2;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    let obstacleIndex = -1;
    if (simulation.state.active[agent] === 1) {
      obstacleIndex = simulation.scenario.obstacles.findIndex((obstacle) => (
        distanceSquaredToRect(simulation.state.x[agent]!, simulation.state.y[agent]!, obstacle)
          <= contactDistanceSquared
      ));
    }
    contactFrames[agent] = obstacleIndex >= 0 ? contactFrames[agent]! + 1 : 0;
    if (
      agent === traceAgent
      && (
        contactFrames[agent] === 1
        || contactFrames[agent] === 2
        || contactFrames[agent] === 5
        || contactFrames[agent] === 10
        || contactFrames[agent] === 30
        || contactFrames[agent] === 60
        || contactFrames[agent] === 120
        || contactFrames[agent] === 300
        || contactFrames[agent] === 600
      )
    ) {
      contactTrace.push({
        step,
        contactFrames: contactFrames[agent],
        obstacleIndex,
        neighbors: internals.neighborOffsets[agent + 1]! - internals.neighborOffsets[agent]!,
        x: simulation.state.x[agent],
        y: simulation.state.y[agent],
        vx: simulation.state.vx[agent],
        vy: simulation.state.vy[agent],
        preferredX: internals.preferredX[agent],
        preferredY: internals.preferredY[agent],
        stalledFor: simulation.state.stalledFor[agent],
      });
    }
    if (contactFrames[agent]! <= maximumContactFrames) continue;
    maximumContactFrames = contactFrames[agent]!;
    maximumContactSnapshot = {
      step,
      agent,
      obstacleIndex,
      contactFrames: maximumContactFrames,
      x: simulation.state.x[agent],
      y: simulation.state.y[agent],
      vx: simulation.state.vx[agent],
      vy: simulation.state.vy[agent],
      preferredX: internals.preferredX[agent],
      preferredY: internals.preferredY[agent],
      stalledFor: simulation.state.stalledFor[agent],
    };
  }
  if (simulation.metrics.backwardCount === 0) continue;
  const agents: object[] = [];
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const progress = simulation.state.vx[agent]! * internals.preferredX[agent]!
      + simulation.state.vy[agent]! * internals.preferredY[agent]!;
    minimumProgressSpeed = Math.min(minimumProgressSpeed, progress);
    if (progress >= -1e-6 || agents.length >= 8) continue;
    let nearestWallClearance = Number.POSITIVE_INFINITY;
    for (const obstacle of simulation.scenario.obstacles) {
      nearestWallClearance = Math.min(
        nearestWallClearance,
        Math.sqrt(distanceSquaredToRect(simulation.state.x[agent]!, simulation.state.y[agent]!, obstacle))
          - simulation.config.agentRadius,
      );
    }
    agents.push({
      agent,
      progress: Number(progress.toFixed(9)),
      x: Number(simulation.state.x[agent]!.toFixed(4)),
      y: Number(simulation.state.y[agent]!.toFixed(4)),
      vx: Number(simulation.state.vx[agent]!.toFixed(4)),
      vy: Number(simulation.state.vy[agent]!.toFixed(4)),
      preferredX: Number(internals.preferredX[agent]!.toFixed(6)),
      preferredY: Number(internals.preferredY[agent]!.toFixed(6)),
      goalDistance: Number(Math.hypot(
        simulation.state.x[agent]! - simulation.goal.x,
        simulation.state.y[agent]! - simulation.goal.y,
      ).toFixed(3)),
      nearestWallClearance: Number.isFinite(nearestWallClearance)
        ? Number(nearestWallClearance.toFixed(6))
        : null,
    });
  }
  if (events.length < 8 || simulation.metrics.backwardCount > maximumBackward) {
    events.push({
      step,
      count: simulation.metrics.backwardCount,
      reservationLimited: simulation.metrics.reservationLimitedCount,
      reservationStopped: simulation.metrics.reservationStoppedCount,
      agents,
    });
  }
  maximumBackward = Math.max(maximumBackward, simulation.metrics.backwardCount);
}

process.stdout.write(`${JSON.stringify({
  scenario: scenarioId,
  steps,
  arrived: simulation.metrics.arrivedCount,
  maximumBackward,
  minimumProgressSpeed,
  maximumContactFrames,
  maximumContactSnapshot,
  contactTrace,
  maximumReservationLimited,
  maximumReservationStopped,
  maximumReservationVelocityChange,
  hash: simulation.stateHash(),
  events,
}, null, 2)}\n`);
