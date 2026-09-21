import { describe, expect, it } from 'vitest';
import { CrowdQualityTracker } from '../../src/core/crowd-quality-metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getTestScenario } from '../fixtures/navigation-scenarios';

describe('single crowd movement pipeline', () => {
  it('keeps identical bounded contact budgets across former population tier boundaries', () => {
    const budgets = new Set<string>();
    for (const agentCount of [999, 1000, 1001, 3999, 4000, 4001, 10000]) {
      const simulation = new CrowdSimulation({...DEFAULT_CONFIG,agentCount,
        agentRadius:1.5,agentGap:.05},getTestScenario('open-field'));
      simulation.step();
      const m = simulation.metrics;
      budgets.add(`${m.maxContacts}/${m.constraintIterations}`);
      expect(m.candidateChecks).toBeLessThanOrEqual(agentCount * 24);
      expect(m.contactConstraints).toBeLessThanOrEqual(agentCount * 8 * m.constraintIterations);
      expect(m.wallOverlapCount).toBe(0);
    }
    expect(budgets.size).toBe(1);
  });
  it('replays the same seed and configuration deterministically', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 98765 };
    const first = new CrowdSimulation({ ...config }, getTestScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getTestScenario('dense-spawn'));
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it.each(['open-field', 'obstacle-field', 'dense-spawn'])(
    'spawns 1000 non-overlapping agents in %s',
    (scenarioId) => {
      const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getTestScenario(scenarioId));
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

  it('separates an invalid coincident cluster without stopping the group', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 32 },
      getTestScenario('open-field'),
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
    expect(simulation.metrics.contactCorrectedAgents).toBeGreaterThan(
      simulation.state.count * 0.8,
    );
    expect(simulation.metrics.recoveredAgents).toBe(0);
    expect(simulation.metrics.maxContactCorrection).toBeLessThanOrEqual(
      simulation.config.maximumContactCorrection + 1e-9,
    );
    expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
      simulation.metrics.activeCount
        * simulation.metrics.maxContacts
        * simulation.metrics.constraintIterations,
    );

    const firstOverlapCount = simulation.metrics.overlapPairs;
    for (let step = 0; step < 60; step += 1) simulation.step();
    expect(simulation.metrics.overlapPairs).toBeLessThan(firstOverlapCount);
    expect(simulation.metrics.averageSpeed).toBeGreaterThan(1);
  });

  it('caps total contact displacement across all relaxation passes', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 32,
      maxSpeed: 0, maxAcceleration: 0 }, getTestScenario('open-field'));
    simulation.state.x.fill(200);
    simulation.state.y.fill(360);
    simulation.step();
    let moved = 0;
    for (let agent = 0; agent < simulation.state.count; agent++) {
      const distance = Math.hypot(simulation.state.x[agent]! - 200, simulation.state.y[agent]! - 360);
      expect(distance).toBeLessThanOrEqual(simulation.config.maximumContactCorrection + 1e-9);
      if (distance > .01) moved++;
    }
    expect(moved).toBeGreaterThan(24);
    expect(simulation.metrics.maxContactCorrection).toBeLessThanOrEqual(
      simulation.config.maximumContactCorrection + 1e-9);
  });

  it('keeps a 1000-agent hot path finite and spatially bounded', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000 },
      getTestScenario('obstacle-field'),
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

  it('keeps a 10000-agent crowd on the bounded scale path', () => {
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        agentCount: 10_000,
        agentRadius: 1.5,
        agentGap: 0.05,
      },
      getTestScenario('open-field'),
    );

    expect(simulation.state.count).toBe(10_000);
    expect(simulation.unspawnedCount).toBe(0);
    for (let step = 0; step < 5; step += 1) simulation.step();

    expect(simulation.metrics.maxNeighbors).toBeLessThanOrEqual(12);
    expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
      simulation.metrics.activeCount
        * simulation.metrics.maxContacts
        * simulation.metrics.constraintIterations,
    );
    expect(simulation.metrics.overlapPairs).toBe(0);
    expect(simulation.metrics.averageSpeed).toBeGreaterThan(0);
  });

  it('keeps a completely overlapping 10000-agent crowd moving under fixed work', () => {
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        agentCount: 10_000,
        agentRadius: 1.5,
        agentGap: 0.05,
      },
      getTestScenario('open-field'),
    );
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      simulation.state.x[agent] = 200;
      simulation.state.y[agent] = 360;
      simulation.state.vx[agent] = 40;
      simulation.state.vy[agent] = 0;
      simulation.state.active[agent] = 1;
    }

    simulation.crowdField.update(
      simulation.state,
      simulation.config.pressureThreshold,
      0,
    );
    const initialTracker = new CrowdQualityTracker(simulation);
    initialTracker.update();
    const initial = initialTracker.snapshot();
    const finalTracker = new CrowdQualityTracker(simulation);
    let boundedWork = true;
    let maximumCorrection = 0;
    for (let step = 0; step < 60; step += 1) {
      simulation.step();
      finalTracker.update();
      boundedWork &&= simulation.metrics.contactConstraints
        <= simulation.metrics.activeCount
          * simulation.metrics.maxContacts
          * simulation.metrics.constraintIterations;
      maximumCorrection = Math.max(
        maximumCorrection,
        simulation.metrics.maxContactCorrection,
      );
    }
    const final = finalTracker.snapshot();

    let averageX = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      averageX += simulation.state.x[agent]!;
      expect(Number.isFinite(simulation.state.x[agent])).toBe(true);
      expect(Number.isFinite(simulation.state.y[agent])).toBe(true);
    }
    averageX /= simulation.state.count;

    expect(boundedWork).toBe(true);
    expect(maximumCorrection).toBeLessThanOrEqual(
      simulation.config.maximumContactCorrection + 1e-9,
    );
    expect(final.occupiedArea).toBeGreaterThan(initial.occupiedArea);
    expect(final.maxPenetrationDepth).toBeLessThan(initial.maxPenetrationDepth);
    expect(final.penetrationP95).toBeLessThan(initial.penetrationP95);
    expect(simulation.metrics.overlapPairs).toBeGreaterThan(0);
    expect(simulation.metrics.recoveredAgents).toBe(0);
    expect(simulation.metrics.wallOverlapCount).toBe(0);
    expect(simulation.metrics.averageSpeed).toBeGreaterThan(1);
    expect(averageX).toBeGreaterThan(200);
  });

  it('moves 10000 XPBD-contact agents through obstacle gates with bounded work', () => {
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        agentCount: 10_000,
        agentRadius: 1.5,
        agentGap: 0.05,
      },
      getTestScenario('obstacle-field'),
    );
    const previousX = new Float64Array(simulation.state.x);
    let crossings = 0;
    let boundedWork = true;
    let maximumWallOverlaps = 0;
    let maximumStaticProjectionCorrections = 0;
    for (let step = 0; step < 360; step += 1) {
      simulation.step();
      boundedWork &&= simulation.metrics.contactConstraints
        <= simulation.metrics.activeCount
          * simulation.metrics.maxContacts
          * simulation.metrics.constraintIterations;
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
      maximumStaticProjectionCorrections = Math.max(
        maximumStaticProjectionCorrections,
        simulation.metrics.staticProjectionCorrections,
      );
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        if (previousX[agent]! < 660 && simulation.state.x[agent]! >= 660) crossings += 1;
        previousX[agent] = simulation.state.x[agent]!;
      }
    }

    expect(boundedWork).toBe(true);
    expect(maximumWallOverlaps).toBe(0);
    expect(maximumStaticProjectionCorrections).toBeGreaterThan(0);
    expect(simulation.metrics.stalledCount).toBe(0);
    expect(simulation.metrics.averageSpeed).toBeGreaterThan(40);
    expect(crossings).toBeGreaterThan(1_000);
  }, 15_000);

  it('keeps the 4990/5000/5010 boundary on one continuous contact model', () => {
    const counts = [4_990, 5_000, 5_010] as const;
    const progress: number[] = [];
    const budgets: Array<[number, number]> = [];
    for (const agentCount of counts) {
      const simulation = new CrowdSimulation(
        {
          ...DEFAULT_CONFIG,
          agentCount,
          agentRadius: 1.5,
          agentGap: 0.05,
          neighborRadius: 2.9,
        },
        getTestScenario('open-field'),
      );
      for (let step = 0; step < 30; step += 1) simulation.step();
      let goalProgress = 0;
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        goalProgress += simulation.state.vx[agent]! * simulation.state.intentX[agent]!
          + simulation.state.vy[agent]! * simulation.state.intentY[agent]!;
      }
      progress.push(goalProgress / simulation.state.count);
      budgets.push([
        simulation.metrics.maxContacts,
        simulation.metrics.constraintIterations,
      ]);
      expect(simulation.metrics.contactConstraints).toBeLessThanOrEqual(
        simulation.metrics.activeCount
          * simulation.metrics.maxContacts
          * simulation.metrics.constraintIterations,
      );
      expect(simulation.metrics.wallOverlapCount).toBe(0);
    }
    expect(new Set(budgets.map((budget) => budget.join('/'))).size).toBe(1);
    for (let index = 1; index < progress.length; index += 1) {
      const scale = Math.max(progress[index - 1]!, progress[index]!);
      expect(Math.abs(progress[index]! - progress[index - 1]!) / scale).toBeLessThanOrEqual(0.15);
    }
  });

  it('releases a dense 1000-agent crowd without overlap or stop-wave collapse', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1000, seed: 42 },
      getTestScenario('dense-spawn'),
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

  it('maintains useful obstacle-gate throughput with congestion routing and bounded compression', () => {
    const simulation = new CrowdSimulation(
      // This acceptance fixture predates the optional dynamicRouting switch;
      // routing costs were always enabled when its compression limit was set.
      // Freeze that condition instead of weakening the limit when UI defaults
      // change. The imported default (routing off) has a documented limitation.
      { ...DEFAULT_CONFIG, preset: 'legacy', agentCount: 1000, seed: 42, dynamicRouting: true },
      getTestScenario('obstacle-field'),
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
    expect(maximumOverlaps).toBeLessThanOrEqual(16);
    expect(maximumWallOverlaps).toBe(0);
  }, 15_000);
});
