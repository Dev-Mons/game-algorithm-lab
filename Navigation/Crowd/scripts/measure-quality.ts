import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CrowdQualityTracker, type CrowdQualitySnapshot } from '../src/core/crowd-quality-metrics';
import { FlowBehaviorTracker } from '../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { getScenario } from '../src/scenarios/scenarios';

const BOUNDARY_COUNTS = [4_990, 5_000, 5_010] as const;
const SCENARIOS = ['open-field', 'dense-spawn', 'obstacle-field'] as const;
const CONTINUITY_LIMIT = 0.15;
const seed = Math.trunc(Number(argument('seed') ?? 42));
const steps = Math.max(1, Math.trunc(Number(argument('steps') ?? 120)));
const timingWarmupSteps = Math.min(10, Math.max(0, Math.floor(steps / 4)));
const selectedScenario = argument('scenario');
const scenarios = SCENARIOS.filter((scenario) => !selectedScenario || scenario === selectedScenario);
const records: QualityRecord[] = [];

for (const scenarioId of scenarios) {
  const measurements = BOUNDARY_COUNTS.map((requestedAgents) => {
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        seed,
        agentCount: requestedAgents,
        agentRadius: 1.5,
        agentGap: 0.05,
        neighborRadius: 2.9,
      },
      getScenario(scenarioId),
    );
    if (simulation.state.count !== requestedAgents) {
      throw new Error(
        `${scenarioId} spawned ${simulation.state.count}/${requestedAgents}; boundary measurement is invalid.`,
      );
    }
    const tracker = new CrowdQualityTracker(simulation);
    const durations = new Float64Array(Math.max(1, steps - timingWarmupSteps));
    const previousX = new Float64Array(simulation.state.x);
    const gateX = simulation.scenario.spawn.x + simulation.scenario.spawn.width + 24;
    return {
      requestedAgents,
      simulation,
      tracker,
      durations,
      previousX,
      gateX,
      gateCrossings: 0,
    };
  });
  // Interleave adjacent populations so CPU boost, scheduler noise, and JIT
  // state affect all three boundary samples evenly.
  for (let step = 0; step < steps; step += 1) {
    for (let offset = 0; offset < measurements.length; offset += 1) {
      const measurement = measurements[(step + offset) % measurements.length]!;
      const { simulation, tracker, durations, previousX, gateX } = measurement;
      const startedAt = performance.now();
      simulation.step();
      if (step >= timingWarmupSteps) {
        durations[step - timingWarmupSteps] = performance.now() - startedAt;
      }
      tracker.update();
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (previousX[agent]! < gateX && simulation.state.x[agent]! >= gateX) {
          measurement.gateCrossings += 1;
        }
        previousX[agent] = simulation.state.x[agent]!;
      }
    }
  }
  for (const measurement of measurements) {
    const {
      requestedAgents,
      simulation,
      tracker,
      durations,
      gateCrossings,
    } = measurement;
    durations.sort();
    records.push({
      scenario: scenarioId,
      requestedAgents,
      agents: simulation.state.count,
      seed,
      steps,
      gateThroughputPerSecond: gateCrossings / (steps * simulation.config.fixedDelta),
      stepMsP50: percentile(durations, 0.5),
      stepMsP95: percentile(durations, 0.95),
      ...tracker.snapshot(),
    });
  }
}

const violations = continuityViolations(records);
const completeOverlap = measureCompleteOverlap(seed);
const lowDensity = measureLowDensity(seed);
const flowBehavior = ['opposing-500-500', 'crossing-500-500'].map((scenarioId) => {
  const simulation = new CrowdSimulation(
    { ...DEFAULT_CONFIG, agentCount: 600, seed },
    getScenario(scenarioId),
  );
  const tracker = new FlowBehaviorTracker(simulation, 180);
  for (let step = 0; step < 600; step += 1) {
    simulation.step();
    tracker.update();
  }
  return { scenario: scenarioId, ...tracker.snapshot() };
});

const result = roundObject({
  schemaVersion: 1,
  command: 'npm run measure:quality',
  config: {
    seed,
    steps,
    counts: BOUNDARY_COUNTS,
    scenarios,
    continuityLimit: CONTINUITY_LIMIT,
    timingWarmupSteps,
  },
  records,
  continuity: {
    passed: violations.length === 0,
    violations,
  },
  completeOverlap,
  lowDensity,
  flowBehavior,
});

const json = `${JSON.stringify(result, null, 2)}\n`;
process.stdout.write(json);
if (process.argv.includes('--write')) {
  writeFileSync(resolve('baselines/baseline-crowd-quality.json'), json, 'utf8');
}
if (violations.length > 0 || !completeOverlap.passed || !lowDensity.passed) {
  process.exitCode = 1;
}

