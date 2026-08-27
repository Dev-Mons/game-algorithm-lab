import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const CHECKPOINTS = new Set([60, 300, 600, 900]);
const SCENARIOS = [
  'open-field',
  'obstacle-field',
  'dense-spawn',
  'merge-500-500',
  'opposing-500-500',
  'crossing-500-500',
] as const;
const LONG_RUN = process.argv.includes('--long');
const pipelineArgument = process.argv.find((argument) => argument.startsWith('--pipeline='))?.slice('--pipeline='.length);
const PIPELINE = pipelineArgument === 'minimal' || pipelineArgument === 'unified'
  ? pipelineArgument
  : 'current';
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='))?.slice('--scenario='.length);
const stepArgument = process.argv.find((argument) => argument.startsWith('--steps='))?.slice('--steps='.length);
const requestedSteps = stepArgument === undefined
  ? 0
  : Math.max(1, Math.trunc(Number(stepArgument) || 0));
const selectedScenarios = SCENARIOS.filter((scenario) => scenarioArgument === undefined || scenario === scenarioArgument);
const TRACE_OVERLAPS = process.argv.includes('--trace-overlaps');
const LONG_LIMITS: Readonly<Record<(typeof SCENARIOS)[number], number>> = {
  'open-field': 1800,
  'obstacle-field': 3600,
  'dense-spawn': 1800,
  'merge-500-500': 1800,
  'opposing-500-500': 2400,
  'crossing-500-500': 2400,
};

function countWallOverlaps(simulation: CrowdSimulation): number {
  let count = 0;
  const radiusSquared = simulation.config.agentRadius ** 2;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const x = simulation.state.x[agent]!;
    const y = simulation.state.y[agent]!;
    if (
      x < simulation.config.agentRadius - 1e-9
      || y < simulation.config.agentRadius - 1e-9
      || x > simulation.config.width - simulation.config.agentRadius + 1e-9
      || y > simulation.config.height - simulation.config.agentRadius + 1e-9
    ) {
      count += 1;
      continue;
    }
    for (const obstacle of simulation.scenario.obstacles) {
      const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.width));
      const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.height));
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy >= radiusSquared - 1e-9) continue;
      count += 1;
      break;
    }
  }
  return count;
}

function countReverseVelocities(simulation: CrowdSimulation): { backward: number; strongBackward: number } {
  let backward = 0;
  let strongBackward = 0;
  const direction = { x: 0, y: 0 };
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    simulation.sampleNavigationDirection(
      agent,
      simulation.state.x[agent]!,
      simulation.state.y[agent]!,
      direction,
    );
    const progressSpeed = simulation.state.vx[agent]! * direction.x + simulation.state.vy[agent]! * direction.y;
    if (progressSpeed < -1e-6) backward += 1;
    if (progressSpeed < -simulation.config.maxSpeed * 0.25) strongBackward += 1;
  }
  return { backward, strongBackward };
}

/** Center of the histogram bin holding the q-quantile, in degrees over [0, 180]. */
function histogramPercentileDegrees(histogram: Float64Array, total: number, quantile: number): number {
  if (total <= 0) return 0;
  const target = total * quantile;
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    cumulative += histogram[bin]!;
    if (cumulative >= target) return ((bin + 0.5) / histogram.length) * 180;
  }
  return 180;
}

