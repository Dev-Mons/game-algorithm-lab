import type { AgentBuffer } from '../../core/agent-state';
import type { CrowdField } from '../../core/crowd-field';
import type { Rect, ScenarioDefinition, SimulationConfig, Vec2 } from '../../core/types';

/** Shared simulation data is borrowed; planners never own/copy the authoritative positions. */
export interface LabWorld {
  config: SimulationConfig;
  scenario: ScenarioDefinition;
  state: AgentBuffer;
  radii: Float64Array;
  flows: Uint16Array;
  goals: readonly Vec2[];
  crowdField: CrowdField;
}
export interface PassTimes {
  navigation: number; desired: number; avoidance: number; contact: number;
  density: number; queue: number; spatial: number; integration: number; total: number;
}
/** Times/counts describe the latest step; path/field/replan/flip/passage counters are cumulative. */
export interface ExperimentStats {
  passMs: PassTimes;
  activeCount: number; movingCount: number; waitingCount: number; arrivedCount: number;
  contactActiveCount: number; pathRequests: number; cacheHits: number; fieldBuilds: number;
  queuePassed: number; replans: number; directionFlips: number; neighborTruncations: number;
  orcaInfeasibleCount: number; invalidStaticStarts: number; unavailableSlots: number;
  terrainVersion: number; substeps: number;
}
export function emptyExperimentStats(): ExperimentStats {
  return {
    passMs: { navigation: 0, desired: 0, avoidance: 0, contact: 0, density: 0, queue: 0, spatial: 0, integration: 0, total: 0 },
    activeCount: 0, movingCount: 0, waitingCount: 0, arrivedCount: 0, contactActiveCount: 0,
    pathRequests: 0, cacheHits: 0, fieldBuilds: 0, queuePassed: 0, replans: 0,
    directionFlips: 0, neighborTruncations: 0, orcaInfeasibleCount: 0, invalidStaticStarts: 0,
    unavailableSlots: 0, terrainVersion: 0, substeps: 1,
  };
}
export interface NavigationLayer {
  invalidate(obstacles: readonly Rect[]): void;
  sample(agent: number, x: number, y: number, out: Vec2): boolean;
}
