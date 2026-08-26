import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../../src/algorithms/spatial-hash/spatial-hash';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdCollisionResolver } from '../../src/core/crowd-collision-resolver';
import type { Rect } from '../../src/core/types';

interface Point {
  x: number;
  y: number;
}

function buffers(points: readonly Point[]): { current: AgentBuffer; next: AgentBuffer } {
  const current = new AgentBuffer(points.length);
  for (let index = 0; index < points.length; index += 1) {
    current.x[index] = points[index]!.x;
    current.y[index] = points[index]!.y;
    current.active[index] = 1;
    current.avoidanceSide[index] = 1;
    current.vx[index] = index + 10;
    current.vy[index] = -(index + 20);
  }
  const next = new AgentBuffer(points.length);
  next.copyFrom(current);
  return { current, next };
}

function resolve(
  current: AgentBuffer,
  next: AgentBuffer,
  preferredX: Float64Array,
  preferredY: Float64Array,
  obstacles: readonly Rect[] = [],
  maxCorrectionPerFrame = 0.25,
): ReturnType<CrowdCollisionResolver['resolve']> {
  const spatialHash = new SpatialHash(120, 100, 8, next.count);
  return new CrowdCollisionResolver().resolve({
    current,
    next,
    preferredX,
    preferredY,
    agentRadius: 2,
    wallMargin: 0.2,
    worldWidth: 120,
    worldHeight: 100,
    obstacles,
    spatialHash,
    maxCorrectionPerFrame,
  });
}

