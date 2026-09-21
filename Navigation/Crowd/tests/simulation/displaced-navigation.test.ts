import { describe, expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { FUNNEL_V2 } from '../fixtures/funnel-v2';
import { getScenario } from '../../src/scenarios/scenarios';

describe('navigation after contact displacement', () => {
  it.each([360, 624, 888])('recovers sub-nanometer penetration beside the wall at x=%s', (wallX) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1, maxSpeed: 68 },
      getScenario('winding-corners'));
    const clearance = simulation.config.agentRadius + simulation.config.wallMargin;
    simulation.state.x[0] = wallX - clearance + 5.5e-11;
    simulation.state.y[0] = 460;
    simulation.state.vx[0] = 0;
    simulation.state.vy[0] = 0;
    for (let step = 0; step < 120; step++) {
      simulation.step();
      expect(simulation.metrics.wallOverlapCount).toBe(0);
    }
    const progress = wallX === 624 ? 460 - simulation.state.y[0]! : simulation.state.y[0]! - 460;
    // The first wall ends 44px below the start, where the route turns east.
    expect(progress).toBeGreaterThan(40);
  });

  it.each([68, 86])('clears all winding walls at speed %s with a saturated spawn', (maxSpeed) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 10000, maxSpeed },
      getScenario('winding-corners'));
    expect(simulation.state.count).toBe(1656);
    let maximumWalls = 0;
    for (let step = 0; step < 3600; step++) {
      simulation.step();
      maximumWalls = Math.max(maximumWalls, simulation.metrics.wallOverlapCount);
    }
    expect(maximumWalls).toBe(0);
    // Check obstacle clearance, allowing the existing arrival slowdown to settle
    // at the goal boundary without requiring the exit sink to deactivate it.
    for (let agent = 0; agent < simulation.state.count; agent++) {
      expect(Math.hypot(simulation.state.x[agent]! - simulation.goal.x,
        simulation.state.y[agent]! - simulation.goal.y)).toBeLessThan(simulation.config.goalRadius + 1);
    }
  }, 30_000);

  it.each([3.35, 6.35])('escapes a corner from the actual position with clearance %s', (clearance) => {
    const field = new FlowField(1200, 720, 24);
    field.rebuild(FUNNEL_V2.goal, FUNNEL_V2.obstacles, clearance);
    // The cell-center route points northeast, but that ray from this displaced
    // point hits the corner. The body must first travel north along the wall.
    const x = 384 - clearance;
    const y = 431.95;
    const direction = { x: 1, y: 0 };
    expect(field.sampleDirection(x, y, direction)).toBe(true);
    expect(direction.y).toBeLessThan(-0.5);
    for (const obstacle of FUNNEL_V2.obstacles) {
      expect(segmentDistanceSquaredToRect(x, y,
        x + direction.x * 19.2, y + direction.y * 19.2, obstacle))
        .toBeGreaterThanOrEqual(clearance ** 2 - 1e-9);
    }
  });

  it('uses the new position immediately and releases a displaced large body from the corner', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 2, agentRadius: 3,
      largeAgentPercent: 50 }, FUNNEL_V2);
    const large = simulation.agentRadii.findIndex(radius => radius === 6);
    simulation.state.x[large] = 377.65;
    simulation.state.y[large] = 431.95;
    simulation.state.intentX[large] = 1;
    simulation.state.intentY[large] = 0;
    simulation.step();
    expect(simulation.state.intentY[large]).toBeLessThan(-0.5);
    for (let step = 0; step < 120; step++) {
      simulation.step();
      expect(simulation.metrics.wallOverlapCount).toBe(0);
    }
    expect(simulation.state.x[large]).toBeGreaterThan(420);
    expect(simulation.state.y[large]).toBeLessThan(420);
  });

  it('does not replace an unreachable field with a straight direction through a wall', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 2, agentRadius: 3,
      largeAgentPercent: 50 }, { ...FUNNEL_V2,
      obstacles: [{ x: 600, y: 0, width: 24, height: 720 }],
    });
    for (let agent = 0; agent < simulation.state.count; agent++) {
      const direction = { x: 1, y: 1 };
      expect(simulation.sampleNavigationDirection(agent, 300, 400, direction)).toBe(false);
      expect(direction).toEqual({ x: 0, y: 0 });
    }
  });

  it.each([10, 20])('clears 깔때기V2 with %s%% large bodies without leaving a body at a corner', (percent) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentRadius: 3,
      largeAgentPercent: percent }, FUNNEL_V2);
    for (let step = 0; step < 3600; step++) {
      simulation.step();
      expect(simulation.metrics.wallOverlapCount).toBe(0);
      expect(simulation.metrics.candidateChecks).toBeLessThanOrEqual(simulation.state.count * 24);
      expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
        simulation.state.count * 8 * simulation.metrics.constraintIterations);
    }
    // Arrival slowdown can settle a body on the goal-region boundary. This
    // regression checks that no body is left behind at any obstacle instead.
    for (let agent = 0; agent < simulation.state.count; agent++) {
      expect(Math.hypot(simulation.state.x[agent]! - simulation.goal.x,
        simulation.state.y[agent]! - simulation.goal.y)).toBeLessThan(simulation.config.goalRadius + 1);
    }
  }, 30_000);
});
