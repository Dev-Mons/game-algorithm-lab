import { describe, expect, it } from 'vitest';
import { StaticObstacleIndex } from '../../src/core/static-obstacle-index';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';
import type { Rect } from '../../src/core/types';

describe('static obstacle broad phase', () => {
  const rectangles: Rect[] = Array.from({ length: 48 }, (_, i) => ({
    x: (i % 8) * 43 - 40, y: Math.floor(i / 8) * 37 - 20,
    width: 7 + i % 17, height: 3 + i % 23,
  }));

  it('returns ordered, unique candidates covering every exact segment collision', () => {
    const index = new StaticObstacleIndex();
    index.update(rectangles);
    let seed = 42;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let sample = 0; sample < 600; sample++) {
      const x = random() * 450 - 75, y = random() * 320 - 60;
      const endX = sample % 3 === 0 ? x : random() * 450 - 75;
      const endY = sample % 5 === 0 ? y : random() * 320 - 60;
      const radius = sample % 4 === 0 ? 0 : random() * 32;
      const candidates = [...index.querySegment(x, y, endX, endY, radius)];
      expect(candidates).toEqual([...new Set(candidates)].sort((a, b) => a - b));
      rectangles.forEach((rect, i) => {
        if (segmentDistanceSquaredToRect(x, y, endX, endY, rect) <= radius ** 2 + 1e-12) {
          expect(candidates).toContain(i);
        }
      });
    }
    const r = rectangles[0]!;
    expect(index.querySegment(r.x - 10, r.y - 1e-7, r.x + r.width + 10, r.y - 1e-7, 0)).toContain(0);
  });

  it('handles inclusive AABB boundaries, rejects distant terrain and detects in-place edits', () => {
    const walls = structuredClone(rectangles);
    const index = new StaticObstacleIndex();
    index.update(walls);
    expect(index.query(-40, -20, -40, -20)).toContain(0);
    expect(index.query(1000, 1000, 1001, 1001)).toEqual([]);
    walls[0]!.x = 1000; walls[0]!.y = 1000;
    index.update(walls);
    expect(index.query(1000, 1000, 1001, 1001)).toEqual([0]);
    index.update([]);
    expect(index.query(0, 0, 2000, 2000)).toEqual([]);
    index.update(walls);
    expect(index.querySegment(999, 1000, 1001, 1000, 0)).toEqual([0]);
  });
});
