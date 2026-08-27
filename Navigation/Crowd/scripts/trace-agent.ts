import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import type { AgentLayerTrace, PipelineKind } from '../src/core/types';
import { getScenario } from '../src/scenarios/scenarios';

const argument = (name: string): string | undefined => process.argv
  .find((value) => value.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const scenarioId = argument('scenario') ?? 'obstacle-field';
const pipelineValue = argument('pipeline');
const pipeline: PipelineKind = pipelineValue === 'current' || pipelineValue === 'minimal'
  ? pipelineValue
  : 'unified';
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 600)));
const seed = Math.trunc(Number(argument('seed') ?? 42));
const requestedAgent = argument('agent');
const summaryOnly = process.argv.includes('--summary-only');

const simulation = new CrowdSimulation(
  { ...DEFAULT_CONFIG, seed, agentCount: 1000, pipeline },
  getScenario(scenarioId),
);
const fallbackCounts = new Uint32Array(simulation.state.count);
const stopTransitions = new Uint32Array(simulation.state.count);
const longestAdjacentStop = new Float64Array(simulation.state.count);
const previousMoving = new Uint8Array(simulation.state.count);
const fallbackByReason = new Map<string, number>();
const fallbackVelocityChangeBuckets = {
  overPointZeroOne: 0,
  overPointOne: 0,
  overOne: 0,
  overAccelerationReach: 0,
};

for (let step = 0; step < steps; step += 1) {
  simulation.step();
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const trace = simulation.getAgentTrace(agent);
    if (trace.fallbackReason !== 'none') {
      fallbackCounts[agent] = fallbackCounts[agent]! + 1;
      fallbackByReason.set(trace.fallbackReason, (fallbackByReason.get(trace.fallbackReason) ?? 0) + 1);
      const velocityChange = Math.hypot(
        trace.finalVelocity.x - trace.localVelocity.x,
        trace.finalVelocity.y - trace.localVelocity.y,
      );
      if (velocityChange > 0.01) fallbackVelocityChangeBuckets.overPointZeroOne += 1;
      if (velocityChange > 0.1) fallbackVelocityChangeBuckets.overPointOne += 1;
      if (velocityChange > 1) fallbackVelocityChangeBuckets.overOne += 1;
      if (velocityChange > simulation.config.maxAcceleration * simulation.config.fixedDelta + 1e-7) {
        fallbackVelocityChangeBuckets.overAccelerationReach += 1;
      }
    }
    const speed = Math.hypot(simulation.state.vx[agent]!, simulation.state.vy[agent]!);
    if (previousMoving[agent] === 0 && speed >= simulation.config.maxSpeed * 0.35) previousMoving[agent] = 1;
    if (previousMoving[agent] === 1 && speed < simulation.config.maxSpeed * 0.08) {
      stopTransitions[agent] = stopTransitions[agent]! + 1;
      previousMoving[agent] = 0;
    }
    longestAdjacentStop[agent] = Math.max(
      longestAdjacentStop[agent]!,
      simulation.state.adjacentStoppedFor[agent]!,
    );
  }
}

const highestIndex = (values: Uint32Array | Float64Array): number => {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! > values[best]!) best = index;
  }
  return best;
};
const selected = requestedAgent === undefined
  ? highestIndex(fallbackCounts)
  : Math.max(0, Math.min(simulation.state.count - 1, Math.trunc(Number(requestedAgent))));

const traces: AgentLayerTrace[] = [];
if (!summaryOnly) {
  const replay = new CrowdSimulation(
    { ...DEFAULT_CONFIG, seed, agentCount: 1000, pipeline },
    getScenario(scenarioId),
  );
  for (let step = 0; step < steps; step += 1) {
    replay.step();
    const trace = replay.getAgentTrace(selected);
    if (trace.fallbackReason !== 'none' || step % 30 === 29) traces.push(trace);
  }
}

process.stdout.write(`${JSON.stringify({
  scenario: scenarioId,
  pipeline,
  steps,
  fallbackByReason: Object.fromEntries(fallbackByReason),
  fallbackVelocityChangeBuckets,
  worstFallbackAgent: highestIndex(fallbackCounts),
  worstFallbackFrames: fallbackCounts[highestIndex(fallbackCounts)],
  worstStopMoveStopAgent: highestIndex(stopTransitions),
  worstStopMoveStopCount: stopTransitions[highestIndex(stopTransitions)],
  worstAdjacentStopAgent: highestIndex(longestAdjacentStop),
  worstAdjacentStopSeconds: longestAdjacentStop[highestIndex(longestAdjacentStop)],
  selectedAgent: selected,
  traces,
}, null, 2)}\n`);
