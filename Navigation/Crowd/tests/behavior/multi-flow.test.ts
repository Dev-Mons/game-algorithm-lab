import { describe, expect, it } from 'vitest';
import { FlowBehaviorTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('generic multi-flow scenarios', () => {
  it.each(['merge-500-500', 'crossing-500-500'])(
    'keeps both streams moving in %s',
    (scenarioId) => {
      const simulation = new CrowdSimulation(
        { ...DEFAULT_CONFIG, agentCount: 400, seed: 42 },
        getScenario(scenarioId),
      );
      const tracker = new FlowBehaviorTracker(simulation, 180);
      for (let step = 0; step < 900; step += 1) {
        simulation.step();
        tracker.update();
      }
      const result = tracker.snapshot();
      expect(result.initialAgents).toEqual([200, 200]);
      expect(Math.min(...result.crossings)).toBeGreaterThan(40);
      expect(result.crossingFairness).toBeGreaterThanOrEqual(0.85);
      expect(result.maximumWallOverlaps).toBe(0);
      expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
    },
    20_000,
  );

  it('replays independent flow goals with the same state hash', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 200, seed: 73 };
    const first = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    const second = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    for (let step = 0; step < 360; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });
});
