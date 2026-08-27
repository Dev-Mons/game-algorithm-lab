import { SpatialHash } from '../src/algorithms/spatial-hash/spatial-hash';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const steps = Math.max(1, Math.trunc(Number(
  process.argv.find((value) => value.startsWith('--steps='))?.slice('--steps='.length) ?? 300,
)));
const simulation = new CrowdSimulation(
  { ...DEFAULT_CONFIG, pipeline: 'unified', seed: 42, agentCount: 1000 },
  getScenario('obstacle-field'),
);
const count = simulation.state.count;
const previousX = new Float64Array(count);
const previousY = new Float64Array(count);
const previousVelocityX = new Float64Array(count);
const previousVelocityY = new Float64Array(count);
const proposalX = new Float64Array(count);
const proposalY = new Float64Array(count);
const proposalHash = new SpatialHash(
  simulation.config.width,
  simulation.config.height,
  simulation.config.agentRadius * 2 + 0.1,
  count,
);
const internals = simulation as unknown as {
  resolvedVelocityX: Float64Array;
  resolvedVelocityY: Float64Array;
  solverNeighborOffsets: Int32Array;
  solverNeighborIndices: Int32Array;
};
let proposalOverlapPairs = 0;
let selectedBoth = 0;
let selectedOne = 0;
let selectedNeither = 0;
let cappedBoth = 0;
let cappedOne = 0;
let cappedNeither = 0;
let correctedPairs = 0;
let minimumProposalDistance = Number.POSITIVE_INFINITY;

for (let step = 1; step <= steps; step += 1) {
  previousX.set(simulation.state.x);
  previousY.set(simulation.state.y);
  previousVelocityX.set(simulation.state.vx);
  previousVelocityY.set(simulation.state.vy);
  simulation.step();
  if (simulation.metrics.safetyFallbackCount === 0) continue;
  for (let agent = 0; agent < count; agent += 1) {
    proposalX[agent] = previousX[agent]! + internals.resolvedVelocityX[agent]! * simulation.config.fixedDelta;
    proposalY[agent] = previousY[agent]! + internals.resolvedVelocityY[agent]! * simulation.config.fixedDelta;
  }
  proposalHash.rebuild(proposalX, proposalY, simulation.state.active);
  const physicalRadius = simulation.config.agentRadius * 2;
  const physicalRadiusSquared = physicalRadius * physicalRadius;
  for (let agent = 0; agent < count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    proposalHash.forEachCandidate(proposalX[agent]!, proposalY[agent]!, physicalRadius, (other) => {
      if (other <= agent || simulation.state.active[other] !== 1) return;
      const dx = proposalX[other]! - proposalX[agent]!;
      const dy = proposalY[other]! - proposalY[agent]!;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= physicalRadiusSquared - 1e-9) return;
      proposalOverlapPairs += 1;
      minimumProposalDistance = Math.min(minimumProposalDistance, Math.sqrt(distanceSquared));
      const agentHasOther = hasNeighbor(agent, other);
      const otherHasAgent = hasNeighbor(other, agent);
      if (agentHasOther && otherHasAgent) selectedBoth += 1;
      else if (agentHasOther || otherHasAgent) selectedOne += 1;
      else selectedNeither += 1;
      const agentSelectedOther = isCappedNeighbor(agent, other);
      const otherSelectedAgent = isCappedNeighbor(other, agent);
      if (agentSelectedOther && otherSelectedAgent) cappedBoth += 1;
      else if (agentSelectedOther || otherSelectedAgent) cappedOne += 1;
      else cappedNeither += 1;
      if (
        Math.hypot(
          simulation.state.x[agent]! - proposalX[agent]!,
          simulation.state.y[agent]! - proposalY[agent]!,
        ) > 1e-9
        || Math.hypot(
          simulation.state.x[other]! - proposalX[other]!,
          simulation.state.y[other]! - proposalY[other]!,
        ) > 1e-9
      ) correctedPairs += 1;
    });
  }
}

process.stdout.write(`${JSON.stringify({
  steps,
  proposalOverlapPairs,
  selectedBoth,
  selectedOne,
  selectedNeither,
  cappedBoth,
  cappedOne,
  cappedNeither,
  correctedPairs,
  minimumProposalDistance,
}, null, 2)}\n`);

function hasNeighbor(agent: number, other: number): boolean {
  const start = internals.solverNeighborOffsets[agent]!;
  const end = internals.solverNeighborOffsets[agent + 1]!;
  for (let offset = start; offset < end; offset += 1) {
    if (internals.solverNeighborIndices[offset] === other) return true;
  }
  return false;
}

function isCappedNeighbor(agent: number, other: number): boolean {
  const start = internals.solverNeighborOffsets[agent]!;
  const end = internals.solverNeighborOffsets[agent + 1]!;
  const scored: { id: number; score: number }[] = [];
  for (let offset = start; offset < end; offset += 1) {
    const candidate = internals.solverNeighborIndices[offset]!;
    const dx = previousX[candidate]! - previousX[agent]!;
    const dy = previousY[candidate]! - previousY[agent]!;
    const rvx = previousVelocityX[candidate]! - previousVelocityX[agent]!;
    const rvy = previousVelocityY[candidate]! - previousVelocityY[agent]!;
    const relativeSpeedSquared = rvx * rvx + rvy * rvy;
    const closestTime = relativeSpeedSquared > 1e-9
      ? Math.max(0, Math.min(0.5, -(dx * rvx + dy * rvy) / relativeSpeedSquared))
      : 0;
    const predictedX = dx + rvx * closestTime;
    const predictedY = dy + rvy * closestTime;
    scored.push({
      id: candidate,
      score: predictedX * predictedX + predictedY * predictedY + (dx * dx + dy * dy) * 1e-4,
    });
  }
  scored.sort((first, second) => first.score - second.score || first.id - second.id);
  return scored.slice(0, 8).some((entry) => entry.id === other);
}
