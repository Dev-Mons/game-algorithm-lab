import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const longRun = process.argv.includes('--long');
const scenarioArgument = argument('scenario');
const requestedSteps = Number(argument('steps'));
const seed = Math.trunc(Number(argument('seed') ?? 42));
const agentCount = Math.max(1, Math.trunc(Number(argument('agents') ?? 1000)));
const defaults = longRun
  ? { 'open-field': 1800, 'dense-spawn': 1800, 'obstacle-field': 3600 }
  : { 'open-field': 600, 'dense-spawn': 60, 'obstacle-field': 600 };
const scenarioIds = (scenarioArgument
  ? [scenarioArgument]
  : Object.keys(defaults)) as Array<keyof typeof defaults>;
const records: object[] = [];

for (const scenarioId of scenarioIds) {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, seed, agentCount },
    getScenario(scenarioId),
  );
  const steps = Number.isFinite(requestedSteps) && requestedSteps > 0
    ? Math.trunc(requestedSteps)
    : defaults[scenarioId] ?? 600;
  const durations: number[] = [];
  let activeAgentFrames = 0;
  let recoveredAgentFrames = 0;
  let maximumOverlaps = 0;
  let maximumWallOverlaps = 0;
  let maximumBackward = 0;
  let maximumStalled = 0;
  let maximumCandidates = 0;
  let maximumAcceleration = 0;
  let maximumRecoveryDistance = 0;
  let gateCrossings = 0;
  const previousX = new Float64Array(simulation.state.x);

  for (let step = 0; step < steps; step += 1) {
    const startedAt = performance.now();
    simulation.step();
    durations.push(performance.now() - startedAt);
    activeAgentFrames += simulation.metrics.activeCount;
    recoveredAgentFrames += simulation.metrics.recoveredAgents;
    maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
    maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
    maximumBackward = Math.max(maximumBackward, simulation.metrics.backwardCount);
    maximumStalled = Math.max(maximumStalled, simulation.metrics.stalledCount);
    maximumCandidates = Math.max(maximumCandidates, simulation.metrics.candidateChecks);
    maximumAcceleration = Math.max(maximumAcceleration, simulation.metrics.maxAcceleration);
    maximumRecoveryDistance = Math.max(
      maximumRecoveryDistance,
      simulation.metrics.maxRecoveryDistance,
    );
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (previousX[agent]! < 660 && simulation.state.x[agent]! >= 660) gateCrossings += 1;
      previousX[agent] = simulation.state.x[agent]!;
    }
  }

  let averageGoalProgress = 0;
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    if (simulation.state.active[agent] !== 1) continue;
    averageGoalProgress += simulation.state.vx[agent]! * simulation.state.intentX[agent]!
      + simulation.state.vy[agent]! * simulation.state.intentY[agent]!;
  }
  averageGoalProgress /= Math.max(1, simulation.metrics.activeCount);
  durations.sort((first, second) => first - second);
  records.push({
    scenario: scenarioId,
    seed,
    agents: simulation.state.count,
    steps,
    elapsedMs: round(durations.reduce((sum, value) => sum + value, 0)),
    stepMsP50: round(percentile(durations, 0.5)),
    stepMsP95: round(percentile(durations, 0.95)),
    stepMsMax: round(durations.at(-1) ?? 0),
    active: simulation.metrics.activeCount,
    arrived: simulation.metrics.arrivedCount,
    arrivalRate: round(simulation.metrics.arrivalRate),
    averageSpeed: round(simulation.metrics.averageSpeed),
    averageGoalProgress: round(averageGoalProgress),
    gateThroughputPerSecond: round(gateCrossings / Math.max(steps * simulation.config.fixedDelta, 1e-9)),
    recoveryRate: round(recoveredAgentFrames / Math.max(1, activeAgentFrames)),
    maximumRecoveryDistance: round(maximumRecoveryDistance),
    maximumOverlaps,
    maximumWallOverlaps,
    maximumBackward,
    maximumStalled,
    maximumCandidates,
    maximumAcceleration: round(maximumAcceleration),
    hash: simulation.stateHash(),
  });
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
