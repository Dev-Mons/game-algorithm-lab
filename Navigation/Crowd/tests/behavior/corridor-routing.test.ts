import { describe, expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import { CrowdKernel, DEFAULT_CROWD_CONFIG } from '../../src/core';

const wall = { x: 240, y: 0, width: 40, height: 240 };
const goal = { x: 550, y: 350 };

function trajectories(corridorRouting: boolean, flipX = false, flipY = false) {
  const transformX = (x: number) => flipX ? 600 - x : x;
  const transformY = (y: number) => flipY ? 400 - y : y;
  const obstacle = { ...wall, x: flipX ? 600 - wall.x - wall.width : wall.x,
    y: flipY ? 400 - wall.y - wall.height : wall.y };
  const destination = { x: transformX(goal.x), y: transformY(goal.y) };
  const field = new FlowField(600, 400, 10);
  field.corridorRouting = corridorRouting;
  field.rebuild(destination, [obstacle], 4);
  return [60, 100, 140, 180].map(startX => {
    let x = transformX(startX), y = transformY(40), crossing = NaN, steps = 0;
    const lane = field.sampleLane(x, y), direction = { x: 0, y: 0 };
    for (; steps < 1200 && Math.hypot(x - destination.x, y - destination.y) > 3; steps++) {
      expect(field.sampleDirection(x, y, direction, lane)).toBe(true);
      const nx = x + direction.x * 2, ny = y + direction.y * 2;
      expect(segmentDistanceSquaredToRect(x, y, nx, ny, obstacle)).toBeGreaterThanOrEqual(16 - 1e-8);
      if (transformY(y) < 220 && transformY(ny) >= 220 && !Number.isFinite(crossing)) crossing = transformX(x);
      x = nx; y = ny;
    }
    return { crossing, steps, remaining: Math.hypot(x - destination.x, y - destination.y) };
  });
}

describe('corridor lane guidance', () => {
  it('turns gradually along a lane instead of snapping at a portal boundary', () => {
    const field = new FlowField(600, 400, 10);
    field.corridorRouting = true;
    field.rebuild(goal, [wall], 4);
    for (const startX of [60, 100, 140, 180]) {
      let x = startX, y = 40, previousAngle = NaN, maximumTurn = 0;
      const direction = { x: 0, y: 0 }, lane = field.sampleLane(x, y);
      for (let step = 0; step < 1400 && Math.hypot(x - goal.x, y - goal.y) > 40; step++) {
        expect(field.sampleDirection(x, y, direction, lane)).toBe(true);
        const angle = Math.atan2(direction.y, direction.x);
        if (Number.isFinite(previousAngle)) {
          maximumTurn = Math.max(maximumTurn, Math.abs(Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle))));
        }
        previousAngle = angle;
        x += direction.x; y += direction.y;
      }
      expect(Math.hypot(x - goal.x, y - goal.y)).toBeLessThanOrEqual(40);
      expect(maximumTurn * 180 / Math.PI).toBeLessThan(15);
    }
  });

  it('releases artificial portals once each inlet reaches the visible merge area', () => {
    const scenario = getScenario('four-way-merge');
    const field = new FlowField(1200, 720, 24);
    field.corridorRouting = true;
    field.rebuild(scenario.goal, scenario.obstacles, 3.55);
    const direction = { x: 0, y: 0 };
    for (const x of [470, 600, 900]) for (const y of [100, 280, 460, 640]) {
      const dx = scenario.goal.x - x, dy = scenario.goal.y - y, length = Math.hypot(dx, dy);
      for (const lane of [0, 0.25, 0.75, 1]) {
        expect(field.sampleDirection(x, y, direction, lane)).toBe(true);
        expect(direction.x).toBeCloseTo(dx / length, 10);
        expect(direction.y).toBeCloseTo(dy / length, 10);
      }
    }
  });

  it('merges all four 250-agent inlets without wall overlap or stranded cohorts', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, corridorRouting: true,
      agentCount: 1000, seed: 42 }, getScenario('four-way-merge'));
    let walls = 0;
    for (let tick = 0; tick < 1800; tick++) {
      simulation.step();
      walls = Math.max(walls, simulation.metrics.wallOverlapCount);
    }
    const arrived = [0, 0, 0, 0];
    for (let agent = 0; agent < simulation.state.count; agent++) {
      if (!simulation.state.active[agent]) arrived[simulation.agentFlow[agent]!]!++;
      expect(Number.isFinite(simulation.state.x[agent]! + simulation.state.y[agent]!)).toBe(true);
    }
    expect(arrived).toEqual([250, 250, 250, 250]);
    expect(walls).toBe(0);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])('keeps mirrored approaches wide and reaches the goal (flip=%s,%s)', (flipX, flipY) => {
    const legacy = trajectories(false, flipX, flipY), corridor = trajectories(true, flipX, flipY);
    const width = (paths: typeof legacy) => Math.max(...paths.map(p => p.crossing)) - Math.min(...paths.map(p => p.crossing));
    expect(width(corridor)).toBeGreaterThan(100);
    expect(width(corridor)).toBeGreaterThan(width(legacy) * 2);
    expect(corridor.every(path => path.remaining <= 3)).toBe(true);
    expect(Math.max(...corridor.map(path => path.steps))).toBeLessThan(Math.max(...legacy.map(path => path.steps)) * 1.6);
  });

  it('falls back through a narrow passage that cannot fit whole corridor cells', () => {
    const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, corridorRouting: true,
      width: 400, height: 200, navCellSize: 10, goalRadius: 5, arrivalSlowRadius: 25 }, 1);
    kernel.initialize({ flows: [{ id: 'one', goal: { x: 350, y: 100 } }], maxAgentRadius: 3.2,
      obstacles: [{ x: 180, y: 0, width: 20, height: 90 }, { x: 180, y: 110, width: 20, height: 90 }],
      agents: [{ id: 'a', flow: 0, radius: 3.2, x: 50, y: 100 }] });
    for (let tick = 0; tick < 900; tick++) {
      kernel.step();
      expect(kernel.metrics.wallOverlapCount).toBe(0);
    }
    expect(kernel.metrics.arrivedCount).toBe(1);
    kernel.setGoal(50, 100);
    for (let tick = 0; tick < 900; tick++) kernel.step();
    expect(kernel.metrics.arrivedCount).toBe(1);
    expect(kernel.state.x[0]).toBeLessThan(56);
  });

  it.each([2, 6])('keeps lane endpoints safe near non-grid-aligned walls (radius=%s)', clearance => {
    const obstacles = [{ x: 47, y: 0, width: 13, height: 61 }, { x: 87, y: 43, width: 12, height: 57 }];
    const field = new FlowField(140, 100, 10);
    field.corridorRouting = true;
    field.rebuild({ x: 130, y: 90 }, obstacles, clearance);
    const direction = { x: 0, y: 0 };
    for (let y = 10; y <= 90; y += 5) for (let x = 10; x <= 130; x += 5) {
      if (field.isBlockedAt(x, y)) continue;
      for (const lane of [0, 0.5, 1]) {
        if (!field.sampleDirection(x, y, direction, lane)) continue;
        for (const obstacle of obstacles) {
          expect(segmentDistanceSquaredToRect(x, y, x + direction.x * 8, y + direction.y * 8, obstacle))
            .toBeGreaterThanOrEqual(clearance * clearance - 1e-8);
        }
      }
    }
  });

  it.each([false, true])('keeps 1000 winding-corner agents safe, arriving and repeatable (upper goal=%s)', upperGoal => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, corridorRouting: true, agentCount: 1000, seed: 42 }, getScenario('winding-corners'));
    if (upperGoal) simulation.setGoal(1116, 20);
    const initial = simulation.stateHash();
    let walls = 0;
    for (let tick = 0; tick < 2700; tick++) {
      simulation.step();
      walls = Math.max(walls, simulation.metrics.wallOverlapCount);
    }
    expect(walls).toBe(0);
    expect(simulation.metrics.arrivedCount).toBe(1000);
    simulation.reset();
    if (upperGoal) simulation.setGoal(1116, 20);
    expect(simulation.stateHash()).toBe(initial);
  }, 30_000);
});
