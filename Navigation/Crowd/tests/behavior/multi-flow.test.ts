import { describe, expect, it } from 'vitest';
import { FlowBehaviorTracker } from '../../src/core/flow-behavior-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('unified multi-flow behavior', () => {
  it.each(['merge-500-500', 'crossing-500-500'])(
    'keeps %s fair, live, deterministic, and physically safe',
    (scenarioId) => {
      const steps = 900;
      const simulation = new CrowdSimulation(
        { ...DEFAULT_CONFIG, pipeline: 'unified', agentCount: 1000, seed: 42 },
        getScenario(scenarioId),
      );
      const tracker = new FlowBehaviorTracker(simulation, steps);
      for (let step = 0; step < steps; step += 1) {
        simulation.step();
        tracker.update();
      }
      const result = tracker.snapshot();

      expect(result.initialAgents).toEqual([500, 500]);
      expect(Math.min(...result.crossings)).toBeGreaterThan(300);
      expect(Math.min(...result.arrived)).toBeGreaterThan(0);
      expect(result.crossingFairness).toBeGreaterThanOrEqual(0.9);
      expect(result.arrivalFairness).toBeGreaterThanOrEqual(0.9);
      expect(Math.max(...result.maximumStarvationSteps)).toBeLessThanOrEqual(180);
      expect(result.minimumRollingThroughputPerSecond).toBeGreaterThan(0);
      expect(result.laneSwitchRateSecondHalf).toBeLessThanOrEqual(
        result.laneSwitchRateFirstHalf * 4 + 1,
      );
      expect(result.safetyFallbackRate).toBeLessThan(0.001);
      expect(result.maximumOverlaps).toBe(0);
      expect(result.maximumWallOverlaps).toBe(0);
      expect(result.hash).toMatch(/^[0-9a-f]{8}$/);
    },
    30_000,
  );

  it('replays a multi-goal crossing with the same state hash', () => {
    const config = { ...DEFAULT_CONFIG, pipeline: 'unified' as const, agentCount: 200, seed: 73 };
    const first = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    const second = new CrowdSimulation({ ...config }, getScenario('crossing-500-500'));
    for (let step = 0; step < 360; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  }, 15_000);
});
