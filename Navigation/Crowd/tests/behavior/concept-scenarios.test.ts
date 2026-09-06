import { describe, expect, it } from 'vitest';
import { FlowBehaviorTracker, RouteUtilizationTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

const concepts = ['winding-corners', 'funnel-bypass', 'four-way-merge'];

function stepSafely(simulation: CrowdSimulation): void {
  simulation.step();
  expect(simulation.metrics.wallOverlapCount).toBe(0);
  expect(simulation.metrics.candidateChecks).toBeLessThanOrEqual(simulation.state.count * 24);
  expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(simulation.state.count * 8);
}

describe('sketch concept scenarios through the shared navigation pipeline', () => {
  it.each(concepts)('spawns the full default population on reachable cells and replays %s', (id) => {
    const scenario = getScenario(id);
    expect(scenario.id).toBe(id);
    const first = new CrowdSimulation({ ...DEFAULT_CONFIG }, scenario);
    const second = new CrowdSimulation({ ...DEFAULT_CONFIG }, scenario);
    expect(first.state.count).toBe(1000);
    expect(first.unspawnedCount).toBe(0);
    for (let agent = 0; agent < first.state.count; agent += 1) {
      // All concept flows have the same goal, so their static navigation data agree.
      const column = Math.floor(first.state.x[agent]! / first.config.navCellSize);
      const row = Math.floor(first.state.y[agent]! / first.config.navCellSize);
      const cell = row * first.navigator.columns + column;
      expect(first.navigator.blocked[cell]).toBe(0);
      expect(Number.isFinite(first.navigator.staticPotential[cell])).toBe(true);
    }
    for (let step = 0; step < 120; step += 1) {
      stepSafely(first);
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('takes all three alternating corners and reaches the far exit', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario('winding-corners'));
    const passed = [new Set<number>(), new Set<number>(), new Set<number>()];
    const walls = simulation.scenario.obstacles;
    for (let step = 0; step < 2400; step += 1) {
      stepSafely(simulation);
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        walls.forEach((wall, index) => {
          const exitX = wall.x + wall.width + simulation.config.agentRadius;
          if (simulation.previousState.x[agent]! < exitX && simulation.state.x[agent]! >= exitX) {
            passed[index]!.add(agent);
            const y = simulation.state.y[agent]!;
            expect(index === 1 ? y < wall.y : y > wall.height).toBe(true);
          }
        });
      }
    }
    expect(passed.every((agents) => agents.size >= 990)).toBe(true);
    expect(simulation.metrics.arrivedCount).toBeGreaterThanOrEqual(990);
  }, 20_000);

  it('uses the wider bypass when the taper becomes crowded', () => {
    const scenario = getScenario('funnel-bypass');
    const dynamic = new CrowdSimulation({ ...DEFAULT_CONFIG }, scenario);
    const staticOnly = new CrowdSimulation({
      ...DEFAULT_CONFIG,
      dynamicFlowDensityWeight: 0,
      dynamicFlowOverloadWeight: 0,
      dynamicFlowCounterFlowWeight: 0,
      dynamicFlowWallWeight: 0,
    }, scenario);
    const dynamicRoutes = new RouteUtilizationTracker(dynamic);
    const staticRoutes = new RouteUtilizationTracker(staticOnly);
    for (let step = 0; step < 1800; step += 1) {
      stepSafely(dynamic);
      stepSafely(staticOnly);
      dynamicRoutes.update();
      staticRoutes.update();
    }
    const result = dynamicRoutes.snapshot();
    expect(result.utilization[0]).toBeGreaterThan(500);
    expect(result.utilization[1]).toBeGreaterThan(50);
    expect(result.utilization[1]).toBeGreaterThan(staticRoutes.snapshot().utilization[1]! + 50);
    expect(result.unclassifiedAgents).toBeLessThanOrEqual(10);
  }, 20_000);

  it('merges four equally sized inlets toward one goal without starving an inlet', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario('four-way-merge'));
    expect(simulation.flowCount).toBe(4);
    expect(simulation.goals.every((goal) => goal.x === 1116 && goal.y === 612)).toBe(true);
    const tracker = new FlowBehaviorTracker(simulation, 180);
    for (let step = 0; step < 1500; step += 1) {
      stepSafely(simulation);
      tracker.update();
    }
    const result = tracker.snapshot();
    expect(result.initialAgents).toEqual([250, 250, 250, 250]);
    expect(result.crossings).toEqual([250, 250, 250, 250]);
    expect(Math.min(...result.arrived)).toBeGreaterThanOrEqual(240);
    expect(result.crossingFairness).toBe(1);
  }, 20_000);
});
