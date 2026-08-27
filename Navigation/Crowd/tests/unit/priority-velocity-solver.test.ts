import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { PriorityVelocitySolver } from '../../src/core/priority-velocity-solver';

function completeNeighborCache(count: number): {
  offsets: Int32Array;
  indices: Int32Array;
} {
  const offsets = new Int32Array(count + 1);
  const indices = new Int32Array(count * Math.max(0, count - 1));
  let cursor = 0;
  for (let agent = 0; agent < count; agent += 1) {
    offsets[agent] = cursor;
    for (let other = 0; other < count; other += 1) {
      if (other === agent) continue;
      indices[cursor] = other;
      cursor += 1;
    }
  }
  offsets[count] = cursor;
  return { offsets, indices };
}

function lineBuffers(positions: readonly number[]): {
  current: AgentBuffer;
  next: AgentBuffer;
} {
  const current = new AgentBuffer(positions.length);
  for (let agent = 0; agent < positions.length; agent += 1) {
    current.x[agent] = positions[agent]!;
    current.y[agent] = 20;
    current.active[agent] = 1;
  }
  const next = new AgentBuffer(positions.length);
  next.copyFrom(current);
  return { current, next };
}

describe('PriorityVelocitySolver', () => {
  it('uses physical stream order even when global route costs are locally reversed', () => {
    const { current, next } = lineBuffers([10, 5]);
    next.x[0] = 11;
    next.x[1] = 8;
    const neighbors = completeNeighborCache(2);

    const result = new PriorityVelocitySolver().solve({
      current,
      next,
      active: current.active,
      preferredDirectionX: new Float64Array([1, 1]),
      preferredDirectionY: new Float64Array(2),
      // Deliberately wrong for this local pair: geometry must still win.
      routeCost: new Float64Array([100, 0]),
      neighborOffsets: neighbors.offsets,
      neighborIndices: neighbors.indices,
      agentRadius: 2,
      fixedDelta: 1,
    });

    expect(next.x[0]).toBe(11);
    expect(next.y[0]).toBe(20);
    expect(next.x[1]).toBeGreaterThanOrEqual(current.x[1]!);
    expect(next.x[1]).toBeLessThan(7);
    expect(next.y[1]).toBe(20);
    expect(next.x[0]! - next.x[1]!).toBeGreaterThanOrEqual(4);
    expect(result.limitedAgents).toBe(1);
    expect(result.remainingOverlapPairs).toBe(0);
  });

  it('propagates braking through a queue without pushing any endpoint', () => {
    const { current, next } = lineBuffers([12, 7, 2]);
    next.x.set([12, 10, 5]);
    next.vx.set([0, 3, 3]);
    const originalVelocity = [...next.vx];
    const proposal = [...next.x];
    const neighbors = completeNeighborCache(3);

    const result = new PriorityVelocitySolver().solve({
      current,
      next,
      active: current.active,
      preferredDirectionX: new Float64Array([1, 1, 1]),
      preferredDirectionY: new Float64Array(3),
      routeCost: new Float64Array([0, 5, 10]),
      neighborOffsets: neighbors.offsets,
      neighborIndices: neighbors.indices,
      agentRadius: 2,
      fixedDelta: 1,
    });

    expect(next.x[0]).toBe(proposal[0]);
    for (let agent = 0; agent < current.count; agent += 1) {
      expect(next.x[agent]).toBeGreaterThanOrEqual(current.x[agent]!);
      expect(next.x[agent]).toBeLessThanOrEqual(proposal[agent]!);
      expect(next.y[agent]).toBe(current.y[agent]);
    }
    expect(next.x[0]! - next.x[1]!).toBeGreaterThanOrEqual(4);
    expect(next.x[1]! - next.x[2]!).toBeGreaterThanOrEqual(4);
    expect([...next.vx]).toEqual(originalVelocity);
    expect(result.limitedAgents).toBe(2);
    expect(result.remainingOverlapPairs).toBe(0);
  });
});
