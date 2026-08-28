import { FlowBehaviorTracker, RouteUtilizationTracker } from '../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const scenarios: readonly string[] = [
  'merge-500-500',
  'opposing-500-500',
  'crossing-500-500',
  'different-capacity-gates',
  'equal-capacity-congested-gates',
  'merge-then-split',
  'opposing-occupied-corridor',
];
const selectedScenario = argument('scenario');
const selected = scenarios.filter((scenario) => !selectedScenario || scenario === selectedScenario);
const seed = Math.trunc(Number(argument('seed') ?? 42));
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 900)));
const agents = Math.max(1, Math.trunc(Number(argument('agents') ?? 1000)));
const dynamicEnabled = argument('dynamic') !== 'false';
const records: object[] = [];

for (const scenarioId of selected) {
  const simulation = new CrowdSimulation(
    {
      ...DEFAULT_CONFIG,
      agentCount: agents,
      seed,
      ...(dynamicEnabled ? {} : {
        dynamicFlowDensityWeight: 0,
        dynamicFlowOverloadWeight: 0,
        dynamicFlowCounterFlowWeight: 0,
        dynamicFlowWallWeight: 0,
      }),
    },
    getScenario(scenarioId),
  );
  const tracker = simulation.scenario.routeGates
    ? new RouteUtilizationTracker(simulation)
    : new FlowBehaviorTracker(simulation);
  const startedAt = performance.now();
  for (let step = 0; step < steps; step += 1) {
    simulation.step();
    tracker.update();
  }
  records.push({
    scenario: scenarioId,
    seed,
    dynamicEnabled,
    ...tracker.snapshot(),
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  });
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
