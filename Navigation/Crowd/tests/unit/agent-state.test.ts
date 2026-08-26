import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('persistent agent movement state', () => {
  it('copies every steering and smoothness field between state buffers', () => {
    const source = new AgentBuffer(2);
    source.intentX.set([0.25, -0.75]);
    source.intentY.set([0.5, 0.125]);
    source.accelerationX.set([10, 20]);
    source.accelerationY.set([-3, 4]);
    source.adjacentStoppedFor.set([0.5, 1.25]);
    source.motionPhase.set([1, 2]);
    source.avoidanceSide.set([-1, 1]);
    source.avoidanceHold.set([0.2, 0.8]);

    const target = new AgentBuffer(2);
    target.copyFrom(source);

    expect([...target.intentX]).toEqual([...source.intentX]);
    expect([...target.intentY]).toEqual([...source.intentY]);
    expect([...target.accelerationX]).toEqual([...source.accelerationX]);
    expect([...target.accelerationY]).toEqual([...source.accelerationY]);
    expect([...target.adjacentStoppedFor]).toEqual([...source.adjacentStoppedFor]);
    expect([...target.motionPhase]).toEqual([...source.motionPhase]);
    expect([...target.avoidanceSide]).toEqual([...source.avoidanceSide]);
    expect([...target.avoidanceHold]).toEqual([...source.avoidanceHold]);
  });

  it('includes persistent steering intent in the deterministic state hash', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 4 },
      getScenario('open-field'),
    );
    const before = simulation.stateHash();
    simulation.state.intentX[0] = 0.125;
    expect(simulation.stateHash()).not.toBe(before);
  });

  it('includes accumulated stall time in the deterministic state hash', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 4 },
      getScenario('open-field'),
    );
    const before = simulation.stateHash();

    simulation.state.stalledFor[0] = 1.25;

    expect(simulation.stateHash()).not.toBe(before);
  });
});
