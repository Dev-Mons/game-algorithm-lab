import { expect, it, vi } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { CorridorField } from '../../src/algorithms/flow-field/corridor-field';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import type { Rect, Vec2 } from '../../src/core/types';

function fluidField(id: string, clearance = 3.55, regions: Rect[] = []): FlowField {
  const scenario = getScenario(id), field = new FlowField(1200, 720, 24);
  field.fluidRouting = true;
  field.rebuild(scenario.goal, scenario.obstacles, clearance, regions);
  return field;
}

it('turns a corner on nested arcs instead of turning every lane on one line', () => {
  const f = fluidField('winding-corners');
  const trace = vi.spyOn(CorridorField.prototype, 'sampleTarget');
  try {
    const d = { x: 0, y: 0 };
    // Below the first wall the outer lane is still descending while the inner
    // lane has already turned east; the parallel field turns them all at once.
    let turned = -Infinity;
    for (const x of [36, 108, 180, 252, 324]) {
      f.sampleDirection(x, 540, d);
      expect(d.x).toBeGreaterThan(turned); turned = d.x;
    }
    f.sampleDirection(36, 540, d); expect(d.y).toBeGreaterThan(d.x);
    f.sampleDirection(324, 540, d); expect(d.x).toBeGreaterThan(d.y);
    // Straight passages keep a common forward axis.
    for (const x of [420, 516, 612]) {
      f.sampleDirection(x, 360, d); expect(d.y).toBeLessThan(-0.95);
    }
    for (const [x, y] of [[36, 540], [516, 372], [948, 612]] as const) {
      const cell = Math.floor(y / 24) * f.columns + Math.floor(x / 24);
      f.sampleDirection(x, y, d);
      expect(d.x).toBeCloseTo(f.displayDirectionX[cell]!, 10);
      expect(d.y).toBeCloseTo(f.displayDirectionY[cell]!, 10);
    }
    expect(trace).not.toHaveBeenCalled();
  } finally { trace.mockRestore(); }
});

it('does not let the stream rounding the last wall spill up into the open bay', () => {
  const f = fluidField('winding-corners'), d = { x: 0, y: 0 };
  // The goal is below this bay. Plain drainage sends the busy stream from the
  // wall tip up along the wall to y≈384; slope-weighted conductance does not.
  for (let y = 12; y <= 420; y += 24) for (let x = 948; x <= 1188; x += 24) {
    expect(f.sampleDirection(x, y, d)).toBe(true);
    expect(d.y).toBeGreaterThan(0);
  }
});

it.each([
  ['winding-corners', []],
  ['rocky-pass', []],
  ['funnel-bypass', [{ x: 1104, y: 0, width: 96, height: 120 }, { x: 1104, y: 600, width: 96, height: 120 }]],
] as [string, Rect[]][])('leaves no local minimum outside the goal seeds in %s', (id, regions) => {
  const f = fluidField(id, 3.55, regions);
  let unknown = 0;
  for (let cell = 0; cell < f.cellCount; cell++) {
    const value = f.fluidPotential[cell]!;
    if (!Number.isFinite(value)) {
      expect(f.blocked[cell] === 1 || !f.isReachable(cell % f.columns, Math.floor(cell / f.columns))).toBe(true);
      continue;
    }
    const column = cell % f.columns, row = Math.floor(cell / f.columns);
    const lower = [
      column > 0 ? cell - 1 : -1, column < f.columns - 1 ? cell + 1 : -1,
      row > 0 ? cell - f.columns : -1, row < f.rows - 1 ? cell + f.columns : -1,
    ].some(next => next >= 0 && f.fluidPotential[next]! < value);
    const seed = regions.length
      ? regions.some(r => column * 24 < r.x + r.width && (column + 1) * 24 > r.x && row * 24 < r.y + r.height && (row + 1) * 24 > r.y)
      : cell === f.goalCell;
    if (seed) continue;
    unknown++;
    expect(lower).toBe(true);
  }
  expect(unknown).toBeGreaterThan(500);
});

it('does not remember a body lane or branch at a shared fluid sample point', () => {
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, fluidRouting: true, agentCount: 120 }, getScenario('rocky-pass'));
  expect(s.navigator.fluidRouting).toBe(true);
  expect(s.navigator.parallelRouting).toBe(false);
  expect(s.navigator.corridorRouting).toBe(false);
  const expected = { x: 0, y: 0 }, actual = { x: 0, y: 0 };
  s.navigator.sampleDirection(684, 348, expected);
  for (let a = 0; a < s.state.count; a++) {
    s.sampleNavigationDirection(a, 684, 348, actual); expect(actual).toEqual(expected);
  }
});

it.each([1.85, 6.35])('keeps interpolated fluid directions safe at subcell positions (clearance=%s)', clearance => {
  const scenario = getScenario('rocky-pass'), f = fluidField('rocky-pass', clearance);
  const d: Vec2 = { x: 0, y: 0 };
  for (let y = 240; y <= 504; y += 7) for (let x = 636; x <= 876; x += 7) {
    if (f.isBlockedAt(x, y) || !f.sampleDirection(x, y, d)) continue;
    for (const obstacle of scenario.obstacles) {
      expect(segmentDistanceSquaredToRect(x, y, x + d.x * 19.2, y + d.y * 19.2, obstacle))
        .toBeGreaterThanOrEqual(clearance ** 2 - 1e-8);
    }
  }
});

it.each(['winding-corners', 'rocky-pass'])('reaches the goal with 1000 bodies using the fluid field in %s', scenario => {
  // Also covers point arrival behind an occluding corner inside the slowdown
  // ring: without the approach floor one rocky-pass body creeps forever.
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, fluidRouting: true, adaptiveTurning: true,
    agentCount: 1000, agentRadius: 1.5, largeAgentPercent: 5 }, getScenario(scenario));
  let walls = 0;
  for (let tick = 0; tick < 2400; tick++) { s.step(); walls = Math.max(walls, s.metrics.wallOverlapCount); }
  expect(walls).toBe(0); expect(s.metrics.arrivedCount).toBe(1000);
}, 60_000);
