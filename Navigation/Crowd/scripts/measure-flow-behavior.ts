import { FlowBehaviorTracker } from '../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const scenarios = ['merge-500-500', 'opposing-500-500', 'crossing-500-500'] as const;
const scenarioArgument = process.argv.find((value) => value.startsWith('--scenario='))
  ?.slice('--scenario='.length);
const seedArgument = process.argv.find((value) => value.startsWith('--seed='))
  ?.slice('--seed='.length);
const stepsArgument = process.argv.find((value) => value.startsWith('--steps='))
  ?.slice('--steps='.length);
const selected = scenarios.filter((scenario) => !scenarioArgument || scenario === scenarioArgument);
const seed = Math.trunc(Number(seedArgument ?? 42));
const steps = Math.max(1, Math.trunc(Number(stepsArgument ?? 900)));
const records: object[] = [];

for (const scenarioId of selected) {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, pipeline: 'unified', agentCount: 1000, seed },
    getScenario(scenarioId),
  );
  const tracker = new FlowBehaviorTracker(simulation, steps);
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
