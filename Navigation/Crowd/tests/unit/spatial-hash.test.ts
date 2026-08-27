import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../src/algorithms/spatial-hash/spatial-hash';
import { distanceSquared } from '../../src/core/math';

describe('Uniform Grid Spatial Hash', () => {
  it('does not miss any active neighbor inside the query radius', () => {
    const x = new Float64Array([10, 18, 31, 49, 15, 80]);
    const y = new Float64Array([10, 12, 10, 45, 25, 80]);
    const active = new Uint8Array([1, 1, 1, 1, 0, 1]);
    const hash = new SpatialHash(100, 100, 16, x.length);
    hash.rebuild(x, y, active);
    const radius = 24;
    const candidates = new Set<number>();
    hash.forEachCandidate(x[0]!, y[0]!, radius, (index) => candidates.add(index));
    for (let i = 0; i < x.length; i += 1) {
      if (active[i] === 1 && distanceSquared(x[0]!, y[0]!, x[i]!, y[i]!) <= radius * radius) {
        expect(candidates.has(i)).toBe(true);
      }
    }
    expect(candidates.has(4)).toBe(false);
  });

  it('visits the query cell before distant AABB corners in a bounded query', () => {
    const x = new Float64Array([5, 55, 52]);
    const y = new Float64Array([5, 55, 53]);
    const active = new Uint8Array([1, 1, 1]);
    const hash = new SpatialHash(100, 100, 10, x.length);
    hash.rebuild(x, y, active);
    let firstCandidate = -1;

    hash.forEachCandidateUntil(55, 55, 60, (candidate) => {
      firstCandidate = candidate;
      return false;
    });

    expect(firstCandidate).toBe(2);
  });
});
