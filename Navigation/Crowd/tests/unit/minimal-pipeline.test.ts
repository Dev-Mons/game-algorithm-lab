import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { PositionRelaxationSolver } from '../../src/core/position-relaxation';
import { AgentBuffer } from '../../src/core/agent-state';
import { getScenario } from '../../src/scenarios/scenarios';

describe('minimal pipeline (P1 experiment)', () => {
  it('is deterministic for the same seed and configuration', () => {
    const config = { ...DEFAULT_CONFIG, agentCount: 250, seed: 98765, pipeline: 'minimal' as const };
    const first = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    const second = new CrowdSimulation({ ...config }, getScenario('dense-spawn'));
    for (let step = 0; step < 180; step += 1) {
      first.step();
      second.step();
    }
    expect(first.stateHash()).toBe(second.stateHash());
  });

  it('diverges from the current pipeline (the switch actually switches)', () => {
    const base = { ...DEFAULT_CONFIG, agentCount: 100, seed: 7 };
    const current = new CrowdSimulation({ ...base, pipeline: 'current' as const }, getScenario('open-field'));
    const minimal = new CrowdSimulation({ ...base, pipeline: 'minimal' as const }, getScenario('open-field'));
    for (let step = 0; step < 60; step += 1) {
      current.step();
      minimal.step();
    }
    expect(minimal.stateHash()).not.toBe(current.stateHash());
  });

  it('keeps 500 agents finite, inside walls, and nearly overlap-free in obstacle-field', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 500, pipeline: 'minimal' },
      getScenario('obstacle-field'),
    );
    let maximumWallOverlaps = 0;
    let maximumPenetration = 0;
    let allFinite = true;
    for (let step = 0; step < 600; step += 1) {
      simulation.step();
      maximumWallOverlaps = Math.max(maximumWallOverlaps, simulation.metrics.wallOverlapCount);
      for (let i = 0; i < simulation.state.count; i += 1) {
        if (simulation.state.active[i] !== 1) continue;
        allFinite = allFinite
          && Number.isFinite(simulation.state.x[i])
          && Number.isFinite(simulation.state.y[i])
          && Number.isFinite(simulation.state.vx[i])
          && Number.isFinite(simulation.state.vy[i]);
      }
      if (simulation.metrics.overlapPairs === 0) continue;
      // Only pairs flagged by the relaxation pass can still overlap.
      for (let i = 0; i < simulation.state.count; i += 1) {
        if (simulation.overlapFlags[i] !== 1) continue;
        for (let j = i + 1; j < simulation.state.count; j += 1) {
          if (simulation.overlapFlags[j] !== 1) continue;
          const dx = simulation.state.x[i]! - simulation.state.x[j]!;
          const dy = simulation.state.y[i]! - simulation.state.y[j]!;
          maximumPenetration = Math.max(
            maximumPenetration,
            simulation.config.agentRadius * 2 - Math.hypot(dx, dy),
          );
        }
      }
    }
    expect(allFinite).toBe(true);
    expect(maximumWallOverlaps).toBe(0);
    // The relaxation cap allows a residual overlap to persist for a few frames;
    // it must stay visually invisible (agent radius is 3.2px).
    expect(maximumPenetration).toBeLessThanOrEqual(1);
  }, 15_000);

  it('reaches the goal in open-field', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 500, pipeline: 'minimal' },
      getScenario('open-field'),
    );
    for (let step = 0; step < 1800; step += 1) simulation.step();
    expect(simulation.metrics.arrivalRate).toBeGreaterThan(0.95);
  }, 15_000);
});

describe('position relaxation solver', () => {
  function makePair(distanceApart: number): {
    next: AgentBuffer;
    offsets: Int32Array;
    indices: Int32Array;
    active: Uint8Array;
  } {
    const next = new AgentBuffer(2);
    next.x[0] = 100;
    next.y[0] = 100;
    next.x[1] = 100 + distanceApart;
    next.y[1] = 100;
    next.active.fill(1);
    // Symmetric cache: each agent lists the other.
    const offsets = new Int32Array([0, 1, 2]);
    const indices = new Int32Array([1, 0]);
    const active = new Uint8Array([1, 1]);
    return { next, offsets, indices, active };
  }

  it('splits a shallow overlap symmetrically without touching velocity', () => {
    const radius = 3.2;
    const { next, offsets, indices, active } = makePair(radius * 2 - 0.5);
    next.vx[0] = 10;
    next.vy[1] = -5;
    const solver = new PositionRelaxationSolver();
    const result = solver.solve({
      next,
      active,
      neighborOffsets: offsets,
      neighborIndices: indices,
      agentRadius: radius,
      maxCorrection: radius * 0.3,
      iterations: 4,
      obstacles: [],
      worldWidth: 1200,
      worldHeight: 720,
      staticClearance: radius,
    });
    const distance = Math.hypot(next.x[0]! - next.x[1]!, next.y[0]! - next.y[1]!);
    expect(distance).toBeGreaterThanOrEqual(radius * 2 - 1e-6);
    expect(result.correctedAgents).toBe(2);
    expect(result.remainingOverlapPairs).toBe(0);
    expect(next.vx[0]).toBe(10);
    expect(next.vy[1]).toBe(-5);
    // Symmetric halves: both moved the same distance along the pair axis.
    expect(Math.abs((100 - next.x[0]!) - (next.x[1]! - (100 + radius * 2 - 0.5)))).toBeLessThan(1e-9);
  });

  it('caps a deep overlap at the per-step budget', () => {
    const radius = 3.2;
    const { next, offsets, indices, active } = makePair(radius * 0.5);
    const cap = radius * 0.3;
    const solver = new PositionRelaxationSolver();
    const result = solver.solve({
      next,
      active,
      neighborOffsets: offsets,
      neighborIndices: indices,
      agentRadius: radius,
      maxCorrection: cap,
      iterations: 4,
      obstacles: [],
      worldWidth: 1200,
      worldHeight: 720,
      staticClearance: radius,
    });
    expect(result.maxCorrection).toBeLessThanOrEqual(cap + 1e-9);
    expect(result.remainingOverlapPairs).toBe(1);
  });

  it('never leaves an agent inside the static clearance envelope', () => {
    const radius = 3.2;
    const clearance = radius + 0.41;
    const next = new AgentBuffer(1);
    next.x[0] = 50;
    next.y[0] = 50;
    next.active[0] = 1;
    const solver = new PositionRelaxationSolver();
    solver.solve({
      next,
      active: new Uint8Array([1]),
      neighborOffsets: new Int32Array([0, 0]),
      neighborIndices: new Int32Array(0),
      agentRadius: radius,
      maxCorrection: radius * 0.3,
      iterations: 2,
      obstacles: [{ x: 45, y: 40, width: 20, height: 20 }],
      worldWidth: 1200,
      worldHeight: 720,
      staticClearance: clearance,
    });
    const closestX = Math.max(45, Math.min(next.x[0]!, 65));
    const closestY = Math.max(40, Math.min(next.y[0]!, 60));
    const distance = Math.hypot(next.x[0]! - closestX, next.y[0]! - closestY);
    expect(distance).toBeGreaterThanOrEqual(clearance - 1e-6);
  });
});
