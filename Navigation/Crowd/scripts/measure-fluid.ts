import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { CrowdQualityTracker } from '../src/core/crowd-quality-metrics';
import { FlowBehaviorTracker, RouteUtilizationTracker } from '../src/core/flow-behavior-metrics';
import { getScenario, SCENARIOS } from '../src/scenarios/scenarios';

const scenarios = SCENARIOS.map((scenario) => scenario.id);
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.split('=')[1];
const selected = arg('scenario');
const cases = scenarios.filter(s => !selected || s === selected).map(scenario => ({scenario, agents: Number(arg('agents') ?? 1000)}));
if (!selected && !arg('agents')) cases.push(...scenarios.map(scenario => ({scenario, agents: 10000})));
const records = [];
for (const item of cases) {
  const config = { ...DEFAULT_CONFIG, agentCount: item.agents,
    ...(item.agents === 10000 ? {agentRadius: 1.5, agentGap: 0.05} : {}) };
  const simulation = new CrowdSimulation(config, getScenario(item.scenario));
  const quality = new CrowdQualityTracker(simulation);
  const behavior = simulation.scenario.routeGates ? new RouteUtilizationTracker(simulation)
    : simulation.flowCount > 1 ? new FlowBehaviorTracker(simulation) : undefined;
  // Instrument public and private pass boundaries externally, without clocks
  // or mode switches in the actual solver. Timings below are inclusive.
  const timings: Record<string, number> = {};
  const wrap = (object: object, method: string, label = method) => {
    const target = object as Record<string, (...args: unknown[]) => unknown>;
    const original = target[method];
    if (typeof original !== 'function') return;
    timings[label] = 0;
    target[method] = function (...args: unknown[]) {
      const start = performance.now();
      const result = original.apply(this, args);
      timings[label] = timings[label]! + performance.now() - start;
      return result;
    };
  };
  const internal = simulation as unknown as { movement: object; crowdFlow?: object };
  const ablation = arg('ablation');
  if (ablation === 'contacts') {
    (internal.movement as {solveContactConstraints: () => void}).solveContactConstraints = () => {};
  } else if (ablation === 'transport' && internal.crowdFlow) {
    (internal.crowdFlow as {solve: () => void}).solve = () => {};
  } else if (ablation !== undefined && ablation !== 'transport') {
    throw new Error('Ablation must be contacts or transport.');
  }
  for (const method of ['predictPositions', 'buildContactConstraints', 'solveContactConstraints',
    'integratePredictions', 'publishVelocities', 'projectPredictionsOutsideStatics']) wrap(internal.movement, method);
  wrap(simulation.crowdField, 'update', 'densityMomentum');
  wrap(simulation, 'planDesiredVelocities', 'navigationAndLegacySteering');
  wrap(simulation, 'updateDynamicFlowFields', 'dynamicNavigation');
  wrap(simulation, 'finalizeMetrics', 'stepMetrics');
  if (internal.crowdFlow) wrap(internal.crowdFlow, 'solve', 'gridVelocity');
  const durations: number[] = [];
  const steps = Number(arg('steps') ?? (item.agents === 10000 ? 360 : 900));
  let gateCrossings = 0;
  let maximumPenetration = 0;
  for (let step = 0; step < steps; step++) {
    const start = performance.now();
    simulation.step();
    durations.push(performance.now() - start);
    quality.update();
    behavior?.update();
    maximumPenetration = Math.max(maximumPenetration, quality.snapshot().maxPenetrationDepth);
    for (let a = 0; a < simulation.state.count; a++) {
      if (simulation.previousState.x[a]! < 660 && simulation.state.x[a]! >= 660) gateCrossings++;
    }
  }
  durations.sort((a,b) => a-b);
  records.push({ ...item, ablation, actualAgents: simulation.state.count, steps,
    stepMsP50: durations[Math.floor(durations.length * .5)],
    stepMsP95: durations[Math.floor(durations.length * .95)],
    inclusivePassMsPerStep: Object.fromEntries(Object.entries(timings).map(([k,v]) => [k,v/steps])),
    gateThroughput: gateCrossings / (steps * config.fixedDelta), maximumPenetration,
    ...quality.snapshot(), behavior: behavior?.snapshot() });
}
const output = JSON.stringify({node: process.version, cpu: cpus()[0]?.model,
  seed: 42, diagnosticCadence: 10, records}, null, 2) + '\n';
if (arg('output')) writeFileSync(arg('output')!, output);
else process.stdout.write(output);
