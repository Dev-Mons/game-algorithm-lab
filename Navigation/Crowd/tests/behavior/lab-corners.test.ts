import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { auditGeometry } from '../../src/core/lab-results';
import { getScenario } from '../../src/scenarios/scenarios';

const gates = [
  { x: 408, minY: 504, maxY: 720 },
  { x: 672, minY: 0, maxY: 216 },
  { x: 936, minY: 504, maxY: 720 },
];

describe('experimental winding-corner passage', () => {
  it.each([
    ...['B0', 'B1', 'R', 'Q', 'D'].map((preset) => ({ preset, count: 128, limit: 3600, stopWhenComplete: false })),
    { preset: 'R', count: 1000, limit: 7200, stopWhenComplete: true },
    { preset: 'Q', count: 1000, limit: 7200, stopWhenComplete: true },
  ])('$preset (N=$count) crosses the required wall-end gates and reaches assigned destinations', async ({ preset, count, limit, stopWhenComplete }) => {
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, preset, agentCount: count, seed: 42 }, getScenario('winding-corners'));
    const passed = gates.map(() => new Set<number>());
    const required = gates.map((gate) => Array.from({ length: simulation.state.count }, (_, agent) => agent)
      .filter((agent) => simulation.goalForAgent(agent).x > gate.x));
    expect(simulation.state.count).toBe(count);
    expect(simulation.experimentStats.unavailableSlots).toBe(0);
    let maximumWalls = 0;
    let maximumInvalidStarts = 0;
    let finite = true;
    // The default 1k population exposed persistent cases absent at 128 (including agent 138).
    // Its retained-slot cases have a fixed 120s cap and stop early only after every agent arrives.
    for (let tick = 0; tick < limit; tick += 1) {
      simulation.step();
      maximumWalls = Math.max(maximumWalls, simulation.metrics.wallOverlapCount);
      maximumInvalidStarts = Math.max(maximumInvalidStarts, simulation.experimentStats.invalidStaticStarts);
      for (let agent = 0; agent < simulation.state.count; agent += 1) {
        const previousX = simulation.previousState.x[agent]!; const x = simulation.state.x[agent]!;
        if (![x, simulation.state.y[agent], simulation.state.vx[agent], simulation.state.vy[agent]].every(Number.isFinite)) finite = false;
        for (let gateIndex = 0; gateIndex < gates.length; gateIndex += 1) {
          const gate = gates[gateIndex]!;
          if (previousX >= gate.x || x < gate.x) continue;
          const fraction = (gate.x - previousX) / (x - previousX);
          const y = simulation.previousState.y[agent]! + (simulation.state.y[agent]! - simulation.previousState.y[agent]!) * fraction;
          if (y > gate.minY && y < gate.maxY) passed[gateIndex]!.add(agent);
        }
      }
      if (tick % 120 === 119) maximumWalls = Math.max(maximumWalls, auditGeometry(simulation).walls);
      if (stopWhenComplete && simulation.metrics.arrivedCount === count) break;
      // Let the test worker deliver progress/RPC messages during these long,
      // fixed-tick runs. Wall-clock yielding does not advance the simulation.
      if (tick % 300 === 299) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    maximumWalls = Math.max(maximumWalls, auditGeometry(simulation).walls);
    expect(finite).toBe(true);
    expect(maximumWalls).toBe(0);
    expect(maximumInvalidStarts).toBe(0);
    expect(simulation.metrics.arrivedCount).toBe(count);
    expect(simulation.experimentStats.arrivedCount).toBe(count);
    for (let gate = 0; gate < gates.length; gate += 1) {
      expect(required[gate]!.filter((agent) => passed[gate]!.has(agent))).toHaveLength(required[gate]!.length);
    }
  }, 120_000);
});
