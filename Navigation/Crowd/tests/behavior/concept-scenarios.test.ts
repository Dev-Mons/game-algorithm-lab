import { describe, expect, it } from 'vitest';
import { FlowBehaviorTracker, RouteUtilizationTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { CrowdQualityTracker } from '../../src/core/crowd-quality-metrics';
import { getScenario } from '../../src/scenarios/scenarios';

const concepts = ['winding-corners', 'funnel-bypass', 'four-way-merge', 'rocky-pass'];

function stepSafely(simulation: CrowdSimulation): void {
  simulation.step();
  expect(simulation.metrics.wallOverlapCount).toBe(0);
  expect(simulation.metrics.candidateChecks).toBeLessThanOrEqual(simulation.state.count * 24);
  expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
    simulation.state.count * 8 * simulation.metrics.constraintIterations);
}

describe('sketch concept scenarios through the shared navigation pipeline', () => {
  it.each(concepts)('spawns the full default population on reachable cells and replays %s', (id) => {
    const scenario = getScenario(id);
    expect(scenario.id).toBe(id);
    const first = new CrowdSimulation({ ...DEFAULT_CONFIG }, scenario);
    const second = new CrowdSimulation({ ...DEFAULT_CONFIG }, scenario);
    expect(first.state.count).toBe(1000);
    expect(first.unspawnedCount).toBe(0);
    expect(first.navigators).toEqual([first.navigator]);
    const directionX = first.navigator.directionX.slice();
    const directionY = first.navigator.directionY.slice();
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
    expect(first.navigator.dynamicRebuildCount).toBe(0);
    expect(first.navigator.directionX).toEqual(directionX);
    expect(first.navigator.directionY).toEqual(directionY);
  }, 20_000);

  it('shares one field across spawn cohorts and rebuilds it once when the goal changes', () => {
    const simulation = new CrowdSimulation({...DEFAULT_CONFIG, agentCount: 100},getScenario('four-way-merge'));
    expect(simulation.flowCount).toBe(4);
    expect(simulation.navigators).toEqual([simulation.navigator]);
    const rebuilds = simulation.navigator.staticRebuildCount;
    simulation.setGoal(1116,660);
    expect(simulation.navigator.staticRebuildCount).toBe(rebuilds+1);
    expect(simulation.navigator.dynamicRebuildCount).toBe(0);
    expect(simulation.navigators).toEqual([simulation.navigator]);
    for (let a = 0; a < simulation.state.count; a++) expect(simulation.goalForAgent(a)).toEqual({x:1116,y:660});
    simulation.reset();
    expect(simulation.navigators).toEqual([simulation.navigator]);
    expect(simulation.goals.every(g => g.x === 1116 && g.y === 612)).toBe(true);
  });

  it('takes all three alternating corners and reaches the far exit', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario('winding-corners'));
    const quality = new CrowdQualityTracker(simulation);
    const passed = [new Set<number>(), new Set<number>(), new Set<number>()];
    const walls = simulation.scenario.obstacles;
    for (let step = 0; step < 2400; step += 1) {
      stepSafely(simulation);
      if (step < 900) quality.update();
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
    // The long interior seam is sub-grid: test particle occupancy as well as
    // arrivals. Compression must not buy compactness by injecting contact jitter.
    const continuity = quality.snapshot();
    expect(continuity.interiorVoidFraction).toBeLessThan(.006);
    expect(continuity.jerkExtendedP95).toBeLessThan(20_000);
  }, 20_000);

  it('can opt into legacy congestion routing for the wider-bypass comparison', () => {
    const scenario = getScenario('funnel-bypass');
    const dynamic = new CrowdSimulation({ ...DEFAULT_CONFIG, dynamicRouting: true }, scenario);
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
