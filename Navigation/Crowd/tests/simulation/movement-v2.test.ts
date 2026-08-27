import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('single crowd movement pipeline', () => {
  it('replays the same seed and configuration deterministically', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 98765 };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it.each(['open-field', 'obstacle-field', 'dense-spawn'])(
    'spawns 1000 non-overlapping agents in %s',
    (scenarioId) => {
      const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario(scenarioId));
      const diameterSquared = (simulation.config.agentRadius * 2) ** 2;
      let minimumSquared = Number.POSITIVE_INFINITY;
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        for (let other = agent + 1; other < simulation.state.count; other += 1) {
          const dx = simulation.state.x[agent]! - simulation.state.x[other]!;
          const dy = simulation.state.y[agent]! - simulation.state.y[other]!;
          minimumSquared = Math.min(minimumSquared, dx * dx + dy * dy);
        }
      }
      expect(simulation.state.count).toBe(1000);
      expect(simulation.unspawnedCount).toBe(0);
      expect(minimumSquared).toBeGreaterThanOrEqual(diameterSquared - 1e-9);
    },
  );

  it('turns command intent immediately and removes momentum toward the old goal', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 200 },
      getScenario('open-field'),
    );
    for (let step = 0; step < 120; step += 1) simulation.step();
    const oldGoalX = simulation.goal.x;

    simulation.setGoal(10, 360);

    let redirected = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      expect(simulation.state.vx[agent]! * simulation.state.intentX[agent]!
        + simulation.state.vy[agent]! * simulation.state.intentY[agent]!).toBeGreaterThanOrEqual(-1e-9);
      if (simulation.state.intentX[agent]! < -0.25) redirected += 1;
    }
    expect(simulation.goal.x).toBeLessThan(oldGoalX);
    expect(redirected).toBeGreaterThan(180);

    simulation.step();
    let progress = 0;
    let active = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      active += 1;
      progress += simulation.state.vx[agent]! * simulation.state.intentX[agent]!
        + simulation.state.vy[agent]! * simulation.state.intentY[agent]!;
    }
    expect(progress / active).toBeGreaterThan(0);
    expect(simulation.metrics.backwardCount).toBe(0);
  });

  it('separates an invalid coincident cluster without stopping the group', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 32 },
      getScenario('open-field'),
    );
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      simulation.state.x[agent] = 200;
      simulation.state.y[agent] = 360;
      simulation.state.vx[agent] = 40;
      simulation.state.vy[agent] = 0;
      simulation.state.active[agent] = 1;
    }

    simulation.step();

    let spreadSquared = 0;
    let moving = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      const dx = simulation.state.x[agent]! - 200;
      const dy = simulation.state.y[agent]! - 360;
      spreadSquared += dx * dx + dy * dy;
      if (Math.hypot(simulation.state.vx[agent]!, simulation.state.vy[agent]!) > 1) moving += 1;
    }
    expect(spreadSquared).toBeGreaterThan(1);
    expect(moving).toBeGreaterThan(simulation.state.count * 0.8);
    expect(simulation.metrics.recoveredAgents).toBeGreaterThan(0);
    expect(simulation.metrics.candidateChecks).toBeLessThan(simulation.state.count * 96 * 8);

    const firstOverlapCount = simulation.metrics.overlapPairs;
    for (let step = 0; step < 60; step += 1) simulation.step();
    expect(simulation.metrics.overlapPairs).toBeLessThan(firstOverlapCount);
    expect(simulation.metrics.averageSpeed).toBeGreaterThan(1);
  });

  it('keeps a 1000-agent hot path finite and spatially bounded', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000 },
      getScenario('obstacle-field'),
    );
    let maximumCandidates = 0;
    for (let step = 0; step < 240; step += 1) {
      simulation.step();
      maximumCandidates = Math.max(maximumCandidates, simulation.metrics.candidateChecks);
    }
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      expect(Number.isFinite(simulation.state.x[agent])).toBe(true);
      expect(Number.isFinite(simulation.state.y[agent])).toBe(true);
      expect(Number.isFinite(simulation.state.vx[agent])).toBe(true);
      expect(Number.isFinite(simulation.state.vy[agent])).toBe(true);
    }
    expect(maximumCandidates).toBeLessThan(1000 * 96 * 8);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
    expect(simulation.stateHash()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('releases a dense 1000-agent crowd without overlap or stop-wave collapse', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000, seed: 42 },
      getScenario('dense-spawn'),
    );
    let recoveredAgentFrames = 0;
    let maximumOverlaps = 0;
    let maximumWallOverlaps = 0;
    for (let step = 0; step < 60; step += 1) {
      simulation.step();
      recoveredAgentFrames += simulation.metrics.recoveredAgents;
      maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
    }
    let goalProgress = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      goalProgress += simulation.state.vx[agent]! * simulation.state.intentX[agent]!
        + simulation.state.vy[agent]! * simulation.state.intentY[agent]!;
    }
    expect(goalProgress / simulation.state.count).toBeGreaterThanOrEqual(35);
    expect(recoveredAgentFrames / (simulation.state.count * 60)).toBeLessThan(0.001);
    expect(maximumOverlaps).toBe(0);
    expect(maximumWallOverlaps).toBe(0);
  });

  it('maintains useful obstacle-gate throughput with no reported penetration', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000, seed: 42 },
      getScenario('obstacle-field'),
    );
    const previousX = new Float64Array(simulation.state.x);
    let crossings = 0;
    let maximumOverlaps = 0;
    let maximumWallOverlaps = 0;
    for (let step = 0; step < 600; step += 1) {
      simulation.step();
      maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (previousX[agent]! < 660 && simulation.state.x[agent]! >= 660) crossings += 1;
        previousX[agent] = simulation.state.x[agent]!;
      }
    }
    const throughput = crossings / (600 * simulation.config.fixedDelta);
    expect(throughput).toBeGreaterThanOrEqual(25);
    expect(simulation.metrics.arrivedCount).toBeGreaterThan(0);
    expect(maximumOverlaps).toBe(0);
    expect(maximumWallOverlaps).toBe(0);
  }, 15_000);
});
