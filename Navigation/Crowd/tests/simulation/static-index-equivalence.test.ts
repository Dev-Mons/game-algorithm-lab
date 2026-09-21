import { describe, expect, it, vi } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { StaticObstacleIndex } from '../../src/core/static-obstacle-index';
import { getScenario } from '../../src/scenarios/scenarios';
import { scaleScenario } from '../../src/scenarios/lab-scenarios';

describe('indexed static queries preserve exhaustive movement', () => {
  it.each([
    ['rocky-pass', 1, 0], ['rocky-pass', Math.sqrt(10), 25],
    ['funnel-bypass', 1, 25], ['winding-corners', 1, 0],
  ] as const)('%s scale=%s large=%s matches every sampled state and metrics', (id, scale, largeAgentPercent) => {
    const run = () => {
      const scenario = scaleScenario(structuredClone(getScenario(id)), scale);
      const s = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 120,
        width: DEFAULT_CONFIG.width * scale, height: DEFAULT_CONFIG.height * scale,
        largeAgentPercent, largeAgentScale: 2 }, scenario);
      const samples = [];
      for (let tick = 0; tick < 480; tick++) {
        if (tick === 120) s.setGoal(s.goal.x, s.goal.y + 24 * scale);
        if (tick === 240) s.updateObstacles([...s.scenario.obstacles, { x: 0, y: 0, width: 12, height: 12 }]);
        if (tick === 360) s.updateObstacles(s.scenario.obstacles.slice(0, -1));
        s.step();
        if (tick % 30 === 0) samples.push({ hash: s.stateHash(), metrics: { ...s.metrics, dynamicRebuildMs: 0 } });
      }
      return samples;
    };
    const optimized = run();
    function exhaustive(this: StaticObstacleIndex) { return this.obstacles.map((_, i) => i); }
    const aabb = vi.spyOn(StaticObstacleIndex.prototype, 'query').mockImplementation(exhaustive);
    const segment = vi.spyOn(StaticObstacleIndex.prototype, 'querySegment').mockImplementation(exhaustive);
    try { expect(run()).toEqual(optimized); }
    finally { aabb.mockRestore(); segment.mockRestore(); }
  }, 20_000);
});