interface QualityRecord extends CrowdQualitySnapshot {
  scenario: string;
  requestedAgents: number;
  agents: number;
  seed: number;
  steps: number;
  gateThroughputPerSecond: number;
  stepMsP50: number;
  stepMsP95: number;
}

function continuityViolations(values: readonly QualityRecord[]): object[] {
  const metrics = [
    'averageGoalProgress',
    'gateThroughputPerSecond',
    'occupiedArea',
    'densityP95',
    'jerkP95',
    'maxPenetrationDepth',
    'stepMsP50',
    'stepMsP95',
  ] as const;
  const failures: object[] = [];
  for (const scenario of scenarios) {
    const matching = values.filter((record) => record.scenario === scenario);
    for (let index = 1; index < matching.length; index += 1) {
      const first = matching[index - 1]!;
      const second = matching[index]!;
      for (const metric of metrics) {
        const change = relativeChange(first[metric], second[metric]);
        if (change <= CONTINUITY_LIMIT) continue;
        failures.push({
          scenario,
          pair: [first.agents, second.agents],
          metric,
          first: first[metric],
          second: second[metric],
          relativeChange: change,
        });
      }
    }
  }
  return failures;
}

function measureCompleteOverlap(seedValue: number): {
  passed: boolean;
  initial: CrowdQualitySnapshot;
  final: CrowdQualitySnapshot;
  checks: Record<string, boolean>;
} {
  const simulation = new CrowdSimulation(
    {
      ...DEFAULT_CONFIG,
      seed: seedValue,
      agentCount: 10_000,
      agentRadius: 1.5,
      agentGap: 0.05,
    },
    getScenario('open-field'),
  );
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    simulation.state.x[agent] = 200;
    simulation.state.y[agent] = 360;
    simulation.state.vx[agent] = 40;
    simulation.state.vy[agent] = 0;
    simulation.state.active[agent] = 1;
  }
  simulation.crowdField.update(simulation.state, simulation.config.pressureThreshold, 0);
  const initialTracker = new CrowdQualityTracker(simulation);
  initialTracker.update();
  const initial = initialTracker.snapshot();
  const finalTracker = new CrowdQualityTracker(simulation);
  for (let step = 0; step < 60; step += 1) {
    simulation.step();
    finalTracker.update();
  }
  const final = finalTracker.snapshot();
  const checks = {
    boundedWork: final.contactConstraints
      <= simulation.state.count * final.maxContacts * final.constraintIterations,
    occupiedAreaIncreased: final.occupiedArea > initial.occupiedArea,
    maximumPenetrationReduced: final.maxPenetrationDepth < initial.maxPenetrationDepth,
    penetrationP95Reduced: final.penetrationP95 < initial.penetrationP95,
    positiveGoalProgress: final.averageGoalProgress > 0,
    noWallOverlap: final.maximumWallOverlapCount === 0,
    boundedPositionCorrection: final.maximumPositionCorrection
      <= simulation.config.maximumContactCorrection + 1e-9,
  };
  return { passed: Object.values(checks).every(Boolean), initial, final, checks };
}

function measureLowDensity(seedValue: number): {
  passed: boolean;
  steeringProgress: number;
  baselineProgress: number;
  relativeChange: number;
} {
  const config = { ...DEFAULT_CONFIG, seed: seedValue, agentCount: 100 };
  const steering = new CrowdSimulation({ ...config }, getScenario('open-field'));
  const baseline = new CrowdSimulation(
    {
      ...config,
      pressureStrength: 0,
      viscosityStrength: 0,
      dynamicFlowDensityWeight: 0,
      dynamicFlowOverloadWeight: 0,
      dynamicFlowCounterFlowWeight: 0,
      dynamicFlowWallWeight: 0,
    },
    getScenario('open-field'),
  );
  const steeringTracker = new CrowdQualityTracker(steering);
  const baselineTracker = new CrowdQualityTracker(baseline);
  for (let step = 0; step < 180; step += 1) {
    steering.step();
    baseline.step();
    steeringTracker.update();
    baselineTracker.update();
  }
  const steeringProgress = steeringTracker.snapshot().averageGoalProgress;
  const baselineProgress = baselineTracker.snapshot().averageGoalProgress;
  const change = relativeChange(steeringProgress, baselineProgress);
  return {
    passed: change <= 0.05,
    steeringProgress,
    baselineProgress,
    relativeChange: change,
  };
}

function relativeChange(first: number, second: number): number {
  const scale = Math.max(Math.abs(first), Math.abs(second));
  return scale <= 1e-9 ? 0 : Math.abs(second - first) / scale;
}

function percentile(sorted: Float64Array, fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function roundObject<T>(value: T): T {
  if (typeof value === 'number') return Number(value.toFixed(4)) as T;
  if (Array.isArray(value)) return value.map((item) => roundObject(item)) as T;
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) output[key] = roundObject(item);
    return output as T;
  }
  return value;
}
