import { FlowBehaviorTracker } from '../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const scenarios = ['merge-500-500', 'opposing-500-500', 'crossing-500-500'] as const;
const selectedScenario = argument('scenario');
const selected = scenarios.filter((scenario) => !selectedScenario || scenario === selectedScenario);
const seed = Math.trunc(Number(argument('seed') ?? 42));
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 900)));
const agents = Math.max(1, Math.trunc(Number(argument('agents') ?? 1000)));
const records: object[] = [];

for (const scenarioId of selected) {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, agentCount: agents, seed },
    getScenario(scenarioId),
  );
  const tracker = new FlowBehaviorTracker(simulation);
  const startedAt = performance.now();
  for (let step = 0; step < steps; step += 1) {
    simulation.step();
    tracker.update();
  }
  records.push({
    scenario: scenarioId,
    seed,
    ...tracker.snapshot(),
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  });
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
