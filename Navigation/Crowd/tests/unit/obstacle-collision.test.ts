import { describe, expect, it } from 'vitest';
import {
  circleOverlapsRect,
  distanceSquaredToRect,
  projectCircleOutsideRect,
  projectCircleOutsideRectWithinBounds,
  segmentDistanceSquaredToRect,
  SweptCircleStaticIntegrator,
  type SweptCircleSlideOutput,
} from '../../src/core/obstacle-collision';

function createSweepOutput(): SweptCircleSlideOutput {
  return {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    normalX: 0,
    normalY: 0,
    contactCount: 0,
    startedOverlapping: false,
    exhausted: false,
  };
}

describe('circle and rectangle obstacle collision', () => {
  const obstacle = { x: 40, y: 30, width: 20, height: 40 };

  it('projects a circle to the nearest valid point and returns the wall normal', () => {
    const output = { x: 0, y: 0, normalX: 0, normalY: 0 };
    expect(projectCircleOutsideRect(39, 50, 4, obstacle, output)).toBe(true);
    expect(output).toEqual({ x: 36, y: 50, normalX: -1, normalY: 0 });
    expect(circleOverlapsRect(output.x, output.y, 4, obstacle)).toBe(false);
    expect(distanceSquaredToRect(output.x, output.y, obstacle)).toBeCloseTo(16);
  });

  it('detects a swept circle path near a rectangle corner', () => {
    expect(segmentDistanceSquaredToRect(30, 20, 45, 27, obstacle)).toBeLessThan(4 * 4);
    expect(segmentDistanceSquaredToRect(20, 10, 30, 15, obstacle)).toBeGreaterThan(4 * 4);
  });

  it('chooses an in-bounds escape for an obstacle attached to the world edge', () => {
    const output = { x: 0, y: 0, normalX: 0, normalY: 0 };
    const edgeObstacle = { x: 0, y: 0, width: 100, height: 30 };
    expect(projectCircleOutsideRectWithinBounds(50, 10, 4, edgeObstacle, 100, 100, output)).toBe(true);
    expect(output).toEqual({ x: 50, y: 34, normalX: 0, normalY: 1 });
  });

  it('reports failure when every projected escape lies outside the world bounds', () => {
    const output = { x: 0, y: 0, normalX: 0, normalY: 0 };
    const worldFillingObstacle = { x: 0, y: 0, width: 100, height: 100 };

    expect(
      projectCircleOutsideRectWithinBounds(
        50,
        50,
        4,
        worldFillingObstacle,
        100,
        100,
        output,
      ),
    ).toBe(false);
  });

  describe('continuous swept-circle integration', () => {
    const integrator = new SweptCircleStaticIntegrator();

    it('preserves position integration and velocity when there is no contact', () => {
      const output = createSweepOutput();

      integrator.integrate(10, 10, 12, 5, 0.5, 2, 100, 100, [], 4, output);

      expect(output).toEqual({
        x: 16,
        y: 12.5,
        velocityX: 12,
        velocityY: 5,
        normalX: 0,
        normalY: 0,
        contactCount: 0,
        startedOverlapping: false,
        exhausted: false,
      });
    });

    it('advances to a face TOI and spends only the remaining time sliding', () => {
      const output = createSweepOutput();

      integrator.integrate(30, 40, 20, 10, 1, 4, 100, 100, [obstacle], 4, output);

      expect(output.x).toBeCloseTo(36, 10);
      expect(output.y).toBeCloseTo(50, 10);
      expect(output.velocityX).toBeCloseTo(0, 10);
      expect(output.velocityY).toBeCloseTo(10, 10);
      expect(output.normalX).toBe(-1);
      expect(output.normalY).toBe(0);
      expect(output.contactCount).toBe(1);
      expect(circleOverlapsRect(output.x, output.y, 4, obstacle)).toBe(false);
    });

    it('detects a rounded-corner chord even when both raw endpoints are clear', () => {
      const output = createSweepOutput();
      const startX = 35;
      const startY = 29.5;
      const velocityX = 4.5;
      const velocityY = -4.5;
      expect(circleOverlapsRect(startX, startY, 4, obstacle)).toBe(false);
      expect(circleOverlapsRect(startX + velocityX, startY + velocityY, 4, obstacle)).toBe(false);

      integrator.integrate(
        startX,
        startY,
        velocityX,
        velocityY,
        1,
        4,
        100,
        100,
        [obstacle],
        4,
        output,
      );

      expect(output.contactCount).toBe(1);
      expect(output.x).not.toBeCloseTo(startX + velocityX, 6);
      expect(output.y).not.toBeCloseTo(startY + velocityY, 6);
      expect(circleOverlapsRect(output.x, output.y, 4, obstacle)).toBe(false);
      expect(output.velocityX * output.normalX + output.velocityY * output.normalY).toBeCloseTo(0, 9);
      expect(Math.hypot(output.velocityX, output.velocityY))
        .toBeLessThanOrEqual(Math.hypot(velocityX, velocityY) + 1e-10);
    });

    it('resolves simultaneous world-corner contacts deterministically', () => {
      const first = createSweepOutput();
      const second = createSweepOutput();

      integrator.integrate(5, 5, -10, -10, 1, 2, 100, 100, [], 4, first);
      integrator.integrate(5, 5, -10, -10, 1, 2, 100, 100, [], 4, second);

      expect(first).toEqual(second);
      expect(first.x).toBeCloseTo(2, 10);
      expect(first.y).toBeCloseTo(2, 10);
      expect(first.velocityX).toBe(0);
      expect(first.velocityY).toBe(0);
      expect(first.contactCount).toBe(2);
      expect(first.exhausted).toBe(false);
    });

    it('allows an exact tangent to leave contact without a false collision', () => {
      const output = createSweepOutput();

      integrator.integrate(36, 30, 0, -10, 1, 4, 100, 100, [obstacle], 4, output);

      expect(output.x).toBeCloseTo(36, 10);
      expect(output.y).toBeCloseTo(20, 10);
      expect(output.velocityX).toBe(0);
      expect(output.velocityY).toBe(-10);
      expect(output.contactCount).toBe(0);
    });

    it('does not teleport an inherited invalid start', () => {
      const output = createSweepOutput();

      integrator.integrate(41, 50, 10, 0, 1, 4, 100, 100, [obstacle], 4, output);

      expect(output.x).toBe(41);
      expect(output.y).toBe(50);
      expect(output.velocityX).toBe(0);
      expect(output.velocityY).toBe(0);
      expect(output.startedOverlapping).toBe(true);
      expect(output.contactCount).toBe(0);
    });
  });
});
