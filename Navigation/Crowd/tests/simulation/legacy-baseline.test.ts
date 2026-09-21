import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

// Rebased on 2026-09-21 for actual movement turn limiting and persistent heading
// in the hash. The former immediate reverse-momentum cancellation was removed.
// These hashes protect the legacy solver's command and reset lifecycle.
const BASELINES = [
  { name: 'open', scenario: 'open-field', largeAgentPercent: 0,
    initial: '876a2f74', step120: '448364e5', command: 'fffe126b', command60: '0b31610d' },
  { name: 'corners', scenario: 'winding-corners', largeAgentPercent: 0,
    initial: '20137ce9', step120: '99f07002', command: 'dc44afed', command60: '99a9ea37' },
  { name: 'mixed sizes at corners', scenario: 'winding-corners', largeAgentPercent: 5,
    initial: '805de773', step120: '77fdca79', command: '4f7fdfce', command60: '298d8f68' },
] as const;

describe('legacy movement-turn baseline', () => {
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
