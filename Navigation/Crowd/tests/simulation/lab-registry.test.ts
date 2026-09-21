import { describe, expect, it, vi } from 'vitest';
import { PRESETS, resolveExperiment, type ExperimentPreset } from '../../src/algorithms/lab/registry';
import { emptyExperimentStats } from '../../src/algorithms/lab/contracts';
import type { PipelineFactory } from '../../src/algorithms/lab/pipeline';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { getScenario } from '../../src/scenarios/scenarios';

describe('algorithm registration and lifecycle', () => {
  it('rejects removed presets and unsupported Legacy overrides', () => {
    for (const preset of ['B0', 'B1', 'R', 'Q', 'D']) {
      expect(() => resolveExperiment({ preset })).toThrow('Unknown crowd preset');
    }
    expect(() => resolveExperiment({ experiment: { avoidance: 'orca' } })).toThrow('does not support module overrides');
  });

  it('dispatches a registered implementation across steps, commands, terrain edits and reset', () => {
    const createPipeline = vi.fn<PipelineFactory>((world, _options, _primary, _overrides, terrainVersion) => {
      const stats = emptyExperimentStats();
      stats.terrainVersion = terrainVersion;
      return {
        stats,
        preferredX: new Float64Array(world.state.count),
        preferredY: new Float64Array(world.state.count),
        targets: Array.from({ length: world.state.count }, (_, i) => ({ ...world.goals[world.flows[i]!]! })),
        available: new Uint8Array(world.state.count).fill(1),
        navigators: [],
        sample: (_agent, _x, _y, out) => { out.x = 0; out.y = 1; return true; },
        step: (current, next) => {
          next.copyFrom(current);
          next.y[0] = current.y[0]! + 1;
          stats.activeCount = current.count;
          stats.movingCount = 1;
          return {
            candidateChecks: 0, totalNeighbors: 0, maxNeighbors: 0, overlapPairs: 0,
            recoveredAgents: 0, maxRecoveryDistance: 0, contactChecks: 0, contactConstraints: 0,
            constraintIterations: 0, maxContacts: 0, contactCorrectedAgents: 0,
            maxContactCorrection: 0, staticProjectionCorrections: 0,
          };
        },
      };
    });
    // A test-only implementation proves the registry is an executable extension
    // point, without retaining any of the removed movement algorithms.
    const registry = PRESETS as ExperimentPreset[];
    registry.push({ id: 'test-pipeline', name: 'Test', description: '', limitations: '',
      options: { destination: 'exit' }, createPipeline });
    try {
      const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount: 4, preset: 'test-pipeline' }, getScenario('open-field'));
      const initialY = simulation.state.y[0]!;
      simulation.step();
      expect(simulation.state.y[0]).toBe(initialY + 1);
      expect(simulation.experimentStats.movingCount).toBe(1);
      expect(simulation.stepCount).toBe(1);

      simulation.setGoal(1000, 300);
      expect(simulation.goalForAgent(0)).toEqual({ x: 1000, y: 300 });
      simulation.updateObstacles([]);
      expect(simulation.experimentStats.terrainVersion).toBe(1);
      simulation.reset();
      expect(simulation.state.y[0]).toBe(initialY);
      expect(simulation.stepCount).toBe(0);
      expect(createPipeline).toHaveBeenCalledTimes(4);
      expect(() => simulation.setAgentGoal(0, 100, 100)).toThrow('does not support individual goal');
    } finally {
      registry.pop();
    }
  });
});
