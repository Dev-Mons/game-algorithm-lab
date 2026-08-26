import { describe, expect, it } from 'vitest';
import { clamp, distanceSquared, limit, normalize } from '../../src/core/math';

describe('vector and math utilities', () => {
  it('normalizes vectors and handles zero safely', () => {
    const out = { x: 0, y: 0 };
    normalize(3, 4, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
    normalize(0, 0, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('limits magnitude without changing short vectors', () => {
    const out = { x: 0, y: 0 };
    limit(6, 8, 5, out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(5);
    limit(1, 2, 5, out);
    expect(out).toEqual({ x: 1, y: 2 });
  });

  it('clamps and computes squared distances', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(distanceSquared(1, 1, 4, 5)).toBe(25);
  });
});
