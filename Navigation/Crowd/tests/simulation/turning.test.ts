import { describe, expect, it } from 'vitest';
import { angleDelta } from '../../src/core/math';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

function turningCrowd(turnSpeed: number) {
  const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1, turnSpeed,
    maxAcceleration: 1000 }, getScenario('open-field'));
  simulation.state.x[0] = 500;
  simulation.state.y[0] = 300;
  simulation.state.vx[0] = 86;
  simulation.state.vy[0] = 0;
  simulation.state.heading[0] = 0;
  simulation.setGoal(500, 660);
  return simulation;
}

describe('movement turn speed', () => {
  it('changes actual trajectories, while limiting unobstructed velocity turns', () => {
    const slow = turningCrowd(60), fast = turningCrowd(720);
    for (let tick = 0; tick < 45; tick++) {
      const previous = Math.atan2(slow.state.vy[0]!, slow.state.vx[0]!);
      slow.step(); fast.step();
      const velocityAngle = Math.atan2(slow.state.vy[0]!, slow.state.vx[0]!);
      expect(Math.abs(angleDelta(previous, velocityAngle))).toBeLessThanOrEqual(Math.PI / 180 + 1e-8);
      expect(angleDelta(slow.state.heading[0]!, velocityAngle)).toBeCloseTo(0, 8);
      expect(slow.metrics.wallOverlapCount).toBe(0);
    }
    expect(slow.state.x[0]! - fast.state.x[0]!).toBeGreaterThan(15);
    expect(fast.state.y[0]! - slow.state.y[0]!).toBeGreaterThan(10);
  });

  it('keeps momentum on a reverse command and eventually moves toward the new goal', () => {
    const simulation = turningCrowd(180);
    simulation.setGoal(100, 300);
    expect(simulation.state.vx[0]).toBe(86);
    expect(simulation.state.heading[0]).toBe(0);
    simulation.step();
    expect(simulation.state.vx[0]).toBeGreaterThan(0);
    for (let tick = 0; tick < 120; tick++) simulation.step();
    expect(simulation.state.vx[0]).toBeLessThan(-1);
    expect(simulation.state.x[0]).toBeLessThan(500);
  });
});
