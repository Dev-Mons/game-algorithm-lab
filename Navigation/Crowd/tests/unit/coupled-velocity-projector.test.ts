import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CoupledVelocityProjector } from '../../src/algorithms/steering/coupled-velocity-projector';

function pair(distance: number): {
  current: AgentBuffer;
  active: Uint8Array;
  neighborOffsets: Int32Array;
  neighborIndices: Int32Array;
} {
  const current = new AgentBuffer(2);
  current.x.set([10, 10 + distance]);
  current.y.set([20, 20]);
  current.active.fill(1);
  return {
    current,
    active: new Uint8Array([1, 1]),
    neighborOffsets: new Int32Array([0, 1, 2]),
    neighborIndices: new Int32Array([1, 0]),
  };
}

describe('CoupledVelocityProjector', () => {
  it('splits an endpoint conflict symmetrically inside speed and acceleration disks', () => {
    const input = pair(6.5);
    const velocityX = new Float64Array([4, -4]);
    const velocityY = new Float64Array(2);
    const result = new CoupledVelocityProjector().solve({
      ...input,
      velocityX,
      velocityY,
      agentRadius: 3.2,
      fixedDelta: 0.1,
      maxAcceleration: 100,
      maxSpeed: 8,
      iterations: 8,
      separationSkin: 0.001,
    });

    const endDistance = input.current.x[1]! + velocityX[1]! * 0.1
      - input.current.x[0]! - velocityX[0]! * 0.1;
    expect(endDistance).toBeGreaterThanOrEqual(6.401 - 1e-6);
    expect(velocityX[0]! + velocityX[1]!).toBeCloseTo(0, 10);
    expect(Math.hypot(velocityX[0]!, velocityY[0]!)).toBeLessThanOrEqual(8 + 1e-9);
    expect(Math.hypot(velocityX[1]!, velocityY[1]!)).toBeLessThanOrEqual(8 + 1e-9);
    expect(result.correctedAgents).toBe(2);
    expect(result.remainingOverlapPairs).toBe(0);
  });

  it('reports an infeasible pair instead of leaving the acceleration-reachable set', () => {
    const input = pair(6.41);
    input.current.vx.set([4, -4]);
    const velocityX = new Float64Array([4, -4]);
    const velocityY = new Float64Array(2);
    const maximumDelta = 0.1;
    const result = new CoupledVelocityProjector().solve({
      ...input,
      velocityX,
      velocityY,
      agentRadius: 3.2,
      fixedDelta: 0.1,
      maxAcceleration: 1,
      maxSpeed: 8,
      iterations: 8,
      separationSkin: 0.001,
    });

    expect(Math.abs(velocityX[0]! - input.current.vx[0]!)).toBeLessThanOrEqual(maximumDelta + 1e-9);
    expect(Math.abs(velocityX[1]! - input.current.vx[1]!)).toBeLessThanOrEqual(maximumDelta + 1e-9);
    expect(result.remainingOverlapPairs).toBe(1);
  });

  it('produces the same result for repeated runs', () => {
    const run = (): { x: number[]; y: number[]; remaining: number } => {
      const input = pair(6.6);
      const velocityX = new Float64Array([5, -3]);
      const velocityY = new Float64Array([1, -1]);
      const result = new CoupledVelocityProjector().solve({
        ...input,
        velocityX,
        velocityY,
        agentRadius: 3.2,
        fixedDelta: 0.1,
        maxAcceleration: 100,
        maxSpeed: 8,
        iterations: 8,
        separationSkin: 0.2,
        timeHorizon: 0.4,
      });
      return { x: [...velocityX], y: [...velocityY], remaining: result.remainingOverlapPairs };
    };

    expect(run()).toEqual(run());
  });
});
