import { FlowBehaviorTracker, RouteUtilizationTracker } from '../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario, SCENARIOS } from '../src/scenarios/scenarios';

const scenarios = SCENARIOS
  .filter((scenario) => (scenario.routeGates?.length ?? 0) >= 2 || (scenario.flows?.length ?? 0) >= 2)
  .map((scenario) => scenario.id);
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
      largeAgentPercent: Number(argument('large-percent') ?? DEFAULT_CONFIG.largeAgentPercent),
      largeAgentScale: Number(argument('large-scale') ?? DEFAULT_CONFIG.largeAgentScale),
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
    largeAgents: simulation.largeAgentCount,
    largeAgentScale: simulation.config.largeAgentScale,
    ...tracker.snapshot(),
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  });
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
