import { describe, expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { ROCKY_PASS } from '../../src/scenarios/rocky-pass';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';

function rocky(clearance: number, reverse = false) {
  const field = new FlowField(1200, 720, 24);
  field.corridorRouting = true;
  field.rebuild(ROCKY_PASS.goal, reverse ? [...ROCKY_PASS.obstacles].reverse() : ROCKY_PASS.obstacles, clearance);
  return field;
}

describe('consistent corridor branches', () => {
  it.each([1.85, 3.55])('does not alternate upper and lower routes across equal-cost cells (clearance=%s)', clearance => {
    const field = rocky(clearance), reversed = rocky(clearance, true);
    const direction = { x: 0, y: 0 }, other = { x: 0, y: 0 };
    for (const x of [684, 708, 732, 756]) {
      field.sampleDirection(x, 348, direction, 0.5);
      reversed.sampleDirection(x, 348, other, 0.5);
      expect(direction.x).toBeGreaterThan(0);
      expect(direction.y).toBeGreaterThanOrEqual(0);
      expect(other.x).toBeCloseTo(direction.x, 10);
      expect(other.y).toBeCloseTo(direction.y, 10);
    }
  });

  it.each([1.85, 3.55])('keeps the same branch across the conservative wall fringe (clearance=%s)', clearance => {
    const field = rocky(clearance), direction = { x: 0, y: 0 };
    let previous = { x: 0, y: 0 };
    for (let x = 789; x <= 796; x++) {
      expect(field.sampleDirection(x, 286, direction, 0.5)).toBe(true);
      expect(direction.y).toBeLessThan(-0.8);
      if (x > 789) expect(direction.x * previous.x + direction.y * previous.y).toBeGreaterThan(0.98);
      for (const obstacle of ROCKY_PASS.obstacles) {
        expect(segmentDistanceSquaredToRect(x, 286, x + direction.x * 19.2, 286 + direction.y * 19.2, obstacle))
          .toBeGreaterThanOrEqual(clearance * clearance - 1e-8);
      }
      previous = { ...direction };
    }
  });

  it('retains the selected detour under boundary jitter, advances along it, and releases after a large push', () => {
    const field = rocky(3.55), route = { room: -1 }, direction = { x: 0, y: 0 };
    for (const y of [335, 336, 335, 338, 334]) {
      field.sampleDirection(780, y, direction, 0.5, route);
      expect(direction.y).toBeLessThan(-0.9);
    }
    const before = route.room;
    field.sampleDirection(780, 300, direction, 0.5, route);
    expect(route.room).not.toBe(before);
    expect(direction.y).toBeLessThan(-0.9);
    field.sampleDirection(780, 380, direction, 0.5, route);
    expect(direction.y).toBeGreaterThan(0.9);
  });

  it('uses independent route commitments for agents on opposite sides of a real split', () => {
    const field = rocky(3.55), north = { room: -1 }, south = { room: -1 }, direction = { x: 0, y: 0 };
    field.sampleDirection(780, 335, direction, 0.5, north);
    field.sampleDirection(780, 336, direction, 0.5, south);
    for (const y of [335, 336, 337]) {
      field.sampleDirection(780, y, direction, 0.5, north);
      expect(direction.y).toBeLessThan(-0.9);
      field.sampleDirection(780, y, direction, 0.5, south);
      expect(direction.y).toBeGreaterThan(0.9);
    }
  });
});
