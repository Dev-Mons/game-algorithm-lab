import type { AgentBuffer } from '../../core/agent-state';
import type { CrowdMovementResult } from '../../core/crowd-movement-solver';
import type { Vec2 } from '../../core/types';
import type { FlowField } from '../flow-field/flow-field';
import type { ExperimentStats, LabWorld } from './contracts';
import type { ExperimentOptions } from './registry';

export interface AgentGoalCommand { agent: number; goal: Vec2; }

/** Extension contract only. Algorithm implementations are registered separately. */
export interface LabPipeline {
  readonly stats: ExperimentStats;
  readonly preferredX: Float64Array;
  readonly preferredY: Float64Array;
  readonly targets: readonly Vec2[];
  readonly available: Uint8Array;
  readonly navigators: readonly FlowField[];
  sample(agent: number, x: number, y: number, out: Vec2): boolean;
  step(current: AgentBuffer, next: AgentBuffer, step: number, densityScale: number): CrowdMovementResult;
}

export type PipelineFactory = (
  world: LabWorld,
  options: ExperimentOptions,
  primary: FlowField,
  overrides: ReadonlyMap<number, Vec2>,
  terrainVersion: number,
  previous?: LabPipeline,
) => LabPipeline;
