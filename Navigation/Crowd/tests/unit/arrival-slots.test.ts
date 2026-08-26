import { describe, expect, it } from 'vitest';
import { computeArrivalSlot } from '../../src/core/arrival-slots';
import { distanceSquaredToRect } from '../../src/core/obstacle-collision';

describe('deterministic arrival slots', () => {
  const goal = { x: 300, y: 220 };
  const goalRadius = 72;
  const agentRadius = 3.2;
  const wallMargin = 0.35;
  const worldWidth = 640;
  const worldHeight = 440;

  it('reproduces the exact slot for the same seed and agent id', () => {
    const first = { x: 0, y: 0 };
    const second = { x: 0, y: 0 };
    computeArrivalSlot(
      137,
      -918273,
      goal,
      goalRadius,
      agentRadius,
      wallMargin,
      worldWidth,
      worldHeight,
      [],
      first,
    );
    computeArrivalSlot(
      137,
      -918273,
      goal,
      goalRadius,
      agentRadius,
      wallMargin,
      worldWidth,
      worldHeight,
      [],
      second,
    );
    expect(second).toEqual(first);

    const differentSeed = { x: 0, y: 0 };
    computeArrivalSlot(
      137,
      -918272,
      goal,
      goalRadius,
      agentRadius,
      wallMargin,
      worldWidth,
      worldHeight,
      [],
      differentSeed,
    );
    expect(differentSeed).not.toEqual(first);
  });

  it('spreads consecutive ids across the goal disk without directional clumping', () => {
    const count = 512;
    const quadrants = [0, 0, 0, 0];
    const unique = new Set<string>();
    let sumX = 0;
    let sumY = 0;
    let sumRadius = 0;
    for (let agent = 0; agent < count; agent += 1) {
      const slot = { x: 0, y: 0 };
      computeArrivalSlot(
        agent,
        42,
        goal,
        goalRadius,
        agentRadius,
        wallMargin,
        worldWidth,
        worldHeight,
        [],
        slot,
      );
      const dx = slot.x - goal.x;
      const dy = slot.y - goal.y;
      const distance = Math.hypot(dx, dy);
      expect(distance).toBeLessThanOrEqual(goalRadius + 1e-9);
      quadrants[(dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0)]! += 1;
      unique.add(`${slot.x.toFixed(10)},${slot.y.toFixed(10)}`);
      sumX += slot.x;
      sumY += slot.y;
      sumRadius += distance;
    }

    expect(unique.size).toBe(count);
    for (const population of quadrants) {
      expect(population).toBeGreaterThan(count * 0.2);
      expect(population).toBeLessThan(count * 0.3);
    }
    expect(Math.hypot(sumX / count - goal.x, sumY / count - goal.y)).toBeLessThan(goalRadius * 0.04);
    expect(sumRadius / count).toBeGreaterThan(goalRadius * 0.62);
    expect(sumRadius / count).toBeLessThan(goalRadius * 0.7);
  });

  it('keeps slots inside the clearance-adjusted world bounds near an edge goal', () => {
    const edgeGoal = { x: 2, y: 3 };
    const clearance = agentRadius + wallMargin;
    for (let agent = 0; agent < 128; agent += 1) {
      const slot = { x: 0, y: 0 };
      computeArrivalSlot(
        agent,
        777,
        edgeGoal,
        48,
        agentRadius,
        wallMargin,
        120,
        90,
        [],
        slot,
      );
      expect(slot.x).toBeGreaterThanOrEqual(clearance - 1e-9);
      expect(slot.y).toBeGreaterThanOrEqual(clearance - 1e-9);
      expect(slot.x).toBeLessThanOrEqual(120 - clearance + 1e-9);
      expect(slot.y).toBeLessThanOrEqual(90 - clearance + 1e-9);
      expect(Math.hypot(slot.x - edgeGoal.x, slot.y - edgeGoal.y)).toBeLessThanOrEqual(48 + 1e-9);
    }
  });

  it('skips candidates inside radius-expanded obstacles while staying in the goal disk', () => {
    const obstacle = { x: 274, y: 194, width: 52, height: 52 };
    const clearance = agentRadius + wallMargin;
    for (let agent = 0; agent < 256; agent += 1) {
      const slot = { x: 0, y: 0 };
      computeArrivalSlot(
        agent,
        2026,
        goal,
        goalRadius,
        agentRadius,
        wallMargin,
        worldWidth,
        worldHeight,
        [obstacle],
        slot,
      );
      expect(Math.hypot(slot.x - goal.x, slot.y - goal.y)).toBeLessThanOrEqual(goalRadius + 1e-9);
      expect(distanceSquaredToRect(slot.x, slot.y, obstacle))
        .toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
    }
  });

  it('chooses a deterministic nearby safe fallback when the whole goal disk is blocked', () => {
    const blockedGoal = { x: 50, y: 50 };
    const obstacle = { x: 28, y: 28, width: 44, height: 44 };
    const clearance = 4;
    const first = { x: 0, y: 0 };
    const second = { x: 0, y: 0 };
    computeArrivalSlot(9, 91, blockedGoal, 10, 3, 1, 100, 100, [obstacle], first);
    computeArrivalSlot(9, 91, blockedGoal, 10, 3, 1, 100, 100, [obstacle], second);

    expect(second).toEqual(first);
    expect(first.x).toBeGreaterThanOrEqual(clearance - 1e-9);
    expect(first.y).toBeGreaterThanOrEqual(clearance - 1e-9);
    expect(first.x).toBeLessThanOrEqual(100 - clearance + 1e-9);
    expect(first.y).toBeLessThanOrEqual(100 - clearance + 1e-9);
    expect(distanceSquaredToRect(first.x, first.y, obstacle))
      .toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
    expect(Math.hypot(first.x - blockedGoal.x, first.y - blockedGoal.y)).toBeLessThan(40);
  });
});
