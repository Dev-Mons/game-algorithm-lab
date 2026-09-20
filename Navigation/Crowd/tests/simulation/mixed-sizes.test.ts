import { describe, expect, it, vi } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { circleOverlapsRect } from '../../src/core/obstacle-collision';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getTestScenario } from '../fixtures/navigation-scenarios';

function mixed(scenario = 'open-field', overrides = {}) {
  return new CrowdSimulation({ ...DEFAULT_CONFIG, largeAgentPercent: 5, largeAgentScale: 2, ...overrides },
    getTestScenario(scenario));
}

function assertStaticSafety(simulation: CrowdSimulation): void {
  for (let a = 0; a < simulation.state.count; a++) {
    const x = simulation.state.x[a]!;
    const y = simulation.state.y[a]!;
    const clearance = simulation.agentRadii[a]! + simulation.config.wallMargin;
    expect(x).toBeGreaterThanOrEqual(clearance - 1e-8);
    expect(y).toBeGreaterThanOrEqual(clearance - 1e-8);
    expect(x).toBeLessThanOrEqual(simulation.config.width - clearance + 1e-8);
    expect(y).toBeLessThanOrEqual(simulation.config.height - clearance + 1e-8);
    for (const obstacle of simulation.scenario.obstacles) {
      expect(circleOverlapsRect(x, y, clearance - 1e-8, obstacle)).toBe(false);
    }
  }
}

describe('mixed body sizes', () => {
  it('scatters exactly 5% large bodies across the spawn without initial overlaps', () => {
    const simulation = mixed();
    expect(simulation.state.count).toBe(1000);
    expect(simulation.largeAgentCount).toBe(50);
    const occupied = new Set<string>();
    const spawn = simulation.scenario.spawn;
    let minimumGap = Infinity;
    for (let a = 0; a < simulation.state.count; a++) {
      if (simulation.agentRadii[a]! > simulation.config.agentRadius) {
        occupied.add(`${Math.floor((simulation.state.x[a]! - spawn.x) / (spawn.width / 3))}`
          + `/${Math.floor((simulation.state.y[a]! - spawn.y) / (spawn.height / 3))}`);
        expect(simulation.agentRadii[a]).toBe(6.4);
      }
      for (let b = a + 1; b < simulation.state.count; b++) {
        const distance = Math.hypot(simulation.state.x[a]! - simulation.state.x[b]!,
          simulation.state.y[a]! - simulation.state.y[b]!);
        minimumGap = Math.min(minimumGap, distance - simulation.agentRadii[a]! - simulation.agentRadii[b]!);
      }
    }
    expect(occupied.size).toBe(9);
    expect(minimumGap).toBeGreaterThanOrEqual(0);
    assertStaticSafety(simulation);
    expect(simulation.crowdField.density.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1150, 8);
    const hash = simulation.stateHash();
    simulation.step();
    simulation.reset();
    expect(simulation.stateHash()).toBe(hash);
    expect(mixed('open-field', { seed: 43 }).stateHash()).not.toBe(hash);
  });

  it.each([
    { largeAgentPercent: 0, largeAgentScale: 4, expected: 0 },
    { largeAgentPercent: 100, largeAgentScale: 2, expected: 100 },
    { largeAgentPercent: 5, largeAgentScale: 1, expected: 0 },
  ])('handles size boundaries: %j', ({ expected, ...config }) => {
    const simulation = mixed('open-field', { agentCount: 100, ...config });
    expect(simulation.largeAgentCount).toBe(expected);
    simulation.step();
    assertStaticSafety(simulation);
  });

  it('retains the rounded ratio when a spawn cannot fit the requested population', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 400,
      largeAgentPercent: 5, largeAgentScale: 3 }, {
      ...getTestScenario('open-field'), spawn: { x: 40, y: 40, width: 80, height: 80 },
    });
    expect(simulation.state.count).toBeGreaterThan(0);
    expect(simulation.unspawnedCount).toBeGreaterThan(0);
    expect(simulation.largeAgentCount).toBe(Math.round(simulation.state.count * .05));
    assertStaticSafety(simulation);
  });

  it('resolves large/small contacts at the sum of their actual radii', () => {
    const simulation = mixed('open-field', { agentCount: 2, largeAgentPercent: 50, maxSpeed: 0, agentGap: 0 });
    simulation.state.x.set([300, 309]);
    simulation.state.y.set([300, 300]);
    simulation.step();
    expect(simulation.metrics.contactConstraints).toBe(simulation.metrics.constraintIterations);
    for (let step = 0; step < 10; step++) simulation.step();
    expect(Math.hypot(simulation.state.x[0]! - simulation.state.x[1]!,
      simulation.state.y[0]! - simulation.state.y[1]!)).toBeGreaterThan(9.59);
    expect(simulation.metrics.overlapPairs).toBe(0);
  });

  it.each(['open-field', 'obstacle-field', 'four-way-merge'])(
    'uses the common FlowField policy and moves both sizes safely in %s', (scenario) => {
      const simulation = mixed(scenario, { agentCount: 200, largeAgentScale: 3 });
      const replay = mixed(scenario, { agentCount: 200, largeAgentScale: 3 });
      const initialX = simulation.state.x.slice();
      const initialY = simulation.state.y.slice();
      const sample = vi.spyOn(FlowField.prototype, 'sampleDirection');
      simulation.step();
      expect(sample).toHaveBeenCalledTimes(simulation.state.count);
      sample.mockRestore();
      replay.step();
      for (let step = 1; step < 480; step++) {
        simulation.step();
        replay.step();
        expect(simulation.metrics.wallOverlapCount).toBe(0);
        expect(simulation.metrics.candidateChecks).toBeLessThanOrEqual(simulation.state.count * 24);
        expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
          simulation.state.count * 8 * simulation.metrics.constraintIterations);
        if (step % 60 === 0) assertStaticSafety(simulation);
      }
      let largeMoved = 0;
      let smallMoved = 0;
      for (let a = 0; a < simulation.state.count; a++) {
        const distance = Math.hypot(simulation.state.x[a]! - initialX[a]!, simulation.state.y[a]! - initialY[a]!);
        if (distance > 100) {
          if (simulation.agentRadii[a]! > simulation.config.agentRadius) largeMoved++;
          else smallMoved++;
        }
      }
      expect(largeMoved).toBe(simulation.largeAgentCount);
      expect(smallMoved).toBeGreaterThan(150);
      expect(simulation.stateHash()).toBe(replay.stateHash());
      simulation.setGoal(96, 96);
      simulation.step();
      assertStaticSafety(simulation);
    }, 30_000,
  );
});
