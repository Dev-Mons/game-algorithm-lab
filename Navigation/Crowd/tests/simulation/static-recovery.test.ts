import { describe, expect, it } from 'vitest';
import { CrowdKernel, DEFAULT_CROWD_CONFIG } from '../../src/core';
import { distanceSquaredToRect, segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import type { CrowdAgentInput } from '../../src/core/kernel-input';
import type { Rect } from '../../src/core/types';

// TinyDead's CPU recovery cases, in the same core units. Deliberately invalid
// starts exercise recovery without weakening the obstacle-edit validation.
const seam: Rect[] = [
  { x: 180, y: 0, width: 10, height: 130 },
  { x: 180, y: 130, width: 30, height: 10 },
];

function createKernel(obstacles: Rect[], agents: CrowdAgentInput[]): CrowdKernel {
  const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG,
    width: 400, height: 240, navCellSize: 10, goalRadius: 5,
    arrivalSlowRadius: 10, maxSpeed: 60, maxAcceleration: 120,
  }, agents.length);
  kernel.initialize({ obstacles, agents, maxAgentRadius: 5.6,
    flows: [{ id: 'goal', goal: { x: 360, y: 120 } }],
  });
  return kernel;
}

function expectClear(kernel: CrowdKernel): void {
  for (let agent = 0; agent < kernel.state.count; agent++) {
    const x = kernel.state.x[agent]!, y = kernel.state.y[agent]!;
    const clearance = kernel.agentRadii[agent]! + kernel.config.wallMargin - 1e-6;
    expect(x).toBeGreaterThanOrEqual(clearance);
    expect(y).toBeGreaterThanOrEqual(clearance);
    expect(x).toBeLessThanOrEqual(kernel.config.width - clearance);
    expect(y).toBeLessThanOrEqual(kernel.config.height - clearance);
    for (const obstacle of kernel.obstacles) {
      expect(distanceSquaredToRect(x, y, obstacle)).toBeGreaterThanOrEqual(clearance ** 2);
    }
  }
}

describe('TinyDead static overlap recovery', () => {
  it.each([false, true])('preserves a blocked goal through rebuilds (dynamic routing: %s)', dynamicRouting => {
    const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, width: 400, height: 240,
      navCellSize: 10, goalRadius: 5, preserveBlockedGoal: true, dynamicRouting }, 2);
    const obstacles = [{ x: 340, y: 100, width: 40, height: 40 }];
    kernel.initialize({ obstacles, maxAgentRadius: 5.6,
      flows: [{ id: 'goal', goal: { x: 360, y: 120 } }],
      agents: [3.2, 5.6].map((radius, i) => ({ id: String(i), flow: 0, radius, x: 50, y: 60 + i * 20 })),
    });
    const expectBlocked = () => {
      expect(kernel.navigator.blocked[kernel.navigator.goalCell]).toBe(1);
      expect(kernel.navigator.staticPotential.every(value => value === Infinity)).toBe(true);
      expect(kernel.navigator.dynamicPotential.every(value => value === Infinity)).toBe(true);
      for (let agent = 0; agent < 2; agent++) {
        const direction = { x: 1, y: 1 };
        expect(kernel.sampleNavigationDirection(agent, 50, 60 + agent * 20, direction)).toBe(false);
        expect(direction).toEqual({ x: 0, y: 0 });
      }
    };
    expectBlocked();
    for (let tick = 0; tick < 20; tick++) kernel.step();
    expectBlocked();
    kernel.setGoal(320, 60);
    expect(kernel.navigator.staticPotential.some(Number.isFinite)).toBe(true);
    kernel.setGoal(360, 120);
    expectBlocked();
    kernel.updateObstacles([]);
    expect(kernel.navigator.staticPotential.some(Number.isFinite)).toBe(true);
    kernel.updateObstacles(obstacles);
    expectBlocked();
  });

  it.each([
    { name: 'legal approach to the seam', obstacles: seam, x: 50, y: 60, radius: 3.2 },
    { name: 'seam penetration', obstacles: seam, x: 185, y: 130, radius: 3.2 },
    { name: 'large body at the seam', obstacles: seam, x: 185, y: 130, radius: 5.6 },
    { name: 'obstacle at the world boundary', obstacles: [{ x: 0, y: 0, width: 20, height: 130 }], x: 10, y: 60, radius: 3.2 },
    { name: 'inside one rectangle', obstacles: [{ x: 280, y: 160, width: 40, height: 40 }], x: 300, y: 180, radius: 3.2 },
  ])('recovers and resumes movement: $name', ({ obstacles, x, y, radius }) => {
    const kernel = createKernel(obstacles, [{ id: 'probe', flow: 0, radius, x, y }]);
    for (let tick = 0; tick < 600; tick++) {
      kernel.step();
      expectClear(kernel);
    }
    expect(Math.hypot(kernel.state.x[0]! - 360, kernel.state.y[0]! - 120)).toBeLessThan(10);
    expect(kernel.agentIds).toEqual(['probe']);
    expect(kernel.external.generation).toBe(1);
  });

  it('does not cross a previously separate wall to escape a seam', () => {
    const wall = { x: 175, y: 0, width: 1, height: 240 };
    const kernel = createKernel([...seam, wall], [{ id: 'probe', flow: 0, radius: 3.2, x: 185, y: 130 }]);
    kernel.step();
    expectClear(kernel);
    expect(segmentDistanceSquaredToRect(185, 130, kernel.state.x[0]!, kernel.state.y[0]!, wall))
      .toBeGreaterThanOrEqual((3.2 + kernel.config.wallMargin - 1e-7) ** 2);
    expect(kernel.state.x[0]).toBeGreaterThan(wall.x + wall.width + 3.2);
  });

  it('keeps unreachable and fully blocked cases finite without teleporting to the goal', () => {
    for (const obstacle of [{ x: 180, y: 0, width: 20, height: 240 }, { x: 0, y: 0, width: 400, height: 240 }]) {
      const kernel = createKernel([obstacle], [{ id: 'probe', flow: 0, radius: 3.2, x: 50, y: 60 }]);
      for (let tick = 0; tick < 120; tick++) kernel.step();
      expect(Number.isFinite(kernel.state.x[0])).toBe(true);
      expect(Number.isFinite(kernel.state.y[0])).toBe(true);
      expect(kernel.state.x[0]).toBeLessThan(180);
      expect(kernel.state.active[0]).toBe(1);
    }
  });

  it('recovers all 48 simultaneous boundary/seam penetrations and resumes progress', () => {
    const agents = Array.from({ length: 48 }, (_, i) => ({ id: String(i), flow: 0, radius: 3.2,
      x: i < 24 ? 10 : 40 + (i - 24) * 11, y: i < 24 ? 10 + i * 9 : 110,
    }));
    const kernel = createKernel([
      { x: 30, y: 100, width: 280, height: 10 },
      { x: 30, y: 110, width: 280, height: 10 },
      { x: 0, y: 0, width: 20, height: 240 },
    ], agents);
    for (let tick = 0; tick < 600; tick++) {
      kernel.step();
      expectClear(kernel);
    }
    for (let i = 0; i < agents.length; i++) {
      const initialDistance = Math.hypot(agents[i]!.x - 360, agents[i]!.y - 120);
      const finalDistance = Math.hypot(kernel.state.x[i]! - 360, kernel.state.y[i]! - 120);
      expect(initialDistance - finalDistance, `agent ${i}`).toBeGreaterThan(20);
    }
  });
});
