import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('agent movement state', () => {
  it('copies every field between fixed-size state buffers', () => {
    const source = new AgentBuffer(2);
    source.x.set([10, 20]);
    source.y.set([30, 40]);
    source.vx.set([2, -4]);
    source.vy.set([3, 5]);
    source.active.set([1, 0]);
    source.stalledFor.set([0.5, 1.25]);
    source.intentX.set([0.25, -0.75]);
    source.intentY.set([0.5, 0.125]);

    const target = new AgentBuffer(2);
    target.copyFrom(source);

    expect([...target.x]).toEqual([...source.x]);
    expect([...target.y]).toEqual([...source.y]);
    expect([...target.vx]).toEqual([...source.vx]);
    expect([...target.vy]).toEqual([...source.vy]);
    expect([...target.active]).toEqual([...source.active]);
    expect([...target.stalledFor]).toEqual([...source.stalledFor]);
    expect([...target.intentX]).toEqual([...source.intentX]);
    expect([...target.intentY]).toEqual([...source.intentY]);
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
