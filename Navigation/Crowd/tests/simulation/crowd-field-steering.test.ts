import { describe, expect, it } from 'vitest';
import { CrowdQualityTracker } from '../../src/core/crowd-quality-metrics';
import { FlowBehaviorTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import type { ScenarioDefinition } from '../../src/core/types';
import { getScenario } from '../../src/scenarios/scenarios';

describe('CrowdField steering and quality instrumentation', () => {
  it('updates crowd samples every step but rebuilds dynamic flow at the configured cadence', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 100, dynamicFlowRebuildInterval: 6 },
      getScenario('open-field'),
    );
    const initialStaticRebuilds = simulation.navigator.staticRebuildCount;
    const initialDynamicRebuilds = simulation.navigator.dynamicRebuildCount;
    const rebuildSteps: number[] = [];
    for (let step = 0; step < 20; step += 1) {
      simulation.step();
      if (simulation.metrics.dynamicRebuildCount > 0) rebuildSteps.push(step + 1);
    }

    expect(rebuildSteps).toEqual([7, 13, 19]);
    expect(simulation.navigator.staticRebuildCount).toBe(initialStaticRebuilds);
    expect(simulation.navigator.dynamicRebuildCount - initialDynamicRebuilds).toBe(3);
    expect(simulation.metrics.dynamicRebuildIntervalSteps).toBe(6);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
  });

  it('moves a dense merge crowd into the shared gate without curling behind its spawn', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 5_000, seed: 42 },
      getScenario('merge-then-split'),
    );
    const initialX = new Float64Array(simulation.state.x);
    const initialY = new Float64Array(simulation.state.y);
    let maximumWallOverlaps = 0;
    for (let step = 0; step < 60; step += 1) {
      simulation.step();
      maximumWallOverlaps = Math.max(
        maximumWallOverlaps,
        simulation.metrics.wallOverlapCount,
      );
    }

    let backwardAgents = 0;
    let outwardAgents = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.x[agent]! <= initialX[agent]!) backwardAgents += 1;
      const upperFlow = simulation.agentFlow[agent] === 0;
      if (upperFlow
        ? simulation.state.y[agent]! <= initialY[agent]!
        : simulation.state.y[agent]! >= initialY[agent]!
      ) outwardAgents += 1;
    }

    expect(simulation.state.count).toBe(2_776);
    expect(backwardAgents).toBe(0);
    expect(outwardAgents).toBe(0);
    expect(maximumWallOverlaps).toBe(0);
  });

  it('bounds dense detours with the same progress policy regardless of obstacle and flow counts', () => {
    const baseScenario: ScenarioDefinition = {
      id: 'direction-policy',
      name: 'Direction policy',
      description: 'Direction-policy regression fixture.',
      goal: { x: 115, y: 55 },
      obstacles: [],
      spawn: { x: 10, y: 40, width: 10, height: 10 },
    };
    const scenarios: ScenarioDefinition[] = [
      baseScenario,
      {
        ...baseScenario,
        id: 'direction-policy-obstacle',
        obstacles: [{ x: 50, y: 0, width: 10, height: 10 }],
      },
      {
        ...baseScenario,
        id: 'direction-policy-multi-flow',
        flows: [
          { id: 'first', spawn: baseScenario.spawn, goal: baseScenario.goal },
          {
            id: 'second',
            spawn: { x: 100, y: 40, width: 10, height: 10 },
            goal: { x: 5, y: 55 },
          },
        ],
      },
    ];
    const directY = 5 / Math.hypot(100, 5);

    for (const scenario of scenarios) {
      const simulation = new CrowdSimulation(
        {
          ...DEFAULT_CONFIG,
          width: 120,
          height: 100,
          navCellSize: 10,
          crowdFieldCellSize: 10,
          contactCellSize: 10,
          agentCount: 0,
          dynamicFlowTargetDensity: 1,
          dynamicFlowDensityWeight: 8,
          dynamicFlowCostSmoothing: 1,
          directGoalLowDensity: 0.25,
          directGoalMinimumClearance: 0,
        },
        scenario,
      );
      for (let row = 2; row <= 7; row += 1) {
        for (let column = 1; column <= 9; column += 1) {
          simulation.crowdField.density[row * simulation.crowdField.columns + column] = 40;
        }
      }
      const rebuild = simulation as unknown as { rebuildDynamicFlowFields(): void };
      rebuild.rebuildDynamicFlowFields();
      const direction = { x: 0, y: 0 };
      simulation.navigator.sampleDirection(15, 50, direction);

      expect(Math.abs(direction.y - directY)).toBeGreaterThan(0.005);
      expect(direction.x).toBeGreaterThan(0);
      expectSharedProgressPolicy(simulation);
    }
  });

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

    const firstSnapshot = firstQuality.snapshot();
    const secondSnapshot = secondQuality.snapshot();
    const { maximumDynamicRebuildMs: firstTiming, ...firstDeterministic } = firstSnapshot;
    const { maximumDynamicRebuildMs: secondTiming, ...secondDeterministic } = secondSnapshot;
    expect(firstDeterministic).toEqual(secondDeterministic);
    expect(firstTiming).toBeGreaterThanOrEqual(0);
    expect(secondTiming).toBeGreaterThanOrEqual(0);
  });

  it('changes low-density Open Field goal progress by less than five percent', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 100, seed: 42 };
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

function expectSharedProgressPolicy(simulation: CrowdSimulation): void {
  for (let flow = 0; flow < simulation.navigators.length; flow += 1) {
    const navigator = simulation.navigators[flow]!;
    const goal = simulation.goals[flow]!;
    let denseCells = 0;
    for (let row = 0; row < navigator.rows; row += 1) {
      for (let column = 0; column < navigator.columns; column += 1) {
        const cell = row * navigator.columns + column;
        const directionX = navigator.directionX[cell]!;
        const directionY = navigator.directionY[cell]!;
        if (
          navigator.blocked[cell] === 1
          || cell === navigator.goalCell
          || (directionX === 0 && directionY === 0)
        ) continue;

        const dx = Math.round(directionX);
        const dy = Math.round(directionY);
        const next = (row + dy) * navigator.columns + column + dx;
        const candidateDrop = navigator.staticPotential[cell]!
          - navigator.staticPotential[next]!;
        expect(candidateDrop).toBeGreaterThan(0);

        const centerX = (column + 0.5) * navigator.cellSize;
        const centerY = (row + 0.5) * navigator.cellSize;
        const goalX = goal.x - centerX;
        const goalY = goal.y - centerY;
        const goalLength = Math.hypot(goalX, goalY);
        if (goalLength > 1e-9) {
          const staticGoalProgress = (
            navigator.staticDirectionX[cell]! * goalX
            + navigator.staticDirectionY[cell]! * goalY
          ) / goalLength;
          const candidateGoalProgress = (
            directionX * goalX + directionY * goalY
          ) / goalLength;
          expect(candidateGoalProgress + 1e-9).toBeGreaterThanOrEqual(
            Math.min(0, staticGoalProgress),
          );
        }

        if (navigator.densityRatio[cell]! < 2) continue;
        denseCells += 1;
        const staticColumn = column + Math.round(navigator.staticDirectionX[cell]!);
        const staticRow = row + Math.round(navigator.staticDirectionY[cell]!);
        const staticNext = staticRow * navigator.columns + staticColumn;
        const referenceDrop = navigator.staticPotential[cell]!
          - navigator.staticPotential[staticNext]!;
        expect(candidateDrop + 1e-9).toBeGreaterThanOrEqual(referenceDrop);
      }
    }
    expect(denseCells).toBeGreaterThan(0);
  }
}

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
