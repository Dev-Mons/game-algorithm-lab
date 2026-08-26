import { describe, expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';

describe('Reverse Dijkstra Flow Field', () => {
  it('always points to a lower integration cost on reachable cells', () => {
    const field = new FlowField(100, 100, 10);
    field.rebuild({ x: 95, y: 55 }, [{ x: 40, y: 20, width: 10, height: 60 }]);
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.columns; column += 1) {
        const index = row * field.columns + column;
        if (field.blocked[index] === 1 || !Number.isFinite(field.costs[index]) || index === field.goalCell) continue;
        const dx = Math.round(field.directionX[index]!);
        const dy = Math.round(field.directionY[index]!);
        const next = (row + dy) * field.columns + column + dx;
        expect(field.costs[next]).toBeLessThan(field.costs[index]!);
      }
    }
  });

  it('never creates a direction into an impassable cell', () => {
    const field = new FlowField(80, 80, 10);
    field.rebuild({ x: 75, y: 45 }, [{ x: 30, y: 10, width: 20, height: 60 }]);
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.columns; column += 1) {
        const index = row * field.columns + column;
        const dx = Math.round(field.directionX[index]!);
        const dy = Math.round(field.directionY[index]!);
        if (dx === 0 && dy === 0) continue;
        const next = (row + dy) * field.columns + column + dx;
        expect(field.blocked[next]).toBe(0);
      }
    }
  });

  it('distinguishes reachable and unreachable cells', () => {
    const field = new FlowField(100, 100, 10);
    field.rebuild({ x: 85, y: 50 }, [{ x: 40, y: 0, width: 20, height: 100 }]);
    expect(field.isReachable(8, 5)).toBe(true);
    expect(field.isReachable(1, 5)).toBe(false);
    expect(field.isReachable(4, 5)).toBe(false);
  });

  it('keeps sampled directions outside the radius-expanded blocked area', () => {
    const obstacle = { x: 50, y: 20, width: 20, height: 60 };
    const clearance = 4;
    const field = new FlowField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, [obstacle], clearance);
    const direction = { x: 0, y: 0 };
    for (let y = 5; y < 100; y += 5) {
      for (let x = 5; x < 120; x += 5) {
        if (field.isBlockedAt(x, y) || !field.sampleDirection(x, y, direction)) continue;
        expect(segmentDistanceSquaredToRect(
          x,
          y,
          x + direction.x * 8,
          y + direction.y * 8,
          obstacle,
        )).toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
      }
    }
  });

  it('rejects a bilinear direction whose exact look-ahead crosses clearance geometry', () => {
    const obstacle = { x: 50, y: 20, width: 20, height: 60 };
    const clearance = 4;
    const field = new FlowField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, [obstacle], clearance);
    const direction = { x: 0, y: 0 };
    const startX = 63.5;
    const startY = 15.7;

    field.sampleDirection(startX, startY, direction);

    expect(segmentDistanceSquaredToRect(
      startX,
      startY,
      startX + direction.x * 8,
      startY + direction.y * 8,
      obstacle,
    )).toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
  });
});
