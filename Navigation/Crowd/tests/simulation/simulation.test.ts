import { describe, expect, it, vi } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { distanceSquaredToRect } from '../../src/core/obstacle-collision';
import type { ScenarioDefinition, StepMetrics } from '../../src/core/types';
import { getScenario } from '../../src/scenarios/scenarios';

describe('crowd simulation', () => {
  it('is deterministic for the same seed and configuration', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 98765 };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('runs 1000 agents without NaN, Infinity, or invalid active state', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1000 }, getScenario('obstacle-field'));
    for (let step = 0; step < 240; step += 1) simulation.step();
    for (let i = 0; i < simulation.state.count; i += 1) {
      expect(Number.isFinite(simulation.state.x[i])).toBe(true);
      expect(Number.isFinite(simulation.state.y[i])).toBe(true);
      expect(Number.isFinite(simulation.state.vx[i])).toBe(true);
      expect(Number.isFinite(simulation.state.vy[i])).toBe(true);
      expect(simulation.state.active[i] === 0 || simulation.state.active[i] === 1).toBe(true);
    }
    expect(simulation.metrics.candidateChecks).toBeLessThan(1000 * 999);
    expect(simulation.stateHash()).toMatch(/^[0-9a-f]{8}$/);
  });

  it.each(['open-field', 'obstacle-field', 'dense-spawn'])('spawns 1000 non-overlapping agents in %s', (scenarioId) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario(scenarioId));
    let minimumSquared = Number.POSITIVE_INFINITY;
    for (let i = 0; i < simulation.state.count; i += 1) {
      for (let j = i + 1; j < simulation.state.count; j += 1) {
        const dx = simulation.state.x[i]! - simulation.state.x[j]!;
        const dy = simulation.state.y[i]! - simulation.state.y[j]!;
        minimumSquared = Math.min(minimumSquared, dx * dx + dy * dy);
      }
    }
    expect(simulation.state.count).toBe(1000);
    expect(simulation.unspawnedCount).toBe(0);
    expect(minimumSquared).toBeGreaterThanOrEqual((simulation.config.agentRadius * 2) ** 2 - 1e-9);
  });

  it('caps an over-capacity spawn deterministically without retrying forever', () => {
    const requestedCount = 5000;
    const config = { ...DEFAULT_CONFIG, agentCount: requestedCount, agentRadius: 8, agentGap: 3 };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    expect(first.state.count).toBeLessThan(requestedCount);
    expect(first.state.count + first.unspawnedCount).toBe(requestedCount);
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('requires reconstruction when agentCount grows beyond the allocated capacity', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 4 },
      getScenario('open-field'),
    );
    simulation.config.agentCount = 5;

    expect(() => simulation.reset()).toThrowError(RangeError);
    expect(() => simulation.reset()).toThrowError(
      'Increasing agentCount requires constructing a new CrowdSimulation.',
    );
  });

  it('clears metrics and overlap flags when assigning a new goal', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 4 },
      getScenario('open-field'),
    );
    for (const key of Object.keys(simulation.metrics) as Array<keyof StepMetrics>) {
      simulation.metrics[key] = 7;
    }
    simulation.overlapFlags.fill(1);

    simulation.setGoal(900, 300);

    for (const key of Object.keys(simulation.metrics) as Array<keyof StepMetrics>) {
      const expected = key === 'activeCount' ? simulation.state.count : 0;
      expect(simulation.metrics[key], key).toBe(expected);
    }
    expect([...simulation.overlapFlags]).toEqual([0, 0, 0, 0]);
  });

  it('never applies a Phase-C obstacle projection opposite to the preferred direction', () => {
    const scenario: ScenarioDefinition = {
      id: 'corner-projection-regression',
      name: 'Corner projection regression',
      description: '',
      goal: { x: 90, y: 48.5 },
      obstacles: [{ x: 50, y: 50, width: 20, height: 20 }],
      spawn: { x: 10, y: 10, width: 20, height: 20 },
    };
    const fixedDelta = 1;
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        width: 100,
        height: 100,
        cellSize: 10,
        agentCount: 1,
        agentRadius: 1,
        wallMargin: 0,
        neighborRadius: 10,
        agentGap: 0,
        maxSpeed: 100,
        maxAcceleration: 1000,
        maxTurnRate: 100,
        fixedDelta,
        goalRadius: 1,
        arrivalSlowRadius: 10,
      },
      scenario,
    );
    const startX = 49.4;
    const startY = 48.5;
    simulation.state.x[0] = startX;
    simulation.state.y[0] = startY;
    simulation.state.active[0] = 1;
    vi.spyOn(simulation.movement, 'planIntent').mockImplementation((_input, output) => {
      output.directionX = 1;
      output.directionY = 0;
      output.avoidanceSide = 1;
      output.avoidanceHold = 0;
      output.blocked = false;
      output.forwardClearance = Number.POSITIVE_INFINITY;
    });
    vi.spyOn(simulation.movement, 'resolveVelocity').mockImplementation((_input, intent, output) => {
      output.x = 0.1;
      output.y = 1;
      output.avoidanceSide = intent.avoidanceSide;
      output.avoidanceHold = intent.avoidanceHold;
      output.emergencyStop = false;
    });

    simulation.step();

    const displacementX = simulation.state.x[0]! - startX;
    const displacementY = simulation.state.y[0]! - startY;
    expect(displacementX).toBeGreaterThanOrEqual(-1e-10);
    expect(simulation.metrics.backwardCount).toBe(0);
    expect(simulation.state.vx[0]! * fixedDelta).toBeCloseTo(displacementX, 10);
    expect(simulation.state.vy[0]! * fixedDelta).toBeCloseTo(displacementY, 10);
  });

  it('reports injected world-bound penetration as a wall overlap', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1 },
      getScenario('open-field'),
    );
    simulation.state.x[0] = 1;
    simulation.state.y[0] = 360;
    simulation.state.vx[0] = 0;
    simulation.state.vy[0] = 0;
    simulation.state.active[0] = 1;

    simulation.step();

    expect(simulation.metrics.wallOverlapCount).toBe(1);
  });

  it('recovers an injected overlap without reversing or becoming permanently stuck', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 2 },
      getScenario('open-field'),
    );
    for (let i = 0; i < 2; i += 1) {
      simulation.state.x[i] = 200;
      simulation.state.y[i] = 360;
      simulation.state.vx[i] = 40;
      simulation.state.vy[i] = 0;
      simulation.state.active[i] = 1;
    }
    let firstSeparatedStep = -1;
    let consecutiveSeparatedSteps = 0;
    for (let step = 0; step < 240; step += 1) {
      simulation.step();
      const dx = simulation.state.x[0]! - simulation.state.x[1]!;
      const dy = simulation.state.y[0]! - simulation.state.y[1]!;
      if (dx * dx + dy * dy >= (simulation.config.agentRadius * 2) ** 2 - 1e-9) {
        if (firstSeparatedStep < 0) firstSeparatedStep = step;
        consecutiveSeparatedSteps += 1;
      } else {
        // A first moment of separation is insufficient: the old dead-annulus
        // bug re-entered overlap on the following frames and stayed there.
        if (firstSeparatedStep >= 0) consecutiveSeparatedSteps = 0;
      }
      expect(simulation.metrics.backwardCount).toBe(0);
      if (consecutiveSeparatedSteps >= 120) break;
    }
    expect(firstSeparatedStep).toBeGreaterThanOrEqual(0);
    expect(consecutiveSeparatedSteps).toBeGreaterThanOrEqual(120);
    expect(simulation.metrics.backwardCount).toBe(0);
    expect(Math.hypot(simulation.state.vx[0]!, simulation.state.vy[0]!)).toBeGreaterThan(0);
    expect(Math.hypot(simulation.state.vx[1]!, simulation.state.vy[1]!)).toBeGreaterThan(0);
  });

  it('separates a coincident local cluster deterministically and keeps it separated', () => {
    const makeSimulation = (): CrowdSimulation => {
      const simulation = new CrowdSimulation(
        { ...DEFAULT_CONFIG, agentCount: 6 },
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
    const first = makeSimulation();
    const second = makeSimulation();
    let stableSeparatedSteps = 0;
    for (let step = 0; step < 360; step += 1) {
      first.step();
      second.step();
      expect(first.stateHash()).toBe(second.stateHash());
      expect(first.metrics.backwardCount).toBe(0);
      let overlaps = 0;
      for (let agent = 0; agent < first.state.count; agent += 1) {
        for (let other = agent + 1; other < first.state.count; other += 1) {
          const dx = first.state.x[agent]! - first.state.x[other]!;
          const dy = first.state.y[agent]! - first.state.y[other]!;
          if (dx * dx + dy * dy < (first.config.agentRadius * 2) ** 2 - 1e-9) overlaps += 1;
        }
      }
      stableSeparatedSteps = overlaps === 0 ? stableSeparatedSteps + 1 : 0;
      if (stableSeparatedSteps >= 120) break;
    }
    expect(stableSeparatedSteps).toBeGreaterThanOrEqual(120);
  });

  it.each(['open-field', 'obstacle-field'])('moves the crowd through %s to the goal', (scenarioId) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 1000 }, getScenario(scenarioId));
    const contactSteps = new Uint16Array(simulation.state.count);
    let maximumContactSteps = 0;
    let maximumOverlaps = 0;
    let maximumBackward = 0;
    let maximumStrongBackward = 0;
    let maximumWallOverlaps = 0;
    for (let step = 0; step < (scenarioId === 'obstacle-field' ? 3600 : 1800); step += 1) {
      simulation.step();
      maximumOverlaps = Math.max(maximumOverlaps, simulation.metrics.overlapPairs);
      maximumBackward = Math.max(maximumBackward, simulation.metrics.backwardCount);
      maximumStrongBackward = Math.max(maximumStrongBackward, simulation.metrics.strongBackwardCount);
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
      if (scenarioId !== 'obstacle-field') continue;
      const clearanceSquared = (simulation.config.agentRadius + simulation.config.wallMargin + 0.05) ** 2;
      for (let i = 0; i < simulation.state.count; i += 1) {
        let touching = false;
        if (simulation.state.active[i] === 1) {
          for (const obstacle of simulation.scenario.obstacles) {
            if (distanceSquaredToRect(simulation.state.x[i]!, simulation.state.y[i]!, obstacle) <= clearanceSquared) touching = true;
          }
        }
        contactSteps[i] = touching ? contactSteps[i]! + 1 : 0;
        maximumContactSteps = Math.max(maximumContactSteps, contactSteps[i]!);
      }
    }
    expect(simulation.metrics.arrivalRate).toBeGreaterThan(0.95);
    expect(simulation.metrics.activeCount + simulation.metrics.arrivedCount).toBe(1000);
    expect(maximumOverlaps).toBe(0);
    expect(maximumBackward).toBe(0);
    expect(maximumStrongBackward).toBe(0);
    expect(maximumWallOverlaps).toBe(0);
    if (scenarioId === 'obstacle-field') expect(maximumContactSteps).toBeLessThanOrEqual(10);
  }, 15_000);

  it('drains a dense 1000-agent spawn without reverse waves or all-pairs checks', () => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG }, getScenario('dense-spawn'));
    let maximumCandidates = 0;
    let maximumNeighbors = 0;
    let maximumStalled = 0;
    for (let step = 0; step < 1800; step += 1) {
      simulation.step();
      maximumCandidates = Math.max(maximumCandidates, simulation.metrics.candidateChecks);
      maximumNeighbors = Math.max(maximumNeighbors, simulation.metrics.maxNeighbors);
      maximumStalled = Math.max(maximumStalled, simulation.metrics.stalledCount);
      expect(simulation.metrics.overlapPairs).toBe(0);
      expect(simulation.metrics.backwardCount).toBe(0);
      expect(simulation.metrics.strongBackwardCount).toBe(0);
    }
    expect(simulation.metrics.arrivalRate).toBeGreaterThan(0.95);
    expect(maximumCandidates).toBeLessThan(1000 * 300);
    expect(maximumNeighbors).toBeLessThan(100);
    expect(maximumStalled).toBeLessThan(1000);
  }, 15_000);
});
