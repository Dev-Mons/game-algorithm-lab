import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('crowd simulation', () => {
  it('is deterministic for the same seed and configuration', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 98765 };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('runs 1000 agents without NaN, Infinity, or invalid active state', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1000 }, getScenario('obstacle-field'));
    for (let step = 0; step < 240; step += 1) simulation.step();
    for (let i = 0; i < simulation.state.count; i += 1) {
      expect(Number.isFinite(simulation.state.x[i])).toBe(true);
      expect(Number.isFinite(simulation.state.y[i])).toBe(true);
      expect(Number.isFinite(simulation.state.vx[i])).toBe(true);
      expect(Number.isFinite(simulation.state.vy[i])).toBe(true);
      expect(simulation.state.active[i] === 0 || simulation.state.active[i] === 1).toBe(true);
    }
    expect(simulation.metrics.candidateChecks).toBeLessThan(1000 * 999);
    expect(simulation.stateHash()).toMatch(/^[0-9a-f]{8}$/);
  });

  it.each(['open-field', 'obstacle-field'])('moves the crowd through %s to the goal', (scenarioId) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1000 }, getScenario(scenarioId));
    for (let step = 0; step < (scenarioId === 'obstacle-field' ? 3600 : 1800); step += 1) simulation.step();
    expect(simulation.metrics.arrivalRate).toBeGreaterThan(0.95);
    expect(simulation.metrics.activeCount + simulation.metrics.arrivedCount).toBe(1000);
  });
});
