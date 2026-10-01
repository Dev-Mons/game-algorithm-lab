import { describe, expect, it } from 'vitest';
import { CrowdKernel, DEFAULT_CROWD_CONFIG } from '../../src/core';
import { angleDelta } from '../../src/core/math';
import { ROCKY_PASS } from '../../src/scenarios/rocky-pass';

const radians = Math.PI / 180;

function movingAgent(headingDegrees: number, turnSpeed = 30, adaptiveTurning = true) {
  const heading = headingDegrees * radians;
  const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, corridorRouting: true,
    adaptiveTurning, turnSpeed, agentRadius: 3, crowdVelocityBlend: 0 }, 1);
  kernel.initialize({
    flows: [{ id: 'east', goal: { x: 1000, y: 300 } }], obstacles: [], maxAgentRadius: 3,
    agents: [{ id: 'one', flow: 0, radius: 3, x: 500, y: 300, heading,
      vx: 86 * Math.cos(heading), vy: 86 * Math.sin(heading) }],
  });
  return kernel;
}

describe('adaptive turning motor', () => {
  it.each([-150, 150])('boosts a %s degree turn without reducing walking speed', heading => {
    const kernel = movingAgent(heading);
    kernel.step();
    expect(angleDelta(heading * radians, kernel.state.heading[0]!) / radians)
      .toBeCloseTo(-Math.sign(heading) * 2, 8);
    expect(Math.hypot(kernel.state.vx[0]!, kernel.state.vy[0]!)).toBeCloseTo(86, 8);
  });

  it('returns to the configured base rate while closing the remaining angle', () => {
    const kernel = movingAgent(150);
    let previousRate = Infinity, baseSteps = 0, intermediateSteps = 0;
    for (let tick = 0; tick < 180; tick++) {
      const previous = kernel.state.heading[0]!;
      kernel.step();
      const delta = Math.abs(angleDelta(previous,
        Math.atan2(kernel.state.intentY[0]!, kernel.state.intentX[0]!))) / radians;
      const rate = Math.abs(angleDelta(previous, kernel.state.heading[0]!)) / radians / kernel.config.fixedDelta;
      expect(rate).toBeLessThanOrEqual(previousRate + 1e-7);
      if (delta > 1 && delta <= 30) {
        expect(rate).toBeCloseTo(30, 7);
        baseSteps++;
      } else if (delta > 30 && delta < 120) {
        expect(rate).toBeGreaterThan(30);
        expect(rate).toBeLessThan(120);
        intermediateSteps++;
      }
      expect(Math.hypot(kernel.state.vx[0]!, kernel.state.vy[0]!)).toBeCloseTo(86, 7);
      previousRate = rate;
      if (delta < 0.5) break;
    }
    expect(baseSteps).toBeGreaterThan(10);
    expect(intermediateSteps).toBeGreaterThan(10);
  });

  it.each([-0.1, 0.1])('finishes a %s degree remainder without overshooting', heading => {
    const kernel = movingAgent(heading);
    kernel.step();
    const route = Math.atan2(kernel.state.intentY[0]!, kernel.state.intentX[0]!);
    expect(angleDelta(kernel.state.heading[0]!, route)).toBeCloseTo(0, 10);
  });

  it('switches the boost at runtime and uses a changed base setting immediately', () => {
    const kernel = movingAgent(150, 30, false);
    kernel.step();
    expect(kernel.state.heading[0]! / radians).toBeCloseTo(149.5, 8);
    kernel.config.adaptiveTurning = true;
    kernel.step();
    expect(kernel.state.heading[0]! / radians).toBeCloseTo(147.5, 8);
    kernel.config.turnSpeed = 60;
    kernel.step();
    expect(kernel.state.heading[0]! / radians).toBeCloseTo(143.5, 8);
    kernel.config.adaptiveTurning = false;
    kernel.step();
    expect(kernel.state.heading[0]! / radians).toBeCloseTo(142.5, 8);
  });

  it('respects a zero base rate without braking the agent', () => {
    const kernel = movingAgent(150, 0);
    kernel.step();
    expect(kernel.state.heading[0]! / radians).toBeCloseTo(150, 8);
    expect(Math.hypot(kernel.state.vx[0]!, kernel.state.vy[0]!)).toBeCloseTo(86, 8);
  });

  it.each([false, true])('reaches the goal from the former rocky-pass orbit with adaptiveTurning=%s', adaptiveTurning => {
    const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, corridorRouting: true,
      adaptiveTurning, agentRadius: 1.5, turnSpeed: 30 }, 1);
    kernel.initialize({
      flows: [{ id: 'one', goal: { x: 144.73385488840262, y: 370.6703632055369 } }],
      obstacles: ROCKY_PASS.obstacles, maxAgentRadius: 1.5,
      agents: [{ id: 'orbit', flow: 0, radius: 1.5, x: 281, y: 513,
        heading: Math.PI, vx: -86, vy: 0 }],
    });
    // Keep the original orbit's lane. Consistent routing now fixes this case
    // even before angular boosting is needed; preserve the arrival regression.
    (kernel as unknown as { navigationLane: Float64Array }).navigationLane[0] = 0.5;
    for (let tick = 0; tick < 3600; tick++) kernel.step();
    expect(kernel.state.active[0]).toBe(0);
  });
});
