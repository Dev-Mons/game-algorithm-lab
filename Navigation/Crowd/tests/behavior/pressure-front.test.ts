import { expect, it, vi } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { CrowdKernel, DEFAULT_CROWD_CONFIG } from '../../src/core';
import { auditGeometry } from '../../src/core/lab-results';
import { getScenario } from '../../src/scenarios/scenarios';

it.each([false, true])('keeps the converging rocky-pass front filled without disabling pressure or contacts (parallel=%s)', parallelRouting => {
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 10000, agentRadius: 1.5,
    largeAgentPercent: 5, largeAgentScale: 2, adaptiveTurning: true, parallelRouting }, getScenario('rocky-pass'));
  // The unscaled spawn is capacity limited; do not call this a 10k population.
  expect(s.state.count).toBe(3989);
  const front = (top: number, bottom: number): number => {
    const xs = [...s.state.x].filter((x, a) => s.state.active[a]
      && s.state.y[a]! >= top && s.state.y[a]! < bottom && x < 432).sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(100);
    return xs[Math.floor(xs.length * 0.95)]!;
  };
  let maximumWalls = 0, maximumPenetration = 0, pressureActive = false, contactsActive = false;
  let middle = 0, sides = 0;
  for (let tick = 1; tick <= 300; tick++) {
    s.step();
    maximumWalls = Math.max(maximumWalls, s.metrics.wallOverlapCount);
    pressureActive ||= s.crowdFlow.pressure.some(p => p > 0);
    contactsActive ||= s.metrics.contactConstraints > 0;
    if (tick === 120) { middle = front(348, 372); sides = Math.max(front(318, 342), front(378, 402)); }
    if (tick % 10 === 0) {
      const audit = auditGeometry(s);
      expect(audit.walls).toBe(0); expect(audit.nonfinite).toBe(0);
      maximumPenetration = Math.max(maximumPenetration, audit.maxPenetration);
    }
  }
  // The middle must not lag into a cleft more than two small-body diameters.
  expect(sides - middle).toBeLessThan(s.config.agentRadius * 4);
  expect(middle).toBeGreaterThan(250);
  expect(maximumWalls).toBe(0);
  // Existing fixed-budget contacts leave ~1.26px peak overlap in this dense
  // mixed-size replay. Filling the front must not double that compression.
  expect(maximumPenetration).toBeLessThan(1.3);
  expect(pressureActive && contactsActive).toBe(true);
}, 20_000);

it.each([0, 160])('applies both pressure components on the same step while retaining a %s px/s external push', push => {
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, width: 400, height: 400,
      maxSpeed: 40, maxAcceleration: 0 }, 1);
    kernel.initialize({ flows: [{ id: 'one', goal: { x: 100 + dx! * 200, y: 100 + dy! * 200 } }],
      obstacles: [], maxAgentRadius: 3.2, agents: [{ id: 'one', flow: 0, x: 100, y: 100, radius: 3.2,
        vx: dx! * (40 + push), vy: dy! * (40 + push), pushVx: dx! * push, pushVy: dy! * push }] });
    // Isolate impulse application from grid generation: simultaneous braking
    // and sideways pressure must reach the physical velocity, not two controllers.
    vi.spyOn(kernel.crowdFlow, 'solve').mockImplementation(() => {
      kernel.crowdFlow.pressureVelocityX = new Float64Array([-10 * dx! - 5 * dy!]);
      kernel.crowdFlow.pressureVelocityY = new Float64Array([-10 * dy! + 5 * dx!]);
    });
    kernel.step();
    expect(kernel.state.vx[0]).toBeCloseTo((30 + push) * dx! - 5 * dy!, 8);
    expect(kernel.state.vy[0]).toBeCloseTo((30 + push) * dy! + 5 * dx!, 8);
    expect(kernel.metrics.wallOverlapCount).toBe(0);
  }
});

it.each([0, -80])('stops forward motion without creating or amplifying backward transport (push=%s)', push => {
  const kernel = new CrowdKernel({ ...DEFAULT_CROWD_CONFIG, width: 400, height: 400,
    maxSpeed: 40, maxAcceleration: 0 }, 1);
  kernel.initialize({ flows: [{ id: 'one', goal: { x: 300, y: 100 } }], obstacles: [], maxAgentRadius: 3.2,
    agents: [{ id: 'one', flow: 0, x: 100, y: 100, radius: 3.2, vx: 40 + push, pushVx: push }] });
  vi.spyOn(kernel.crowdFlow, 'solve').mockImplementation(() => {
    kernel.crowdFlow.pressureVelocityX = new Float64Array([-100]);
    kernel.crowdFlow.pressureVelocityY = new Float64Array([0]);
  });
  kernel.step();
  expect(kernel.state.vx[0]).toBeCloseTo(Math.min(0, 40 + push), 8);
});
