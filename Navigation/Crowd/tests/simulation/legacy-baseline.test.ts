import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

// Captured from the one-time imported original working state on 2026-09-20,
// before the lab pipeline changed movement behavior. These hashes protect the
// explicit legacy preset, including its command and reset lifecycle.
const BASELINES = [
  { name: 'open', scenario: 'open-field', largeAgentPercent: 0,
    initial: '3bad1e40', step120: '33ed01ec', command: 'bc828a5f', command60: 'cec864c2' },
  { name: 'corners', scenario: 'winding-corners', largeAgentPercent: 0,
    initial: '410c87fb', step120: '267e8323', command: 'ae100ec9', command60: '92a461e7' },
  { name: 'mixed sizes at corners', scenario: 'winding-corners', largeAgentPercent: 5,
    initial: '62e883bf', step120: '0864dd62', command: '54d6d844', command60: '8f24e72a' },
] as const;

describe('imported legacy baseline', () => {
  it.each(BASELINES)('preserves $name movement, re-command and reset', (baseline) => {
    const simulation = new CrowdSimulation({
      ...DEFAULT_CONFIG,
      preset: 'legacy',
      agentCount: 120,
      seed: 42,
      largeAgentPercent: baseline.largeAgentPercent,
      largeAgentScale: 2,
    }, getScenario(baseline.scenario));
    expect(simulation.state.count).toBe(120);
    expect(simulation.largeAgentCount).toBe(baseline.largeAgentPercent === 5 ? 6 : 0);
    expect(simulation.stateHash()).toBe(baseline.initial);

    for (let step = 0; step < 120; step++) simulation.step();
    expect(simulation.stateHash()).toBe(baseline.step120);

    simulation.setGoal(100, 360);
    expect(simulation.stateHash()).toBe(baseline.command);
    for (let step = 0; step < 60; step++) simulation.step();
    expect(simulation.stateHash()).toBe(baseline.command60);

    simulation.reset();
    expect(simulation.stateHash()).toBe(baseline.initial);
    for (let step = 0; step < 120; step++) simulation.step();
    expect(simulation.stateHash()).toBe(baseline.step120);
  });
});
