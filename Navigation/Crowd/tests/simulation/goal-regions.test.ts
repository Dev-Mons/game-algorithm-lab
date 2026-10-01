import { describe, expect, it } from 'vitest';
import { CrowdKernel, DEFAULT_CROWD_CONFIG, runCrowdReplay, snapshotCrowd } from '../../src/core';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { containsPoint } from '../../src/core/goal-regions';
import type { CrowdAgentInput, CrowdInitialState } from '../../src/core/kernel-input';
import type { Rect } from '../../src/core/types';

const regions: Rect[] = [{ x: 30, y: 170, width: 60, height: 40 }, { x: 310, y: 170, width: 60, height: 40 }];
const barrier = { x: 180, y: 0, width: 20, height: 240 };
const initial = (agents: CrowdAgentInput[], goalRegions = regions, obstacles: Rect[] = []): CrowdInitialState => ({
  flows: [{ id: 'one', goal: { x: 350, y: 120 } }, { id: 'two', goal: { x: 50, y: 120 } }],
  agents, goalRegions, obstacles, maxAgentRadius: 6.4,
});

describe.each([
  { corridorRouting: false, parallelRouting: false },
  { corridorRouting: true, parallelRouting: false },
  { corridorRouting: false, parallelRouting: true },
])('multiple destination regions (corridor=$corridorRouting, parallel=$parallelRouting)', ({ corridorRouting, parallelRouting }) => {
  const config = { ...DEFAULT_CROWD_CONFIG, width: 400, height: 240, navCellSize: 10,
    maxSpeed: 60, maxAcceleration: 120, goalRadius: 5, arrivalSlowRadius: 15, corridorRouting, parallelRouting };
  it.each([false, true])('routes disconnected populations to their reachable region (dynamic=%s)', dynamicRouting => {
    const kernel = new CrowdKernel({ ...config, dynamicRouting }, 4);
    kernel.initialize(initial([
      { id: 'left-small', flow: 0, x: 50, y: 50, radius: 3.2 },
      { id: 'left-large', flow: 1, x: 75, y: 50, radius: 6.4 },
      { id: 'right-small', flow: 0, x: 335, y: 50, radius: 3.2 },
      { id: 'right-large', flow: 1, x: 360, y: 50, radius: 6.4 },
    ], regions, [barrier]));
    expect(kernel.navigators).toHaveLength(1); // common multi-source field, not one per spawn/destination
    for (let tick = 0; tick < 360; tick++) {
      kernel.step();
      expect(kernel.metrics.wallOverlapCount).toBe(0);
    }
    expect(kernel.metrics.arrivedCount).toBe(4);
    for (let agent = 0; agent < 4; agent++) {
      expect(containsPoint(regions[agent < 2 ? 0 : 1]!, kernel.state.x[agent]!, kernel.state.y[agent]!)).toBe(true);
    }
  });

  it('uses route cost instead of the nearest region across a wall', () => {
    const field = new FlowField(400, 240, 10);
    field.corridorRouting = corridorRouting;
    field.parallelRouting = parallelRouting;
    field.rebuild({ x: 350, y: 120 }, [barrier], 3.55,
      [{ x: 205, y: 50, width: 20, height: 20 }, { x: 20, y: 190, width: 30, height: 30 }]);
    const goal = { x: 0, y: 0 }, direction = { x: 0, y: 0 };
    expect(field.sampleGoal(165, 60, goal)).toBe(true);
    expect(goal.x).toBeLessThan(100);
    expect(goal.y).toBeGreaterThan(180);
    expect(field.sampleDirection(165, 60, direction)).toBe(true);
    expect(direction.y).toBeGreaterThan(0);
  });

  it('has seeds across a wide region and handles regions smaller than a navigation cell', () => {
    const field = new FlowField(400, 240, 24);
    field.corridorRouting = corridorRouting;
    field.parallelRouting = parallelRouting;
    field.rebuild({ x: 1, y: 1 }, [], 3.55, [{ x: 100, y: 190, width: 200, height: 20 }]);
    expect(field.regionSeedCounts[0]).toBeGreaterThan(5);
    const direction = { x: 0, y: 0 };
    field.sampleDirection(110, 100, direction);
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(1);
    const kernel = new CrowdKernel(config, 1);
    const tiny = [{ x: 153, y: 123, width: 4, height: 4 }];
    kernel.initialize(initial([{ id: 'tiny', flow: 0, x: 70, y: 80, radius: 3.2 }], tiny));
    for (let tick = 0; tick < 360; tick++) kernel.step();
    expect(kernel.metrics.arrivedCount).toBe(1);
    expect(containsPoint(tiny[0]!, kernel.state.x[0]!, kernel.state.y[0]!)).toBe(true);
  });

  it('does not open blocked regions or declare arrival on the other side of their boundary', () => {
    const kernel = new CrowdKernel({ ...config, goalRadius: 58 }, 2);
    kernel.initialize(initial([
      { id: 'outside', flow: 0, x: 100, y: 150, radius: 3.2 },
      { id: 'inside-wall', flow: 0, x: 210, y: 180, radius: 3.2 },
    ], [{ x: 100, y: 170, width: 20, height: 20 }, { x: 200, y: 170, width: 20, height: 20 }],
    [{ x: 195, y: 160, width: 30, height: 40 }]));
    expect(kernel.navigator.regionSeedCounts[1]).toBe(0);
    kernel.step();
    expect(kernel.state.active[0]).toBe(1); // point goalRadius is irrelevant in region mode
    expect(kernel.state.active[1]).toBe(1); // invalid geometry is repaired, not counted as arrival
  });

  it('rebuilds region routes on terrain/goal edits and preserves point-mode replay', () => {
    const kernel = new CrowdKernel(config, 1);
    kernel.initialize(initial([{ id: 'a', flow: 0, x: 50, y: 50, radius: 3.2 }]));
    const supplied = [{ x: 310, y: 170, width: 60, height: 40 }];
    kernel.setGoalRegions(supplied);
    supplied[0]!.x = 0;
    expect(kernel.goalRegions[0]!.x).toBe(310);
    kernel.updateObstacles([barrier]);
    const direction = { x: 1, y: 1 };
    expect(kernel.sampleNavigationDirection(0, 50, 50, direction)).toBe(false);
    kernel.setGoalRegions(regions);
    expect(kernel.sampleNavigationDirection(0, 50, 50, direction)).toBe(true);
    const before = kernel.stateHash();
    expect(() => kernel.setGoalRegions([{ x: -1, y: 0, width: 20, height: 20 }])).toThrow();
    expect(kernel.stateHash()).toBe(before);
    kernel.setGoal(50, 200);
    expect(kernel.goalRegions).toEqual([]);
    expect(snapshotCrowd(kernel).goalRegions).toBeUndefined();
    const run = { schema: 'crowd-port-fixture-v1', id: 'regions', config,
      initial: initial([{ id: 'a', flow: 0, x: 50, y: 50, radius: 3.2 }]),
      commands: [{ tick: 10, kind: 'goal-regions', regions: [regions[1]] }, { tick: 20, kind: 'goal', x: 50, y: 200 }],
      checkpoints: [0, 11, 21, 60] };
    const result = runCrowdReplay(run);
    expect(result.frames[0]!.goalRegions).toEqual(regions);
    expect(result.frames[1]!.goalRegions).toEqual([regions[1]]);
    expect(result.frames[2]!.goalRegions).toBeUndefined();
    expect(runCrowdReplay(run)).toEqual(result);
  });
});
