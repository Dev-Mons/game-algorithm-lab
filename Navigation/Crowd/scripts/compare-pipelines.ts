import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import type { PipelineKind } from '../src/core/types';
import { getScenario } from '../src/scenarios/scenarios';

const argument = (name: string): string | undefined => process.argv
  .find((value) => value.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const scenarioId = argument('scenario') ?? 'obstacle-field';
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 600)));
const agentCount = Math.max(1, Math.trunc(Number(argument('agents') ?? 1000)));
const seed = Math.trunc(Number(argument('seed') ?? 42));
const requestedPipelines = (argument('pipelines') ?? 'current,minimal,unified').split(',');
const pipelines = requestedPipelines.filter((value): value is PipelineKind => (
  value === 'current' || value === 'minimal' || value === 'unified'
));
if (pipelines.length === 0) throw new RangeError('At least one valid pipeline is required.');

interface PipelineSummary {
  pipeline: PipelineKind;
  scenario: string;
  seed: number;
  agents: number;
  steps: number;
  arrived: number;
  averageGoalProgress: number;
  gateThroughputPerSec: number;
  stopMoveStopTransitions: number;
  maximumLongAdjacentStops: number;
  maximumOverlaps: number;
  maximumWallOverlaps: number;
  strongBackwardFrames: number;
  safetyFallbackRate: number;
  elapsedMs: number;
  stateHash: string;
  elapsedVsCurrent?: number;
}

const summaries: PipelineSummary[] = [];
for (const pipeline of pipelines) {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, pipeline, seed, agentCount },
    getScenario(scenarioId),
  );
  const initialGoalDistance = new Float64Array(simulation.state.count);
  const previousX = new Float64Array(simulation.state.x);
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    initialGoalDistance[agent] = Math.hypot(
      simulation.goal.x - simulation.state.x[agent]!,
      simulation.goal.y - simulation.state.y[agent]!,
    );
  }
  const gateX = simulation.scenario.obstacles.length > 0
    ? Math.max(...simulation.scenario.obstacles.map((obstacle) => obstacle.x + obstacle.width))
    : simulation.config.width * 0.5;
  let gateCrossings = 0;
  let stopMoveStopTransitions = 0;
  let maximumLongAdjacentStops = 0;
  let maximumOverlaps = 0;
  let maximumWallOverlaps = 0;
  let strongBackwardFrames = 0;
  let safetyFallbackAgentFrames = 0;
  let activeAgentFrames = 0;
  const startedAt = performance.now();
  for (let step = 0; step < steps; step += 1) {
    simulation.step();
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (previousX[agent]! < gateX && simulation.state.x[agent]! >= gateX) gateCrossings += 1;
      previousX[agent] = simulation.state.x[agent]!;
    }
    stopMoveStopTransitions += simulation.metrics.stopMoveStopCount;
    maximumLongAdjacentStops = Math.max(maximumLongAdjacentStops, simulation.metrics.longAdjacentStopCount);
    maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
    maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
    strongBackwardFrames += simulation.metrics.strongBackwardCount;
    safetyFallbackAgentFrames += simulation.metrics.safetyFallbackCount;
    activeAgentFrames += simulation.metrics.activeCount;
  }
  const elapsedMs = performance.now() - startedAt;
  let totalGoalProgress = 0;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    totalGoalProgress += initialGoalDistance[agent]! - Math.hypot(
      simulation.goal.x - simulation.state.x[agent]!,
      simulation.goal.y - simulation.state.y[agent]!,
    );
  }
  summaries.push({
    pipeline,
    scenario: scenarioId,
    seed,
    agents: simulation.state.count,
    steps,
    arrived: simulation.metrics.arrivedCount,
    averageGoalProgress: Number((totalGoalProgress / simulation.state.count).toFixed(2)),
    gateThroughputPerSec: Number((gateCrossings / (steps * simulation.config.fixedDelta)).toFixed(2)),
    stopMoveStopTransitions,
    maximumLongAdjacentStops,
    maximumOverlaps,
    maximumWallOverlaps,
    strongBackwardFrames,
    safetyFallbackRate: Number((
      safetyFallbackAgentFrames / Math.max(1, activeAgentFrames)
    ).toFixed(6)),
    elapsedMs: Number(elapsedMs.toFixed(1)),
    stateHash: simulation.stateHash(),
  });
}

const currentElapsed = summaries.find((summary) => summary.pipeline === 'current')?.elapsedMs;
if (currentElapsed !== undefined) {
  for (const summary of summaries) {
    summary.elapsedVsCurrent = Number((summary.elapsedMs / currentElapsed).toFixed(3));
  }
}

process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
