import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../src/algorithms/spatial-hash/spatial-hash';
import { distanceSquared } from '../../src/core/math';

describe('Uniform Grid Spatial Hash', () => {
  it('preserves descending IDs without dropping overflow and clears old chains on rebuild', () => {
    const x = new Float64Array(80).fill(55);
    const y = new Float64Array(80).fill(55);
    const active = new Uint8Array(80).fill(1);
    const hash = new SpatialHash(100, 100, 10, 80);
    const output = new Int32Array(100);
    const verify = (expected: number[]) => {
      const visited: number[] = [];
      hash.forEachCandidate(55, 55, 0, id => visited.push(id));
      expect(visited).toEqual(expected);
      expect(hash.populationAt(55, 55)).toBe(expected.length);
      for (const limit of [0, 1, 3, 4, 5, 24, 80, 100]) {
        output.fill(-7);
        const count = hash.queryCandidates(55, 55, 0, output, limit);
        expect([...output.slice(0, count)]).toEqual(expected.slice(0, limit));
        expect([...output.slice(count)]).toEqual(Array(100 - count).fill(-7));
        const bounded: number[] = [];
        hash.forEachCandidateUntil(55, 55, 0, id => {
          bounded.push(id);
          return bounded.length < Math.max(1, limit);
        });
        expect(bounded).toEqual(expected.slice(0, Math.max(1, limit)));
      }
    };
    hash.rebuild(x, y, active);
    verify(Array.from({ length: 80 }, (_, i) => 79 - i));
    // Retained packed views remain live, but normal queries need no packing.
    const starts = hash.cellStart, indices = hash.agentIndices;
    expect([...indices.slice(starts[55], starts[56])]).toEqual(Array.from({ length: 80 }, (_, i) => 79 - i));
    active.fill(0);
    for (const id of [1, 6, 22, 35, 71, 79]) active[id] = 1;
    x[79] = 65;
    hash.rebuild(x, y, active);
    verify([71, 35, 22, 6, 1]);
    expect(hash.cellStart).toBe(starts);
    expect(hash.agentIndices).toBe(indices);
    expect([...indices.slice(starts[55], starts[56])]).toEqual([71, 35, 22, 6, 1]);
    active.fill(0);
    hash.rebuild(x, y, active);
    verify([]);
    active[22] = 1;
    hash.rebuild(x, y, active);
    verify([22]);
  });

  it('matches independently sorted cell candidates across boundaries and crowded cells', () => {
    const count = 400;
    const x = Float64Array.from({ length: count }, (_, i) => i < 70 ? 55 : (i * 37) % 140 - 20);
    const y = Float64Array.from({ length: count }, (_, i) => i < 70 ? 55 : (i * 23) % 130 - 15);
    const active = Uint8Array.from({ length: count }, (_, i) => i % 7 === 0 ? 0 : 1);
    const hash = new SpatialHash(100, 100, 10, count);
    hash.rebuild(x, y, active);
    const cell = (value: number) => Math.max(0, Math.min(9, Math.floor(value / 10)));
    for (const [px, py, radius] of [[55, 55, 35], [0, 0, 24], [100, 100, 40], [35, 65, 60]]) {
      const minX = Math.max(0, Math.floor((px! - radius!) / 10));
      const maxX = Math.min(9, Math.floor((px! + radius!) / 10));
      const minY = Math.max(0, Math.floor((py! - radius!) / 10));
      const maxY = Math.min(9, Math.floor((py! + radius!) / 10));
      const cx = Math.max(minX, Math.min(maxX, Math.floor(px! / 10)));
      const cy = Math.max(minY, Math.min(maxY, Math.floor(py! / 10)));
      // Independent ordering key: ring, top/bottom edge, then alternating sides.
      const rank = (id: number) => {
        const col = cell(x[id]!), row = cell(y[id]!);
        const ring = Math.max(Math.abs(col - cx), Math.abs(row - cy));
        const edge = row === cy - ring ? 0 : row === cy + ring ? 1 : 2;
        const position = edge < 2 ? col : row * 2 + (col > cx ? 1 : 0);
        return [ring, edge, position];
      };
      const expected = Array.from({ length: count }, (_, id) => id).filter(id => active[id]
        && cell(x[id]!) >= minX && cell(x[id]!) <= maxX && cell(y[id]!) >= minY && cell(y[id]!) <= maxY);
      expected.sort((a, b) => {
        const ka = rank(a), kb = rank(b);
        return ka[0]! - kb[0]! || ka[1]! - kb[1]! || ka[2]! - kb[2]! || b - a;
      });
      for (const limit of [1, 4, 24, 256, 400]) {
        const output = new Int32Array(limit);
        const written = hash.queryCandidates(px!, py!, radius!, output);
        expect([...output.slice(0, written)]).toEqual(expected.slice(0, limit));
      }
    }
  });

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

  it('writes bounded candidates in the same order as callback traversal', () => {
    const x = new Float64Array([5, 55, 52, 61, 88]);
    const y = new Float64Array([5, 55, 53, 59, 88]);
    const active = new Uint8Array([1, 1, 1, 1, 1]);
    const hash = new SpatialHash(100, 100, 10, x.length);
    hash.rebuild(x, y, active);
    const callbackCandidates: number[] = [];
    hash.forEachCandidateUntil(55, 55, 60, (candidate) => {
      callbackCandidates.push(candidate);
      return callbackCandidates.length < 3;
    });
    const output = new Int32Array(3);
    const count = hash.queryCandidates(55, 55, 60, output, 3);

    expect(count).toBe(3);
    expect(Array.from(output)).toEqual(callbackCandidates);
  });
});