const records: object[] = [];
for (const scenarioId of selectedScenarios) {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, seed: 42, agentCount: 1000, pipeline: PIPELINE },
    getScenario(scenarioId),
  );
  const simulationInternals = simulation as unknown as {
    resolvedVelocityX: Float64Array;
    resolvedVelocityY: Float64Array;
  };
  const previousVelocityX = new Float64Array(simulation.state.vx);
  const previousVelocityY = new Float64Array(simulation.state.vy);
  const previousPositionX = new Float64Array(simulation.state.x);
  const previousPositionY = new Float64Array(simulation.state.y);
  const previousAccelerationX = new Float64Array(simulation.state.count);
  const previousAccelerationY = new Float64Array(simulation.state.count);
  const previousSide = new Int8Array(simulation.state.avoidanceSide);
  const initialGoalDistance = new Float64Array(simulation.state.count);
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    const goal = simulation.goalForAgent(agent);
    initialGoalDistance[agent] = Math.hypot(
      goal.x - simulation.state.x[agent]!,
      goal.y - simulation.state.y[agent]!,
    );
  }
  const motionPhase = new Uint8Array(simulation.state.count);
  motionPhase.fill(1);
  const adjacentStopFrames = new Uint16Array(simulation.state.count);
  let velocityDeltaSum = 0;
  let velocityDeltaSamples = 0;
  let maximumVelocityDelta = 0;
  let accelerationSum = 0;
  let maximumAcceleration = 0;
  let jerkSum = 0;
  let maximumJerk = 0;
  let hardStops = 0;
  let stopMoveStopTransitions = 0;
  let sideSwitches = 0;
  let maximumLongAdjacentStops = 0;
  let maximumOverlaps = 0;
  let maximumWallOverlaps = 0;
  let maximumStalled = 0;
  let maximumNeighbors = 0;
  let maximumCandidateChecks = 0;
  let emergencyStops = 0;
  let reservationLimitedAgents = 0;
  let reservationStoppedAgents = 0;
  let maximumReservationVelocityChange = 0;
  let reciprocalProjectionRepairAgents = 0;
  let displacementSpeedSum = 0;
  let displacementSpeedSamples = 0;
  let maximumVelocityDisplacementMismatch = 0;
  let positionalStops = 0;
  let maximumProposalDisplacementMismatch = 0;
  let proposalPositionalStops = 0;
  // Visual-quality metrics: per-frame heading change distribution, 1-second
  // speed variability, bottleneck gate throughput, relaxation activity.
  const HEADING_BINS = 360;
  const headingHistogram = new Float64Array(HEADING_BINS);
  let headingSamples = 0;
  let headingSum = 0;
  const SPEED_WINDOW = 60;
  const speedWindow = new Float64Array(simulation.state.count * SPEED_WINDOW);
  const speedWindowSum = new Float64Array(simulation.state.count);
  const speedWindowSumSq = new Float64Array(simulation.state.count);
  const speedWindowCount = new Int32Array(simulation.state.count);
  const speedWindowHead = new Int32Array(simulation.state.count);
  let speedStdSum = 0;
  let speedStdSamples = 0;
  let maximumSpeedStd = 0;
  const gateX = simulation.scenario.obstacles.length > 0
    ? Math.max(...simulation.scenario.obstacles.map((obstacle) => obstacle.x + obstacle.width))
    : simulation.config.width * 0.5;
  let gateCrossings = 0;
  let relaxationCorrectedAgents = 0;
  let maximumRelaxationCorrection = 0;
  let safetyFallbackAgents = 0;
  let maximumSafetyFallbackVelocityChange = 0;
  let unifiedInfeasibleAgents = 0;
  let activeAgentFrames = 0;
  // Displacement-based smoothness: what actually renders is positions, so the
  // second difference of positions is the honest visual acceleration measure.
  const previousDisplacementVX = new Float64Array(simulation.state.count);
  const previousDisplacementVY = new Float64Array(simulation.state.count);
  let displacementAccelerationSum = 0;
  let displacementAccelerationSamples = 0;
  let maximumDisplacementAcceleration = 0;
  let maximumPenetrationDepth = 0;
  const startedAt = performance.now();
  const stepLimit = requestedSteps > 0 ? requestedSteps : LONG_RUN ? LONG_LIMITS[scenarioId] : 900;
  for (let step = 1; step <= stepLimit; step += 1) {
    simulation.step();
    if (TRACE_OVERLAPS && simulation.metrics.overlapPairs > 0) {
      const flagged: number[] = [];
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.overlapFlags[agent] === 1) flagged.push(agent);
      }
      process.stderr.write(`${JSON.stringify({
        scenario: scenarioId,
        step,
        pairs: simulation.metrics.overlapPairs,
        flagged: flagged.slice(0, 12).map((agent) => ({
          agent,
          x: simulation.state.x[agent],
          y: simulation.state.y[agent],
          vx: simulation.state.vx[agent],
          vy: simulation.state.vy[agent],
          side: simulation.state.avoidanceSide[agent],
        })),
      })}\n`);
    }
    emergencyStops += simulation.metrics.emergencyStopCount;
    reservationLimitedAgents += simulation.metrics.reservationLimitedCount;
    reservationStoppedAgents += simulation.metrics.reservationStoppedCount;
    maximumReservationVelocityChange = Math.max(
      maximumReservationVelocityChange,
      simulation.metrics.maxReservationVelocityChange,
    );
    reciprocalProjectionRepairAgents += simulation.metrics.reciprocalProjectionRepairCount;
    relaxationCorrectedAgents += simulation.metrics.relaxationCorrectedCount;
    maximumRelaxationCorrection = Math.max(
      maximumRelaxationCorrection,
      simulation.metrics.maxRelaxationCorrection,
    );
    safetyFallbackAgents += simulation.metrics.safetyFallbackCount;
    maximumSafetyFallbackVelocityChange = Math.max(
      maximumSafetyFallbackVelocityChange,
      simulation.metrics.maxSafetyFallbackVelocityChange,
    );
    unifiedInfeasibleAgents += simulation.metrics.unifiedInfeasibleCount;
    activeAgentFrames += simulation.metrics.activeCount;
    let longAdjacentStops = 0;
    const stoppedThreshold = simulation.config.maxSpeed * 0.08;
    const movingThreshold = simulation.config.maxSpeed * 0.35;
    const drivingThreshold = simulation.config.maxSpeed * 0.5;
    const adjacencyRadius = simulation.config.agentRadius * 2 + simulation.config.agentGap + 0.25;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) {
        adjacentStopFrames[agent] = 0;
        previousVelocityX[agent] = 0;
        previousVelocityY[agent] = 0;
        previousAccelerationX[agent] = 0;
        previousAccelerationY[agent] = 0;
        previousSide[agent] = simulation.state.avoidanceSide[agent]!;
        previousPositionX[agent] = simulation.state.x[agent]!;
        previousPositionY[agent] = simulation.state.y[agent]!;
        speedWindowSum[agent] = 0;
        speedWindowSumSq[agent] = 0;
        speedWindowCount[agent] = 0;
        speedWindowHead[agent] = 0;
        previousDisplacementVX[agent] = 0;
        previousDisplacementVY[agent] = 0;
        continue;
      }
      const vx = simulation.state.vx[agent]!;
      const vy = simulation.state.vy[agent]!;
      const displacementVelocityX = (
        simulation.state.x[agent]! - previousPositionX[agent]!
      ) / simulation.config.fixedDelta;
      const displacementVelocityY = (
        simulation.state.y[agent]! - previousPositionY[agent]!
      ) / simulation.config.fixedDelta;
      const displacementSpeed = Math.hypot(displacementVelocityX, displacementVelocityY);
      displacementSpeedSum += displacementSpeed;
      displacementSpeedSamples += 1;
      maximumVelocityDisplacementMismatch = Math.max(
        maximumVelocityDisplacementMismatch,
        Math.hypot(vx - displacementVelocityX, vy - displacementVelocityY),
      );
      const displacementAcceleration = Math.hypot(
        displacementVelocityX - previousDisplacementVX[agent]!,
        displacementVelocityY - previousDisplacementVY[agent]!,
      ) / simulation.config.fixedDelta;
      displacementAccelerationSum += displacementAcceleration;
      displacementAccelerationSamples += 1;
      maximumDisplacementAcceleration = Math.max(
        maximumDisplacementAcceleration,
        displacementAcceleration,
      );
      previousDisplacementVX[agent] = displacementVelocityX;
      previousDisplacementVY[agent] = displacementVelocityY;
      const proposalMismatch = Math.hypot(
        simulationInternals.resolvedVelocityX[agent]! - displacementVelocityX,
        simulationInternals.resolvedVelocityY[agent]! - displacementVelocityY,
      );
      maximumProposalDisplacementMismatch = Math.max(
        maximumProposalDisplacementMismatch,
        proposalMismatch,
      );
      if (
        Math.hypot(vx, vy) >= simulation.config.maxSpeed * 0.5
        && displacementSpeed < simulation.config.maxSpeed * 0.08
      ) positionalStops += 1;
      if (
        Math.hypot(
          simulationInternals.resolvedVelocityX[agent]!,
          simulationInternals.resolvedVelocityY[agent]!,
        ) >= simulation.config.maxSpeed * 0.5
        && displacementSpeed < simulation.config.maxSpeed * 0.08
      ) proposalPositionalStops += 1;
      const previousVx = previousVelocityX[agent]!;
      const previousVy = previousVelocityY[agent]!;
      const speed = Math.hypot(vx, vy);
      const previousSpeed = Math.hypot(previousVx, previousVy);
      if (previousPositionX[agent]! < gateX && simulation.state.x[agent]! >= gateX) gateCrossings += 1;
      if (speed >= simulation.config.maxSpeed * 0.2 && previousSpeed >= simulation.config.maxSpeed * 0.2) {
        const headingDelta = Math.abs(Math.atan2(
          previousVx * vy - previousVy * vx,
          previousVx * vx + previousVy * vy,
        ));
        headingSum += headingDelta;
        headingSamples += 1;
        const bin = Math.min(HEADING_BINS - 1, Math.floor((headingDelta / Math.PI) * HEADING_BINS));
        headingHistogram[bin] = headingHistogram[bin]! + 1;
      }
      const windowIndex = agent * SPEED_WINDOW + speedWindowHead[agent]!;
      if (speedWindowCount[agent] === SPEED_WINDOW) {
        const evicted = speedWindow[windowIndex]!;
        speedWindowSum[agent] = speedWindowSum[agent]! - evicted;
        speedWindowSumSq[agent] = speedWindowSumSq[agent]! - evicted * evicted;
      }
      speedWindow[windowIndex] = speed;
      speedWindowSum[agent] = speedWindowSum[agent]! + speed;
      speedWindowSumSq[agent] = speedWindowSumSq[agent]! + speed * speed;
      speedWindowHead[agent] = (speedWindowHead[agent]! + 1) % SPEED_WINDOW;
      if (speedWindowCount[agent]! < SPEED_WINDOW) speedWindowCount[agent] = speedWindowCount[agent]! + 1;
      if (speedWindowCount[agent] === SPEED_WINDOW) {
        const mean = speedWindowSum[agent]! / SPEED_WINDOW;
        const variance = Math.max(0, speedWindowSumSq[agent]! / SPEED_WINDOW - mean * mean);
        const std = Math.sqrt(variance);
        speedStdSum += std;
        speedStdSamples += 1;
        maximumSpeedStd = Math.max(maximumSpeedStd, std);
      }
      const deltaX = vx - previousVx;
      const deltaY = vy - previousVy;
      const velocityDelta = Math.hypot(deltaX, deltaY);
      const accelerationX = deltaX / simulation.config.fixedDelta;
      const accelerationY = deltaY / simulation.config.fixedDelta;
      const acceleration = Math.hypot(accelerationX, accelerationY);
      const jerk = Math.hypot(
        accelerationX - previousAccelerationX[agent]!,
        accelerationY - previousAccelerationY[agent]!,
      ) / simulation.config.fixedDelta;
      velocityDeltaSum += velocityDelta;
      velocityDeltaSamples += 1;
      maximumVelocityDelta = Math.max(maximumVelocityDelta, velocityDelta);
      accelerationSum += acceleration;
      maximumAcceleration = Math.max(maximumAcceleration, acceleration);
      jerkSum += jerk;
      maximumJerk = Math.max(maximumJerk, jerk);
      if (previousSpeed >= drivingThreshold && speed < stoppedThreshold) hardStops += 1;
      if (motionPhase[agent] === 1 && speed >= movingThreshold) motionPhase[agent] = 2;
      if (motionPhase[agent] === 2 && speed < stoppedThreshold) {
        stopMoveStopTransitions += 1;
        motionPhase[agent] = 1;
      }
      const side = simulation.state.avoidanceSide[agent]!;
      if (side !== 0 && previousSide[agent] !== 0 && side !== previousSide[agent]) sideSwitches += 1;

      let hasStoppedNeighbor = false;
      if (speed < stoppedThreshold) {
        simulation.neighbors.forEachCandidate(
          simulation.state.x[agent]!,
          simulation.state.y[agent]!,
          adjacencyRadius,
          (neighbor) => {
            if (hasStoppedNeighbor || neighbor === agent || simulation.state.active[neighbor] !== 1) return;
            const dx = simulation.state.x[agent]! - simulation.state.x[neighbor]!;
            const dy = simulation.state.y[agent]! - simulation.state.y[neighbor]!;
            if (dx * dx + dy * dy > adjacencyRadius * adjacencyRadius) return;
            if (Math.hypot(simulation.state.vx[neighbor]!, simulation.state.vy[neighbor]!) < stoppedThreshold) {
              hasStoppedNeighbor = true;
            }
          },
        );
      }
      adjacentStopFrames[agent] = hasStoppedNeighbor
        ? Math.min(65_535, adjacentStopFrames[agent]! + 1)
        : 0;
      if (adjacentStopFrames[agent]! * simulation.config.fixedDelta >= 1) longAdjacentStops += 1;
      previousVelocityX[agent] = vx;
      previousVelocityY[agent] = vy;
      previousAccelerationX[agent] = accelerationX;
      previousAccelerationY[agent] = accelerationY;
      previousSide[agent] = side;
      previousPositionX[agent] = simulation.state.x[agent]!;
      previousPositionY[agent] = simulation.state.y[agent]!;
    }
    maximumLongAdjacentStops = Math.max(maximumLongAdjacentStops, longAdjacentStops);
    maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
    maximumWallOverlaps = Math.max(maximumWallOverlaps, countWallOverlaps(simulation));
    maximumStalled = Math.max(maximumStalled, simulation.metrics.stalledCount);
    maximumNeighbors = Math.max(maximumNeighbors, simulation.metrics.maxNeighbors);
    maximumCandidateChecks = Math.max(maximumCandidateChecks, simulation.metrics.candidateChecks);
    if (simulation.metrics.overlapPairs > 0) {
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (simulation.overlapFlags[agent] !== 1) continue;
        for (let other = agent + 1; other < simulation.state.count; other += 1) {
          if (simulation.overlapFlags[other] !== 1) continue;
          const dx = simulation.state.x[agent]! - simulation.state.x[other]!;
          const dy = simulation.state.y[agent]! - simulation.state.y[other]!;
          maximumPenetrationDepth = Math.max(
            maximumPenetrationDepth,
            simulation.config.agentRadius * 2 - Math.hypot(dx, dy),
          );
        }
      }
    }
    if (!CHECKPOINTS.has(step) && step !== stepLimit) continue;
    const reverse = countReverseVelocities(simulation);
    let totalGoalProgress = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const goal = simulation.goalForAgent(agent);
      totalGoalProgress += initialGoalDistance[agent]! - Math.hypot(
        goal.x - simulation.state.x[agent]!,
        goal.y - simulation.state.y[agent]!,
      );
    }
    records.push({
      scenario: scenarioId,
      pipeline: PIPELINE,
      step,
      active: simulation.metrics.activeCount,
      arrived: simulation.metrics.arrivedCount,
      // Commanded backward uses the exact Planning heading for this fixed step.
      // Flow backward is reported separately because portal dispersion and
      // arrival intent can intentionally differ from the raw Flow Field sample.
      backward: simulation.metrics.backwardCount,
      strongBackward: simulation.metrics.strongBackwardCount,
      flowBackward: reverse.backward,
      flowStrongBackward: reverse.strongBackward,
      overlaps: simulation.metrics.overlapPairs,
      wallOverlaps: countWallOverlaps(simulation),
      stalled: simulation.metrics.stalledCount,
      averageSpeed: Number(simulation.metrics.averageSpeed.toFixed(2)),
      averageGoalProgress: Number((
        totalGoalProgress / Math.max(1, simulation.state.count)
      ).toFixed(2)),
      averageDisplacementSpeed: Number((
        displacementSpeedSum / Math.max(1, displacementSpeedSamples)
      ).toFixed(2)),
      maximumVelocityDisplacementMismatch: Number(maximumVelocityDisplacementMismatch.toFixed(4)),
      positionalStops,
      maximumProposalDisplacementMismatch: Number(maximumProposalDisplacementMismatch.toFixed(4)),
      proposalPositionalStops,
      averageNeighbors: Number(simulation.metrics.averageNeighbors.toFixed(2)),
      maxNeighbors: simulation.metrics.maxNeighbors,
      candidateChecks: simulation.metrics.candidateChecks,
      averageVelocityDelta: Number((velocityDeltaSum / Math.max(1, velocityDeltaSamples)).toFixed(4)),
      maximumVelocityDelta: Number(maximumVelocityDelta.toFixed(4)),
      averageAcceleration: Number((accelerationSum / Math.max(1, velocityDeltaSamples)).toFixed(2)),
      maximumAcceleration: Number(maximumAcceleration.toFixed(2)),
      averageJerk: Number((jerkSum / Math.max(1, velocityDeltaSamples)).toFixed(2)),
      maximumJerk: Number(maximumJerk.toFixed(2)),
      hardStops,
      stopMoveStopTransitions,
      sideSwitches,
      longAdjacentStops,
      maximumLongAdjacentStops,
      maximumOverlaps,
      maximumWallOverlaps,
      maximumStalled,
      maximumNeighbors,
      maximumCandidateChecks,
      emergencyStops,
      reservationLimitedAgents,
      reservationStoppedAgents,
      maximumReservationVelocityChange: Number(maximumReservationVelocityChange.toFixed(4)),
      reciprocalProjectionRepairAgents,
      headingDeltaMeanDeg: Number((
        headingSamples === 0 ? 0 : (headingSum / headingSamples) * (180 / Math.PI)
      ).toFixed(4)),
      headingDeltaP95Deg: Number(
        histogramPercentileDegrees(headingHistogram, headingSamples, 0.95).toFixed(3),
      ),
      averageSpeedStd1s: Number((
        speedStdSamples === 0 ? 0 : speedStdSum / speedStdSamples
      ).toFixed(3)),
      maximumSpeedStd1s: Number(maximumSpeedStd.toFixed(3)),
      gateCrossings,
      gateThroughputPerSec: Number((gateCrossings / (step / 60)).toFixed(2)),
      relaxationCorrectedAgents,
      maximumRelaxationCorrection: Number(maximumRelaxationCorrection.toFixed(4)),
      safetyFallbackAgents,
      safetyFallbackRate: Number((safetyFallbackAgents / Math.max(1, activeAgentFrames)).toFixed(6)),
      maximumSafetyFallbackVelocityChange: Number(maximumSafetyFallbackVelocityChange.toFixed(4)),
      unifiedInfeasibleAgents,
      unifiedInfeasibleRate: Number((unifiedInfeasibleAgents / Math.max(1, activeAgentFrames)).toFixed(6)),
      stopMoveStopPer1000AgentSeconds: Number((
        stopMoveStopTransitions * 60_000 / Math.max(1, activeAgentFrames)
      ).toFixed(3)),
      averageDisplacementAcceleration: Number((
        displacementAccelerationSamples === 0
          ? 0
          : displacementAccelerationSum / displacementAccelerationSamples
      ).toFixed(2)),
      maximumDisplacementAcceleration: Number(maximumDisplacementAcceleration.toFixed(2)),
      maximumPenetrationDepth: Number(maximumPenetrationDepth.toFixed(4)),
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      hash: simulation.stateHash(),
    });
  }
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
