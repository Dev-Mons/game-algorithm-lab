import { describe, expect, it } from 'vitest';
import { CrowdQualityTracker } from '../../src/core/crowd-quality-metrics';
import { FlowBehaviorTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('CrowdField steering and quality instrumentation', () => {
  it.each(['open-field', 'dense-spawn', 'obstacle-field'])(
    'measures 4,990/5,000/5,010 field quality in %s',
    (scenarioId) => {
      const snapshots = [4_990, 5_000, 5_010].map((agentCount) => {
        const simulation = new CrowdSimulation(
          {
            ...DEFAULT_CONFIG,
            agentCount,
            agentRadius: 1.5,
            agentGap: 0.05,
            neighborRadius: 2.9,
          },
          getScenario(scenarioId),
        );
        expect(simulation.state.count).toBe(agentCount);
        const quality = new CrowdQualityTracker(simulation);
        for (let step = 0; step < 30; step += 1) {
          simulation.step();
          quality.update();
        }
        expect(quality.snapshot().maximumWallOverlapCount).toBe(0);
        return quality.snapshot();
      });
      for (let index = 1; index < snapshots.length; index += 1) {
        const first = snapshots[index - 1]!;
        const second = snapshots[index]!;
        expect(relativeChange(first.occupiedArea, second.occupiedArea)).toBeLessThanOrEqual(0.15);
        expect(relativeChange(first.densityP95, second.densityP95)).toBeLessThanOrEqual(0.15);
      }
      expect(relativeChange(
        snapshots[1]!.averageGoalProgress,
        snapshots[2]!.averageGoalProgress,
      )).toBeLessThanOrEqual(0.15);
      expect(relativeChange(
        snapshots[1]!.maxPenetrationDepth,
        snapshots[2]!.maxPenetrationDepth,
        3,
      )).toBeLessThanOrEqual(0.15);
    },
    20_000,
  );

  it('calculates the same bounded quality snapshot for the same replay', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 31415 };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const firstQuality = new CrowdQualityTracker(first);
    const secondQuality = new CrowdQualityTracker(second);
    for (let step = 0; step < 90; step += 1) {
      first.step();
      second.step();
      firstQuality.update();
      secondQuality.update();
    }

    expect(firstQuality.snapshot()).toEqual(secondQuality.snapshot());
  });

  it('changes low-density Open Field goal progress by less than five percent', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 100, seed: 42 };
    const steering = new CrowdSimulation({ ...config }, getScenario('open-field'));
    const baseline = new CrowdSimulation(
      { ...config, pressureStrength: 0, viscosityStrength: 0 },
      getScenario('open-field'),
    );
    const steeringQuality = new CrowdQualityTracker(steering);
    const baselineQuality = new CrowdQualityTracker(baseline);
    for (let step = 0; step < 180; step += 1) {
      steering.step();
      baseline.step();
      steeringQuality.update();
      baselineQuality.update();
    }
    const steeringProgress = steeringQuality.snapshot().averageGoalProgress;
    const baselineProgress = baselineQuality.snapshot().averageGoalProgress;
    const relativeChange = Math.abs(steeringProgress - baselineProgress) / baselineProgress;

    expect(relativeChange).toBeLessThanOrEqual(0.05);
    expect(steering.metrics.wallOverlapCount).toBe(0);
  });

  it('combines field pressure with bounded XPBD work in a completely overlapping crowd', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentCount: 5_000,
      agentRadius: 1.5,
      agentGap: 0.05,
    };
    const steering = new CrowdSimulation({ ...config }, getScenario('open-field'));
    const baseline = new CrowdSimulation(
      { ...config, pressureStrength: 0, viscosityStrength: 0 },
      getScenario('open-field'),
    );
    overlapAt(steering, 200, 360);
    overlapAt(baseline, 200, 360);
    const steeringQuality = new CrowdQualityTracker(steering);
    const baselineQuality = new CrowdQualityTracker(baseline);
    let boundedContactWork = true;
    for (let step = 0; step < 60; step += 1) {
      steering.step();
      baseline.step();
      steeringQuality.update();
      baselineQuality.update();
      boundedContactWork &&= steering.metrics.contactConstraints
        <= steering.metrics.activeCount
          * steering.metrics.maxContacts
          * steering.metrics.constraintIterations;
    }
    const steered = steeringQuality.snapshot();
    const unsteered = baselineQuality.snapshot();

    expect(steered.occupiedArea).toBeGreaterThan(unsteered.occupiedArea);
    expect(steered.densityP95).toBeLessThanOrEqual(unsteered.densityP95);
    expect(steered.penetrationP95).toBeLessThanOrEqual(unsteered.penetrationP95 + 0.02);
    expect(steered.averageGoalProgress).toBeGreaterThan(0);
    expect(boundedContactWork).toBe(true);
    expect(steered.maximumPositionCorrection).toBeLessThanOrEqual(
      steering.config.maximumContactCorrection + 1e-9,
    );
    expect(steered.maximumWallOverlapCount).toBe(0);
  });

  it('reduces Dense Spawn density without an unbounded penetration regression', () => {
    const config = {
      ...DEFAULT_CONFIG,
      agentCount: 5_000,
      agentRadius: 1.5,
      agentGap: 0.05,
    };
    const steering = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const baseline = new CrowdSimulation(
      { ...config, pressureStrength: 0, viscosityStrength: 0 },
      getScenario('dense-spawn'),
    );
    const steeringQuality = new CrowdQualityTracker(steering);
    const baselineQuality = new CrowdQualityTracker(baseline);
    for (let step = 0; step < 60; step += 1) {
      steering.step();
      baseline.step();
      steeringQuality.update();
      baselineQuality.update();
    }
    const steered = steeringQuality.snapshot();
    const unsteered = baselineQuality.snapshot();

    expect(steered.densityP95).toBeLessThan(unsteered.densityP95);
    expect(steered.penetrationP95).toBeLessThanOrEqual(unsteered.penetrationP95 + 0.02);
    expect(steered.averageGoalProgress).toBeGreaterThan(0);
    expect(steered.maximumWallOverlapCount).toBe(0);
  });

  it('does not average opposing flows into a global stop', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 600, seed: 42 },
      getScenario('opposing-500-500'),
    );
    const behavior = new FlowBehaviorTracker(simulation, 180);
    for (let step = 0; step < 600; step += 1) {
      simulation.step();
      behavior.update();
    }
    const result = behavior.snapshot();

    expect(Math.min(...result.crossings)).toBeGreaterThan(50);
    expect(result.routeUtilizationFairness).toBeGreaterThanOrEqual(0.9);
    expect(result.lanePersistence).toBeGreaterThan(0.5);
    expect(Math.max(...result.maximumStarvationSteps)).toBeLessThan(180);
    expect(result.maximumWallOverlaps).toBe(0);
  });
});

function overlapAt(simulation: CrowdSimulation, x: number, y: number): void {
  for (let agent = 0; agent < simulation.state.count; agent += 1) {
    simulation.state.x[agent] = x;
    simulation.state.y[agent] = y;
    simulation.state.vx[agent] = 40;
    simulation.state.vy[agent] = 0;
    simulation.state.active[agent] = 1;
  }
}

function relativeChange(first: number, second: number, floor = 1e-9): number {
  return Math.abs(second - first) / Math.max(Math.abs(first), Math.abs(second), floor);
}