describe('CrowdCollisionResolver', () => {
  it('fully prevents a newly proposed overlap without changing velocities or reversing progress', () => {
    const { current, next } = buffers([{ x: 40, y: 50 }, { x: 50, y: 50 }]);
    next.x[0] = 45.5;
    next.x[1] = 47;
    const originalVx = [...next.vx];
    const originalVy = [...next.vy];
    const result = resolve(
      current,
      next,
      new Float64Array([1, -1]),
      new Float64Array([0, 0]),
    );

    expect(Math.hypot(next.x[0]! - next.x[1]!, next.y[0]! - next.y[1]!)).toBeGreaterThanOrEqual(4 - 1e-9);
    expect((next.x[0]! - current.x[0]!) * 1).toBeGreaterThanOrEqual(0);
    expect((next.x[1]! - current.x[1]!) * -1).toBeGreaterThanOrEqual(0);
    expect([...next.vx]).toEqual(originalVx);
    expect([...next.vy]).toEqual(originalVy);
    expect(result.remainingOverlapPairs).toBe(0);
    expect(result.correctionCount).toBeGreaterThan(0);
  });

  it('projects a co-directional contact simultaneously without reverse progress', () => {
    const { current, next } = buffers([{ x: 45, y: 50 }, { x: 40, y: 50 }]);
    next.x[0] = 46;
    next.x[1] = 43;
    const originalVx = [...next.vx];
    const originalVy = [...next.vy];
    const result = resolve(
      current,
      next,
      new Float64Array([1, 1]),
      new Float64Array([0, 0]),
    );

    expect(next.x[0]).toBeGreaterThan(46);
    expect(next.x[1]).toBeLessThan(43);
    expect(next.x[0]! - current.x[0]!).toBeGreaterThanOrEqual(0);
    expect(next.x[1]! - current.x[1]!).toBeGreaterThanOrEqual(0);
    expect([...next.vx]).toEqual(originalVx);
    expect([...next.vy]).toEqual(originalVy);
    expect(Math.hypot(
      next.x[0]! - next.x[1]!,
      next.y[0]! - next.y[1]!,
    )).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(result.remainingOverlapPairs).toBe(0);
  });

  it('turns a final reverse endpoint into a deterministic stop', () => {
    const first = buffers([{ x: 50, y: 50 }]);
    const second = buffers([{ x: 50, y: 50 }]);
    first.next.x[0] = 49;
    first.next.y[0] = 51;
    second.next.x[0] = 49;
    second.next.y[0] = 51;
    const preferredX = new Float64Array([1]);
    const preferredY = new Float64Array([0]);

    const firstResult = resolve(first.current, first.next, preferredX, preferredY);
    const secondResult = resolve(second.current, second.next, preferredX, preferredY);

    expect(first.next.x[0]).toBe(first.current.x[0]);
    expect(first.next.y[0]).toBe(first.current.y[0]);
    expect([...first.next.x]).toEqual([...second.next.x]);
    expect([...first.next.y]).toEqual([...second.next.y]);
    expect(firstResult.remainingOverlapPairs).toBe(0);
    expect(firstResult.rollbackAgents).toBe(1);
    expect(secondResult.rollbackAgents).toBe(1);
  });

  it('keeps no-reverse when a rollback dependency touches an inherited overlap', () => {
    const { current, next } = buffers([
      { x: 10, y: 50 },
      { x: 14.5, y: 50 },
      { x: 14.5, y: 50 },
    ]);
    next.x[0] = 9;
    next.x[1] = 13;
    const inheritedDistanceBefore = Math.hypot(
      current.x[1]! - current.x[2]!,
      current.y[1]! - current.y[2]!,
    );

    const result = resolve(
      current,
      next,
      new Float64Array([1, 1, 1]),
      new Float64Array(3),
    );

    expect(next.x[0]! - current.x[0]!).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(
      next.x[1]! - next.x[2]!,
      next.y[1]! - next.y[2]!,
    )).toBeGreaterThanOrEqual(inheritedDistanceBefore);
    expect(result.rollbackAgents).toBeGreaterThanOrEqual(1);
  });

  it('uses a bounded deterministic opposite-side repair for coincident inherited overlap', () => {
    const first = buffers([{ x: 50, y: 50 }, { x: 50, y: 50 }]);
    const second = buffers([{ x: 50, y: 50 }, { x: 50, y: 50 }]);
    const preferredX = new Float64Array([1, 1]);
    const preferredY = new Float64Array([0, 0]);
    const firstResult = resolve(first.current, first.next, preferredX, preferredY);
    const secondResult = resolve(second.current, second.next, preferredX, preferredY);

    const repairedDistance = Math.hypot(
      first.next.x[0]! - first.next.x[1]!,
      first.next.y[0]! - first.next.y[1]!,
    );
    expect(repairedDistance).toBeGreaterThan(0);
    expect(repairedDistance).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(first.next.y[0]! - 50).toBeCloseTo(-(first.next.y[1]! - 50));
    expect([...first.next.x]).toEqual([...second.next.x]);
    expect([...first.next.y]).toEqual([...second.next.y]);
    expect(firstResult.remainingOverlapPairs).toBe(1);
    expect(secondResult.remainingOverlapPairs).toBe(1);
  });

  it('continues bounded inherited separation across frames without touching velocity', () => {
    const { current, next } = buffers([{ x: 50, y: 50 }, { x: 50, y: 50 }]);
    const preferredX = new Float64Array([1, 1]);
    const preferredY = new Float64Array([0, 0]);
    const originalVx = [...next.vx];
    const originalVy = [...next.vy];
    let previousDistance = 0;

    for (let frame = 0; frame < 10; frame += 1) {
      next.copyFrom(current);
      resolve(current, next, preferredX, preferredY, [], 0.25);
      const firstMovement = Math.hypot(
        next.x[0]! - current.x[0]!,
        next.y[0]! - current.y[0]!,
      );
      const secondMovement = Math.hypot(
        next.x[1]! - current.x[1]!,
        next.y[1]! - current.y[1]!,
      );
      const distance = Math.hypot(
        next.x[0]! - next.x[1]!,
        next.y[0]! - next.y[1]!,
      );
      expect(firstMovement).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(secondMovement).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(distance).toBeGreaterThanOrEqual(previousDistance - 1e-9);
      expect([...next.vx]).toEqual(originalVx);
      expect([...next.vy]).toEqual(originalVy);
      previousDistance = distance;
      current.copyFrom(next);
    }

    expect(previousDistance).toBeGreaterThanOrEqual(4 - 1e-9);
  });

  it('never nudges an exact obstacle-clearance endpoint into the obstacle', () => {
    const { current, next } = buffers([{ x: 45.8, y: 50 }, { x: 39.8, y: 50 }]);
    next.x[1] = 42.5;
    const obstacle = { x: 48, y: 40, width: 10, height: 20 };
    const result = resolve(
      current,
      next,
      new Float64Array([1, 1]),
      new Float64Array([0, 0]),
      [obstacle],
    );

    const closestObstacleX = Math.min(
      obstacle.x + obstacle.width,
      Math.max(obstacle.x, next.x[0]!),
    );
    const closestObstacleY = Math.min(
      obstacle.y + obstacle.height,
      Math.max(obstacle.y, next.y[0]!),
    );
    expect(next.x[0]).toBeLessThanOrEqual(45.8 + 1e-12);
    expect((next.x[0]! - closestObstacleX) ** 2 + (next.y[0]! - closestObstacleY) ** 2)
      .toBeGreaterThanOrEqual(2.2 ** 2 - 1e-12);
    expect(Math.hypot(next.x[0]! - next.x[1]!, next.y[0]! - next.y[1]!)).toBeGreaterThanOrEqual(4 - 1e-9);
    expect(result.remainingOverlapPairs).toBe(0);
  });

  it('resolves a four-disc contact chain deterministically without changing velocity', () => {
    const forward = { x: 0.96, y: -0.28 };
    const lateral = { x: 0.28, y: 0.96 };
    const longitudinalGap = 2.5;
    const middleGap = 4.01;
    const outerGap = 4.0001;
    const middleLateralGap = Math.sqrt(middleGap * middleGap - longitudinalGap * longitudinalGap);
    const middleStepX = forward.x * longitudinalGap - lateral.x * middleLateralGap;
    const middleStepY = forward.y * longitudinalGap - lateral.y * middleLateralGap;
    const blockerAngle = Math.PI / 18;
    const blockerStepX = outerGap * (
      Math.cos(blockerAngle) * forward.x + Math.sin(blockerAngle) * lateral.x
    );
    const blockerStepY = outerGap * (
      Math.cos(blockerAngle) * forward.y + Math.sin(blockerAngle) * lateral.y
    );
    const center = { x: 60, y: 55 };
    const points = [
      { x: center.x + blockerStepX, y: center.y + blockerStepY },
      center,
      { x: center.x + middleStepX, y: center.y + middleStepY },
      {
        x: center.x + middleStepX + forward.x * outerGap,
        y: center.y + middleStepY + forward.y * outerGap,
      },
    ];
    const makeProposal = (): { current: AgentBuffer; next: AgentBuffer } => {
      const pair = buffers(points);
      for (let index = 0; index < pair.next.count; index += 1) {
        pair.next.x[index] = pair.current.x[index]! + forward.x;
        pair.next.y[index] = pair.current.y[index]! + forward.y;
      }
      // The middle pair converges laterally while both outer gaps remain safe.
      for (const index of [0, 1]) {
        pair.next.x[index] = pair.next.x[index]! - lateral.x * 0.04;
        pair.next.y[index] = pair.next.y[index]! - lateral.y * 0.04;
      }
      for (const index of [2, 3]) {
        pair.next.x[index] = pair.next.x[index]! + lateral.x * 0.04;
        pair.next.y[index] = pair.next.y[index]! + lateral.y * 0.04;
      }
      return pair;
    };
    const first = makeProposal();
    const second = makeProposal();
    const proposedX = [...first.next.x];
    const proposedY = [...first.next.y];
    const originalVx = [...first.next.vx];
    const originalVy = [...first.next.vy];
    const preferredX = new Float64Array(4).fill(forward.x);
    const preferredY = new Float64Array(4).fill(forward.y);

    const firstResult = resolve(first.current, first.next, preferredX, preferredY);
    const secondResult = resolve(second.current, second.next, preferredX, preferredY);

    expect(firstResult.remainingOverlapPairs).toBe(0);
    expect(secondResult.remainingOverlapPairs).toBe(0);
    expect(firstResult.rollbackAgents).toBe(0);
    expect(secondResult.rollbackAgents).toBe(0);
    expect(firstResult.componentFallbackAgents).toBeGreaterThan(0);
    expect(secondResult.componentFallbackAgents).toBe(firstResult.componentFallbackAgents);
    expect([...first.next.vx]).toEqual(originalVx);
    expect([...first.next.vy]).toEqual(originalVy);
    expect([...first.next.x]).toEqual([...second.next.x]);
    expect([...first.next.y]).toEqual([...second.next.y]);
    let maximumCorrection = 0;
    for (let agent = 0; agent < first.next.count; agent += 1) {
      maximumCorrection = Math.max(maximumCorrection, Math.hypot(
        first.next.x[agent]! - proposedX[agent]!,
        first.next.y[agent]! - proposedY[agent]!,
      ));
      const frameProgress = (first.next.x[agent]! - first.current.x[agent]!) * forward.x
        + (first.next.y[agent]! - first.current.y[agent]!) * forward.y;
      expect(frameProgress).toBeGreaterThanOrEqual(-1e-9);
      for (let other = agent + 1; other < first.next.count; other += 1) {
        expect(Math.hypot(
          first.next.x[agent]! - first.next.x[other]!,
          first.next.y[agent]! - first.next.y[other]!,
        )).toBeGreaterThanOrEqual(4 - 1e-9);
      }
    }
    expect(maximumCorrection).toBeGreaterThan(0);
  });

  it('keeps a dense 1000-agent correction-skin pair list below the candidate budget', () => {
    const count = 1000;
    const columns = 40;
    const spacing = 4.25;
    const current = new AgentBuffer(count);
    const next = new AgentBuffer(count);
    for (let index = 0; index < count; index += 1) {
      current.x[index] = 6 + (index % columns) * spacing;
      current.y[index] = 6 + Math.floor(index / columns) * spacing;
      current.active[index] = 1;
    }
    next.copyFrom(current);
    const spatialHash = new SpatialHash(180, 120, 8, count);
    const result = new CrowdCollisionResolver().resolve({
      current,
      next,
      preferredX: new Float64Array(count).fill(1),
      preferredY: new Float64Array(count),
      agentRadius: 2,
      wallMargin: 0,
      worldWidth: 180,
      worldHeight: 120,
      obstacles: [],
      spatialHash,
    });

    expect(result.remainingOverlapPairs).toBe(0);
    expect(result.candidateChecks).toBeLessThan(300_000);
    expect(result.candidateChecks).toBeLessThan(count * count / 8);
  });
});
