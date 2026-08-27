import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import type { PipelineKind } from '../src/core/types';
import { getScenario } from '../src/scenarios/scenarios';

const argument = (name: string): string | undefined => process.argv
  .find((value) => value.startsWith(`--${name}=`))
  ?.slice(name.length + 3);
const pipelineValue = argument('pipeline');
const pipeline: PipelineKind = pipelineValue === 'current' || pipelineValue === 'minimal'
  ? pipelineValue
  : 'unified';
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 600)));
const seed = Math.trunc(Number(argument('seed') ?? 42));
const checkpoints = new Set([60, 120, 180, 240, 300, 450, 600, steps]);

interface RegionAccumulator {
  count: number;
  speed: number;
  progressSpeed: number;
  stopped: number;
  fallback: number;
  density: number;
}

const simulation = new CrowdSimulation(
  { ...DEFAULT_CONFIG, seed, agentCount: 1000, pipeline },
  getScenario(argument('scenario') ?? 'obstacle-field'),
);
const fallbackByRegion = new Map<string, number>();
const records: unknown[] = [];

for (let step = 1; step <= steps; step += 1) {
  simulation.step();
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const trace = simulation.getAgentTrace(agent);
    if (trace.fallbackReason === 'none') continue;
    const region = regionName(trace.position.x, trace.position.y);
    fallbackByRegion.set(region, (fallbackByRegion.get(region) ?? 0) + 1);
  }
  if (!checkpoints.has(step)) continue;

  const regions = new Map<string, RegionAccumulator>();
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumProgressAgent = -1;
  let minimumGoalDistance = Number.POSITIVE_INFINITY;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    const trace = simulation.getAgentTrace(agent);
    if (trace.position.x > maximumX) {
      maximumX = trace.position.x;
      maximumProgressAgent = agent;
    }
    minimumGoalDistance = Math.min(
      minimumGoalDistance,
      Math.hypot(trace.position.x - simulation.goal.x, trace.position.y - simulation.goal.y),
    );
    const region = regionName(trace.position.x, trace.position.y);
    let accumulator = regions.get(region);
    if (accumulator === undefined) {
      accumulator = { count: 0, speed: 0, progressSpeed: 0, stopped: 0, fallback: 0, density: 0 };
      regions.set(region, accumulator);
    }
    const speed = Math.hypot(trace.finalVelocity.x, trace.finalVelocity.y);
    accumulator.count += 1;
    accumulator.speed += speed;
    accumulator.progressSpeed += trace.finalVelocity.x;
    accumulator.stopped += speed < simulation.config.maxSpeed * 0.08 ? 1 : 0;
    accumulator.fallback += trace.fallbackReason === 'none' ? 0 : 1;
    accumulator.density += trace.localDensity;
  }

  records.push({
    step,
    active: simulation.metrics.activeCount,
    arrived: simulation.metrics.arrivedCount,
    maximumX: Number(maximumX.toFixed(2)),
    maximumProgressAgent,
    minimumGoalDistance: Number(minimumGoalDistance.toFixed(3)),
    regions: Object.fromEntries([...regions].sort().map(([name, value]) => [name, {
      count: value.count,
      averageSpeed: Number((value.speed / value.count).toFixed(2)),
      averageProgressSpeed: Number((value.progressSpeed / value.count).toFixed(2)),
      stopped: value.stopped,
      fallback: value.fallback,
      averageDensity: Number((value.density / value.count).toFixed(3)),
    }])),
  });
}

process.stdout.write(`${JSON.stringify({
  pipeline,
  steps,
  fallbackByRegion: Object.fromEntries([...fallbackByRegion].sort()),
  records,
}, null, 2)}\n`);

function regionName(x: number, y: number): string {
  const progress = x < 430
    ? 'spawn'
    : x < 504 ? 'splitter-near'
      : x < 576 ? 'splitter'
        : x < 700 ? 'middle'
          : x < 792 ? 'exit-gates'
            : 'downstream';
  const lane = y < 120 ? 'top-outer'
    : y < 240 ? 'top-gate'
      : y < 360 ? 'upper-middle'
        : y < 480 ? 'lower-middle'
          : y < 600 ? 'bottom-gate'
            : 'bottom-outer';
  return `${progress}/${lane}`;
}
