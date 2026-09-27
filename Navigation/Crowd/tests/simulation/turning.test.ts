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
  it.each([60, 360])('keeps the same %s degree turn rate in sparse and dense crowds', (turnSpeed) => {
    for (const side of [1, 31]) {
      const mid = Math.floor(side / 2), agent = mid * side + mid;
      const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: side * side, turnSpeed }, getScenario('open-field'));
      for (let i = 0; i < simulation.state.count; i++) {
        simulation.state.x[i] = 500 + (i % side - mid) * 6.8;
        simulation.state.y[i] = 300 + (Math.floor(i / side) - mid) * 6.8;
        simulation.state.vx[i] = 86; simulation.state.vy[i] = 0;
        simulation.state.heading[i] = 0;
      }
      simulation.setGoal(500, 660);
      const ticks = 90 / turnSpeed / simulation.config.fixedDelta;
      let maximumTargetDifference = 0, contactSteps = 0;
      for (let tick = 0; tick < ticks; tick++) {
        const previous = simulation.state.heading[agent]!;
        simulation.step();
        const route = Math.atan2(simulation.state.intentY[agent]!, simulation.state.intentX[agent]!);
        const corrected = Math.atan2(simulation.debugLayers.desiredVelocityY[agent]!, simulation.debugLayers.desiredVelocityX[agent]!);
        maximumTargetDifference = Math.max(maximumTargetDifference, Math.abs(angleDelta(route, corrected)));
        if (simulation.metrics.contactCorrectedAgents > 0) contactSteps++;
        expect(angleDelta(previous, simulation.state.heading[agent]!))
          .toBeCloseTo(turnSpeed * Math.PI / 180 * simulation.config.fixedDelta, 8);
      }
      expect(simulation.state.heading[agent]).toBeCloseTo(Math.PI / 2, 8);
      if (side > 1) {
        expect(maximumTargetDifference).toBeGreaterThan(20 * Math.PI / 180);
        expect(contactSteps).toBeGreaterThan(0);
      }
    }
  });

  it.each([0.000001, 20])('does not invent pushing or drift from a lateral velocity error of %s', (lateralVelocity) => {
    const simulation = turningCrowd(60);
    simulation.config.maxAcceleration = 20;
    simulation.config.crowdVelocityBlend = 0;
    simulation.state.vy[0] = lateralVelocity;
    for (let tick = 0; tick < 45; tick++) {
      simulation.step();
      expect(simulation.state.pushVx[0]).toBe(0);
      expect(simulation.state.pushVy[0]).toBe(0);
      expect(angleDelta(simulation.state.heading[0]!, Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!)))
        .toBeCloseTo(0, 10);
    }
    expect(simulation.state.heading[0]).toBeCloseTo(Math.PI / 4, 10);
  });

  it('adds real pushing to the same walking motor and stops drifting when it is recovered', () => {
    const simulation = turningCrowd(60);
    simulation.config.maxAcceleration = 120;
    simulation.config.crowdVelocityBlend = 0;
    simulation.enqueueExternal({ kind: 'impulse', id: 'side-push', tick: 0,
      generation: simulation.external.generation, target: { agent: 0 }, dvx: 0, dvy: 48 });
    simulation.step();
    expect(simulation.state.pushVy[0]).toBeCloseTo(46, 8);
    expect(simulation.state.heading[0]).toBeCloseTo(Math.PI / 180, 10);
    expect(Math.abs(angleDelta(simulation.state.heading[0]!, Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!))))
      .toBeGreaterThan(0.1);
    for (let tick = 1; tick < 45; tick++) {
      simulation.step();
      const walkX = simulation.state.vx[0]! - simulation.state.pushVx[0]!;
      const walkY = simulation.state.vy[0]! - simulation.state.pushVy[0]!;
      expect(angleDelta(simulation.state.heading[0]!, Math.atan2(walkY, walkX))).toBeCloseTo(0, 10);
    }
    expect(simulation.state.pushVx[0]).toBe(0);
    expect(simulation.state.pushVy[0]).toBe(0);
    expect(angleDelta(simulation.state.heading[0]!, Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!)))
      .toBeCloseTo(0, 10);
  });

  it.each([0, 1, 20, 210])('turns at the configured rate independently of acceleration=%s', (maxAcceleration) => {
    const simulation = turningCrowd(60);
    simulation.config.maxAcceleration = maxAcceleration;
    // Isolate motor control from the grid's physical momentum blending.
    simulation.config.crowdVelocityBlend = 0;
    for (let tick = 0; tick < 45; tick++) {
      const heading = simulation.state.heading[0]!;
      simulation.step();
      expect(angleDelta(heading, simulation.state.heading[0]!)).toBeCloseTo(Math.PI / 180, 8);
      expect(angleDelta(simulation.state.heading[0]!, Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!)))
        .toBeCloseTo(0, 8);
      expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeCloseTo(86, 4);
    }
  });

  it.each([0, 60, 720])('uses the same scalar acceleration and braking at turnSpeed=%s', (turnSpeed) => {
    const simulation = turningCrowd(turnSpeed);
    simulation.config.maxAcceleration = 6;
    simulation.state.vx[0] = 20;
    simulation.step();
    expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeCloseTo(20.1, 8);
    expect(simulation.state.heading[0]).toBeCloseTo(turnSpeed * Math.PI / 180 / 60, 8);
    simulation.config.maxSpeed = 10;
    simulation.step();
    expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeCloseTo(20, 8);
    expect(simulation.state.heading[0]).toBeCloseTo(2 * turnSpeed * Math.PI / 180 / 60, 8);
    expect(angleDelta(simulation.state.heading[0]!, Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!)))
      .toBeCloseTo(0, 8);
  });

  it.each([0, 30])('snaps to the flow only on a wall hit at turnSpeed=%s, then travels forward', (turnSpeed) => {
    const simulation = turningCrowd(turnSpeed);
    simulation.updateObstacles([{ x: 504, y: 200, width: 10, height: 350 }]);
    simulation.state.heading[0] = 0.4;
    simulation.state.vx[0] = 86 * Math.cos(0.4);
    simulation.state.vy[0] = 86 * Math.sin(0.4);
    simulation.step();
    const route = Math.atan2(simulation.state.intentY[0]!, simulation.state.intentX[0]!);
    expect(Math.abs(angleDelta(0.4, route))).toBeGreaterThan(0.5);
    expect(angleDelta(simulation.state.heading[0]!, route)).toBeCloseTo(0, 10);
    expect(angleDelta(Math.atan2(simulation.state.vy[0]!, simulation.state.vx[0]!), route)).toBeCloseTo(0, 10);
    expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeGreaterThan(20);
    expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeLessThanOrEqual(86 + 1e-8);
    expect(simulation.state.x[0]).toBeLessThanOrEqual(504 - simulation.config.agentRadius - simulation.config.wallMargin + 1e-8);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
    const y = simulation.state.y[0]!;
    simulation.step();
    expect(simulation.state.y[0]).toBeGreaterThan(y);
    expect(simulation.metrics.wallOverlapCount).toBe(0);

    // A hit must not leave the exception enabled for subsequent free movement.
    simulation.updateObstacles([]);
    simulation.setGoal(100, 300);
    const previous = simulation.state.heading[0]!;
    simulation.step();
    expect(Math.abs(angleDelta(previous, simulation.state.heading[0]!)))
      .toBeLessThanOrEqual(turnSpeed * Math.PI / 180 * simulation.config.fixedDelta + 1e-8);
  });

  it('uses the same collision exception at the world boundary', () => {
    const simulation = turningCrowd(0);
    simulation.state.x[0] = simulation.config.width - 4;
    simulation.setGoal(simulation.state.x[0]!, 660);
    simulation.step();
    expect(angleDelta(simulation.state.heading[0]!,
      Math.atan2(simulation.state.intentY[0]!, simulation.state.intentX[0]!))).toBeCloseTo(0, 10);
    expect(simulation.state.heading[0]).toBeGreaterThan(1);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
  });

  it('keeps its heading on a wall hit when the flow has no reachable direction', () => {
    const simulation = turningCrowd(0);
    simulation.config.maxAcceleration = 0;
    simulation.updateObstacles([{ x: 504, y: 0, width: 10, height: simulation.config.height }]);
    simulation.setGoal(900, 300);
    simulation.step();
    expect(simulation.state.intentX[0]).toBe(0);
    expect(simulation.state.intentY[0]).toBe(0);
    expect(simulation.state.heading[0]).toBe(0);
    expect(simulation.state.vx[0]).toBeCloseTo(0, 8);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
  });

  it('does not snap for agent contacts without a wall', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 2, turnSpeed: 0 }, getScenario('open-field'));
    simulation.state.x.set([500, 504]); simulation.state.y.fill(300);
    simulation.state.vx.fill(0); simulation.state.vy.fill(0); simulation.state.heading.fill(0);
    simulation.setGoal(500, 660);
    simulation.step();
    expect(simulation.metrics.contactCorrectedAgents).toBeGreaterThan(0);
    expect([...simulation.state.heading]).toEqual([0, 0]);
  });

  it.each([
    { acceleration: 20, nearWall: false, turnSpeed: 30 },
    { acceleration: 20, nearWall: true, turnSpeed: 30 },
    { acceleration: 210, nearWall: true, turnSpeed: 30 },
    { acceleration: 210, nearWall: true, turnSpeed: 0 },
  ])('keeps forward and travel together with $acceleration acceleration, nearWall=$nearWall, turnSpeed=$turnSpeed', ({ acceleration, nearWall, turnSpeed }) => {
    const simulation = turningCrowd(turnSpeed);
    simulation.config.maxAcceleration = acceleration;
    if (nearWall) simulation.updateObstacles([{ x: 460, y: 270, width: 10, height: 60 }]);
    for (let tick = 0; tick < 45; tick++) {
      const heading = simulation.state.heading[0]!;
      const x = simulation.state.x[0]!, y = simulation.state.y[0]!;
      simulation.step();
      const travel = Math.atan2(simulation.state.y[0]! - y, simulation.state.x[0]! - x);
      expect(Math.abs(angleDelta(heading, simulation.state.heading[0]!)))
        .toBeLessThanOrEqual(turnSpeed * Math.PI / 180 * simulation.config.fixedDelta + 1e-8);
      expect(angleDelta(simulation.state.heading[0]!, travel)).toBeCloseTo(0, 8);
      expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeGreaterThan(80);
      expect(simulation.metrics.wallOverlapCount).toBe(0);
    }
  });

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

  it.each([0, 30, 60])('keeps moving through sharp commands at %s degrees per second', (turnSpeed) => {
    for (const goal of [{ x: 500, y: 660 }, { x: 100, y: 300 }]) {
      const simulation = turningCrowd(turnSpeed);
      simulation.config.maxAcceleration = DEFAULT_CONFIG.maxAcceleration;
      simulation.setGoal(goal.x, goal.y);
      let distance = 0;
      for (let tick = 0; tick < 90; tick++) {
        const x = simulation.state.x[0]!, y = simulation.state.y[0]!;
        const heading = simulation.state.heading[0]!;
        simulation.step();
        distance += Math.hypot(simulation.state.x[0]! - x, simulation.state.y[0]! - y);
        expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeGreaterThan(80);
        expect(Math.abs(angleDelta(heading, simulation.state.heading[0]!)))
          .toBeLessThanOrEqual(turnSpeed * Math.PI / 180 * simulation.config.fixedDelta + 1e-8);
      }
      expect(distance).toBeGreaterThan(120);
      if (turnSpeed === 0) {
        expect(simulation.state.x[0]).toBeGreaterThan(620);
        expect(simulation.state.y[0]).toBeCloseTo(300, 8);
      }
    }
  });
});
