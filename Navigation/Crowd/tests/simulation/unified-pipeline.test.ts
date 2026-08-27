import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('unified crowd pipeline', () => {
  it('is deterministic and distinct from the legacy pipeline', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 200, seed: 73, pipeline: 'unified' as const };
    const first = new CrowdSimulation({ ...config }, getScenario('obstacle-field'));
    const second = new CrowdSimulation({ ...config }, getScenario('obstacle-field'));
    const legacy = new CrowdSimulation(
      { ...config, pipeline: 'current' },
      getScenario('obstacle-field'),
    );
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
      legacy.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
    expect(first.stateHash()).not.toBe(legacy.stateHash());
  });

  it('releases dense-spawn by step 60 without overlap, reverse waves, or fallback', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, pipeline: 'unified' },
      getScenario('dense-spawn'),
    );
    const initialDistance = new Float64Array(simulation.state.count);
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      initialDistance[agent] = Math.hypot(
        simulation.goal.x - simulation.state.x[agent]!,
        simulation.goal.y - simulation.state.y[agent]!,
      );
    }
    let maximumLongStops = 0;
    let maximumOverlaps = 0;
    let maximumStrongBackward = 0;
    let fallbackAgentFrames = 0;
    for (let step = 0; step < 60; step += 1) {
      simulation.step();
      maximumLongStops = Math.max(maximumLongStops, simulation.metrics.longAdjacentStopCount);
      maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
      maximumStrongBackward = Math.max(maximumStrongBackward, simulation.metrics.strongBackwardCount);
      fallbackAgentFrames += simulation.metrics.safetyFallbackCount;
    }
    let totalProgress = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      totalProgress += initialDistance[agent]! - Math.hypot(
        simulation.goal.x - simulation.state.x[agent]!,
        simulation.goal.y - simulation.state.y[agent]!,
      );
    }

    expect(totalProgress / simulation.state.count).toBeGreaterThanOrEqual(35);
    expect(maximumLongStops).toBeLessThanOrEqual(100);
    expect(maximumStrongBackward).toBe(0);
    expect(maximumOverlaps).toBe(0);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
    expect(fallbackAgentFrames).toBe(0);
  }, 10_000);

  it('passes the 1000-agent obstacle-field acceptance gate at step 600', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, seed: 42, pipeline: 'unified' },
      getScenario('obstacle-field'),
    );
    const gateX = Math.max(...simulation.scenario.obstacles.map(
      (obstacle) => obstacle.x + obstacle.width,
    ));
    const previousX = new Float64Array(simulation.state.x);
    let gateCrossings = 0;
    let stopMoveStopTransitions = 0;
    let maximumLongStops = 0;
    let maximumOverlaps = 0;
    let maximumWallOverlaps = 0;
    let maximumStrongBackward = 0;
    let fallbackAgentFrames = 0;
    let activeAgentFrames = 0;
    for (let step = 0; step < 600; step += 1) {
      simulation.step();
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (previousX[agent]! < gateX && simulation.state.x[agent]! >= gateX) gateCrossings += 1;
        previousX[agent] = simulation.state.x[agent]!;
      }
      stopMoveStopTransitions += simulation.metrics.stopMoveStopCount;
      maximumLongStops = Math.max(maximumLongStops, simulation.metrics.longAdjacentStopCount);
      maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
      maximumStrongBackward = Math.max(maximumStrongBackward, simulation.metrics.strongBackwardCount);
      fallbackAgentFrames += simulation.metrics.safetyFallbackCount;
      activeAgentFrames += simulation.metrics.activeCount;
      if (simulation.metrics.safetyFallbackCount === 0) {
        expect(simulation.metrics.maxAcceleration).toBeLessThanOrEqual(
          simulation.config.maxAcceleration + 1e-6,
        );
      }
    }

    expect(gateCrossings / 10).toBeGreaterThanOrEqual(25);
    expect(stopMoveStopTransitions).toBeLessThanOrEqual(300);
    expect(maximumLongStops).toBeLessThanOrEqual(10);
    expect(simulation.metrics.arrivedCount).toBeGreaterThan(0);
    expect(maximumOverlaps).toBe(0);
    expect(maximumWallOverlaps).toBe(0);
    expect(maximumStrongBackward).toBe(0);
    expect(fallbackAgentFrames / activeAgentFrames).toBeLessThan(0.001);
  }, 30_000);

  it('bounds work for a pathological 1000-agent coincident cluster', () => {
    const makeCluster = (): CrowdSimulation => {
      const simulation = new CrowdSimulation(
        { ...DEFAULT_CONFIG, pipeline: 'unified' },
        getScenario('open-field'),
      );
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        simulation.state.x[agent] = 200;
        simulation.state.y[agent] = 360;
        simulation.state.vx[agent] = 40;
        simulation.state.vy[agent] = 0;
        simulation.state.active[agent] = 1;
      }
      return simulation;
    };
    const first = makeCluster();
    const second = makeCluster();

    first.step();
    second.step();

    expect(first.metrics.overlapPairs).toBeGreaterThan(0);
    expect(first.metrics.candidateChecks).toBeLessThan(600_000);
    expect(first.stateHash()).toBe(second.stateHash());
    for (let agent = 0; agent < first.state.count; agent += 1) {
      expect(Number.isFinite(first.state.x[agent])).toBe(true);
      expect(Number.isFinite(first.state.y[agent])).toBe(true);
      expect(Number.isFinite(first.state.vx[agent])).toBe(true);
      expect(Number.isFinite(first.state.vy[agent])).toBe(true);
    }
  });
});
