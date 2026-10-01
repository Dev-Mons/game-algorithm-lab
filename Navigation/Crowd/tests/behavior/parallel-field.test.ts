import { expect, it, vi } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { CorridorField } from '../../src/algorithms/flow-field/corridor-field';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';

it('keeps straight sections parallel and anticipates bends in a shared cached field', () => {
  const scenario = getScenario('winding-corners'), f = new FlowField(1200, 720, 24);
  f.parallelRouting = true; f.rebuild(scenario.goal, scenario.obstacles, 3.55);
  const trace = vi.spyOn(CorridorField.prototype, 'sampleTarget');
  try {
    const d = { x: 0, y: 0 };
    for (const x of [84, 180, 276]) {
      f.sampleDirection(x, 180, d); expect(d.x).toBeCloseTo(0, 10); expect(d.y).toBeCloseTo(1, 10);
    }
    for (const y of [36, 84, 132, 180]) {
      f.sampleDirection(516, y, d); expect(d.x).toBeCloseTo(1, 10); expect(d.y).toBeCloseTo(0, 10);
    }
    let turn = 0;
    for (const y of [396, 408, 420, 432]) {
      f.sampleDirection(180, y, d);
      expect(d.x).toBeGreaterThan(turn); expect(d.y).toBeGreaterThan(0); turn = d.x;
    }
    for (const [x, y] of [[516, 84], [516, 300], [180, 420]]) {
      const cell = Math.floor(y! / 24) * f.columns + Math.floor(x! / 24);
      f.sampleDirection(x!, y!, d);
      expect(d.x).toBeCloseTo(f.displayDirectionX[cell]!, 10);
      expect(d.y).toBeCloseTo(f.displayDirectionY[cell]!, 10);
    }
    expect(trace).not.toHaveBeenCalled();
  } finally { trace.mockRestore(); }
});

it('does not remember a body lane or branch at a shared sample point', () => {
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, parallelRouting: true, agentCount: 120 }, getScenario('rocky-pass'));
  const expected = { x: 0, y: 0 }, actual = { x: 0, y: 0 };
  s.navigator.sampleDirection(684, 348, expected);
  for (let a = 0; a < s.state.count; a++) {
    s.sampleNavigationDirection(a, 684, 348, actual); expect(actual).toEqual(expected);
  }
});

it.each([1.85, 6.35])('keeps interpolated shared directions safe at subcell positions (clearance=%s)', clearance => {
  const scenario = getScenario('rocky-pass'), f = new FlowField(1200, 720, 24);
  f.parallelRouting = true; f.rebuild(scenario.goal, scenario.obstacles, clearance);
  const d = { x: 0, y: 0 };
  for (let y = 240; y <= 504; y += 7) for (let x = 636; x <= 876; x += 7) {
    if (f.isBlockedAt(x, y) || !f.sampleDirection(x, y, d)) continue;
    for (const obstacle of scenario.obstacles) {
      expect(segmentDistanceSquaredToRect(x, y, x + d.x * 19.2, y + d.y * 19.2, obstacle))
        .toBeGreaterThanOrEqual(clearance ** 2 - 1e-8);
    }
  }
});

it.each(['winding-corners', 'rocky-pass'])('reaches the goal with 1000 bodies using the parallel field in %s', scenario => {
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, parallelRouting: true, adaptiveTurning: true,
    agentCount: 1000, agentRadius: 1.5, largeAgentPercent: 5 }, getScenario(scenario));
  let walls = 0;
  for (let tick = 0; tick < 3000; tick++) { s.step(); walls = Math.max(walls, s.metrics.wallOverlapCount); }
  expect(walls).toBe(0); expect(s.metrics.arrivedCount).toBe(1000);
}, 60_000);
