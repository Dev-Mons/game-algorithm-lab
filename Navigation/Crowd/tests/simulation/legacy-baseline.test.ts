import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

// Rebased on 2026-09-26 for the intentionally unified motion contract:
// acceleration-limited motor response, swept pair motion and pre-contact wall
// clipping now apply to all inputs. Prior values are preserved in
// baselines/unified-20260926/prior-movement-baseline.txt, not overwritten there.
// Behavioral turn, progress, wall and contact-budget gates run separately.
const BASELINES = [
  { name: 'open', scenario: 'open-field', largeAgentPercent: 0,
    initial: '876a2f74', step120: 'ee75635d', command: 'f09ad175', command60: 'f713018b' },
  { name: 'corners', scenario: 'winding-corners', largeAgentPercent: 0,
    initial: '20137ce9', step120: '0551df9d', command: '1e74ad9d', command60: 'd983886f' },
  { name: 'mixed sizes at corners', scenario: 'winding-corners', largeAgentPercent: 5,
    initial: '805de773', step120: 'a2887663', command: '7dd5c820', command60: '025c852c' },
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
