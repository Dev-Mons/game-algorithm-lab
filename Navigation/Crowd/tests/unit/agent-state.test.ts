import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';
import { angleDelta } from '../../src/core/math';

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
    source.heading.set([0.4, -2.9]);

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
    expect([...target.heading]).toEqual([...source.heading]);
  });

  it('turns across the angle seam at a bounded speed without snapping on commands', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1, turnSpeed: 60, maxSpeed: 0 },
      getScenario('open-field'),
    );
    const degrees = Math.PI / 180;
    simulation.state.x[0] = 600;
    simulation.state.y[0] = 360;
    simulation.state.heading[0] = 179 * degrees;
    const target = -179 * degrees;
    simulation.setGoal(600 + 200 * Math.cos(target), 360 + 200 * Math.sin(target));
    expect(simulation.state.heading[0]).toBe(179 * degrees);

    simulation.step();
    expect(angleDelta(179 * degrees, simulation.state.heading[0]!)).toBeCloseTo(degrees, 10);
    simulation.step();
    expect(angleDelta(simulation.state.heading[0]!, target)).toBeCloseTo(0, 10);
    simulation.step();
    expect(angleDelta(simulation.state.heading[0]!, target)).toBeCloseTo(0, 10);

    simulation.config.turnSpeed = 0;
    const frozen = simulation.state.heading[0]!;
    simulation.setGoal(1000, 360);
    simulation.step();
    expect(simulation.state.heading[0]).toBe(frozen);
    simulation.reset();
    expect(simulation.state.heading[0]).toBe(simulation.previousState.heading[0]);
    expect(simulation.state.heading[0]).toBeCloseTo(Math.atan2(simulation.state.intentY[0]!, simulation.state.intentX[0]!), 10);
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

  it('includes movement heading in the deterministic state hash', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1 }, getScenario('open-field'));
    const before = simulation.stateHash();
    simulation.state.heading[0] = simulation.state.heading[0]! + 0.1;
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
