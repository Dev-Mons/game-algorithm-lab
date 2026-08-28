import { describe, expect, it } from 'vitest';
import { FlowBehaviorTracker, RouteUtilizationTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('generic multi-flow scenarios', () => {
  it.each(['merge-500-500', 'crossing-500-500'])(
    'keeps both streams moving in %s',
    (scenarioId) => {
      const simulation = new CrowdSimulation(
        { ...DEFAULT_CONFIG, agentCount: 400, seed: 42 },
        getScenario(scenarioId),
      );
      const tracker = new FlowBehaviorTracker(simulation, 180);
      for (let step = 0; step < 900; step += 1) {
        simulation.step();
        tracker.update();
      }
      const result = tracker.snapshot();
      expect(result.initialAgents).toEqual([200, 200]);
      expect(Math.min(...result.crossings)).toBeGreaterThan(40);
      expect(result.crossingFairness).toBeGreaterThanOrEqual(0.85);
      expect(result.maximumWallOverlaps).toBe(0);
      expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
    },
    20_000,
  );

  it('replays independent flow goals with the same state hash', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 200, seed: 73 };
    const first = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    const second = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    for (let step = 0; step < 360; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('increases alternate-gate use after the initially favored equal gate becomes congested', () => {
    const scenario = getScenario('equal-capacity-congested-gates');
    const dynamic = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000, seed: 42 },
      scenario,
    );
    const staticOnly = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        agentCount: 1000,
        seed: 42,
        dynamicFlowDensityWeight: 0,
        dynamicFlowOverloadWeight: 0,
        dynamicFlowCounterFlowWeight: 0,
        dynamicFlowWallWeight: 0,
      },
      scenario,
    );
    const dynamicRoutes = new RouteUtilizationTracker(dynamic);
    const staticRoutes = new RouteUtilizationTracker(staticOnly);
    for (let step = 0; step < 900; step += 1) {
      dynamic.step();
      staticOnly.step();
      dynamicRoutes.update();
      staticRoutes.update();
    }
    const result = dynamicRoutes.snapshot();
    const baseline = staticRoutes.snapshot();

    expect(result.utilization[1]).toBeGreaterThan(baseline.utilization[1]! * 1.4);
    expect(result.routeUtilizationFairness).toBeGreaterThanOrEqual(0.95);
    expect(result.dynamicRebuilds).toBeGreaterThan(0);
    expect(result.maximumWallOverlaps).toBe(0);
  }, 20_000);

  it.each([
    ['different-capacity-gates', 0.8],
    ['merge-then-split', 0.75],
    ['opposing-occupied-corridor', 0.9],
  ] as const)('uses both declared routes without wall penetration in %s', (scenarioId, fairness) => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 400, seed: 42 },
      getScenario(scenarioId),
    );
    const routes = new RouteUtilizationTracker(simulation);
    for (let step = 0; step < 900; step += 1) {
      simulation.step();
      routes.update();
    }
    const result = routes.snapshot();

    expect(Math.min(...result.utilization)).toBeGreaterThan(40);
    expect(result.routeUtilizationFairness).toBeGreaterThanOrEqual(fairness);
    expect(result.maximumWallOverlaps).toBe(0);
  }, 20_000);
});
