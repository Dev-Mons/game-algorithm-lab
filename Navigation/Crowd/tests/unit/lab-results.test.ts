import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { auditGeometry, distribution } from '../../src/core/lab-results';
import type { CrowdSimulation } from '../../src/core/simulation';

function fixture(count: number, retained = false): CrowdSimulation {
  const state = new AgentBuffer(count);
  const previousState = new AgentBuffer(count);
  state.x.fill(50);
  state.y.fill(50);
  state.active.fill(1);
  previousState.copyFrom(state);
  // Deliberately no solver neighbor list: the audit owns its spatial search.
  return {
    state, previousState,
    config: { width: 100, height: 100, wallMargin: 0 },
    agentRadii: new Float64Array(count).fill(2), maxAgentRadius: 2,
    scenario: { obstacles: [] },
    resolvedExperiment: { preset: { id: retained ? 'R' : 'B1' }, options: { destination: retained ? 'slots' : 'exit' } },
  } as unknown as CrowdSimulation;
}

describe('independent lab measurement', () => {
  it('audits all overlapping pairs beyond the local solver neighbor budget', () => {
    const simulation = fixture(32);
    const result = auditGeometry(simulation);
    expect(result.pairs).toBe(32 * 31 / 2);
    expect(result.checks).toBe(32 * 31 / 2);
    expect(result.maxPenetration).toBe(4);
  });

  it('detects swept chord tunneling with disjoint endpoint circles', () => {
    const simulation = fixture(2);
    simulation.previousState.x.set([40, 60]);
    simulation.state.x.set([60, 40]);
    const result = auditGeometry(simulation);
    expect(result.pairs).toBe(0);
    expect(result.tunnelingPairs).toBe(1);
    expect(result.maxSweptPenetration).toBe(4);
  });

  it('does not confuse parallel motion with crossing trajectories', () => {
    const simulation = fixture(2);
    simulation.previousState.x.set([30, 40]);
    simulation.state.x.set([50, 60]);
    const result = auditGeometry(simulation);
    expect(result.pairs).toBe(0);
    expect(result.tunnelingPairs).toBe(0);
  });

  it('keeps inactive retained arrivals in contact and wall audits', () => {
    const simulation = fixture(2, true);
    simulation.state.active.fill(0);
    simulation.previousState.active.fill(0);
    simulation.state.x[0] = 1;
    simulation.state.x[1] = 3;
    simulation.previousState.copyFrom(simulation.state);
    const result = auditGeometry(simulation);
    expect(result.pairs).toBe(1);
    expect(result.walls).toBe(1);

    simulation.resolvedExperiment.options.destination = 'exit';
    const removed = auditGeometry(simulation);
    expect(removed.pairs).toBe(0);
    expect(removed.walls).toBe(0);
  });

  it('includes an exit removed this tick in the transition audit', () => {
    const simulation = fixture(2);
    simulation.state.active.fill(0);
    expect(auditGeometry(simulation).pairs).toBe(1);
  });

  it('reports distribution sample counts and does not mutate measurements', () => {
    const values = [100, 1, 2, 3];
    expect(distribution(values)).toEqual({ samples: 4, mean: 26.5, p50: 3, p95: 100, p99: 100, max: 100 });
    expect(values).toEqual([100, 1, 2, 3]);
    expect(distribution([])).toEqual({ samples: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});
