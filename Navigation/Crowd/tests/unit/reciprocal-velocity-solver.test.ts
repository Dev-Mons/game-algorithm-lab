import { describe, expect, it } from 'vitest';
import { ReciprocalVelocitySolver } from '../../src/algorithms/steering/reciprocal-velocity-solver';
import { AgentBuffer } from '../../src/core/agent-state';

function solveFollowingPair(): {
  current: AgentBuffer;
  outputX: Float64Array;
  outputY: Float64Array;
  result: ReturnType<ReciprocalVelocitySolver['solve']>;
} {
  const current = new AgentBuffer(2);
  current.active.fill(1);
  current.x.set([0, 5]);
  current.vx.set([4, 4]);
  const outputX = new Float64Array(2);
  const outputY = new Float64Array(2);
  const result = new ReciprocalVelocitySolver().solve({
    current,
    active: current.active,
    preferredVelocityX: new Float64Array([8, 2]),
    preferredVelocityY: new Float64Array(2),
    neighborOffsets: new Int32Array([0, 1, 2]),
    neighborIndices: new Int32Array([1, 0]),
    agentRadius: 2,
    separationPadding: 0,
    maxSpeed: 10,
    maxAcceleration: 10,
    fixedDelta: 0.1,
    timeHorizon: 2,
    outputVelocityX: outputX,
    outputVelocityY: outputY,
  });
  return { current, outputX, outputY, result };
}

describe('ReciprocalVelocitySolver', () => {
  it('solves following constraints inside the acceleration-centred velocity disk', () => {
    const first = solveFollowingPair();
    const second = solveFollowingPair();

    for (let agent = 0; agent < first.current.count; agent += 1) {
      const velocityDelta = Math.hypot(
        first.outputX[agent]! - first.current.vx[agent]!,
        first.outputY[agent]! - first.current.vy[agent]!,
      );
      expect(velocityDelta).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(first.outputX[0]).toBeLessThan(5);
    expect(first.outputX[1]).toBeGreaterThan(3);
    expect([...first.outputX]).toEqual([...second.outputX]);
    expect([...first.outputY]).toEqual([...second.outputY]);
    expect(first.result.constraintCount).toBe(2);
    expect(first.result.projectionRepairAgents).toBe(0);
  });
});
