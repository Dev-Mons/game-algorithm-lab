import type { CrowdConfig, Rect, Vec2 } from './types';
import { validateGoalRegions } from './goal-regions';

/** Array order is the stable solver index for the entire session. IDs are host metadata. */
export interface CrowdAgentInput {
  id: string;
  flow: number;
  radius: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Portion of vx/vy caused by physical pushing; omitted means ordinary walking. */
  pushVx?: number;
  pushVy?: number;
  active?: number;
  stalledFor?: number;
  intentX?: number;
  intentY?: number;
  heading?: number;
}

export interface CrowdInitialState {
  flows: ReadonlyArray<{ id: string; goal: Vec2 }>;
  obstacles: readonly Rect[];
  goalRegions?: readonly Rect[];
  /** Larger bodies share this conservative clearance class. */
  maxAgentRadius: number;
  agents: readonly CrowdAgentInput[];
}

export function validateCrowdConfig(config: CrowdConfig): void {
  if (config.parallelRouting !== undefined && typeof config.parallelRouting !== 'boolean') {
    throw new TypeError('config.parallelRouting must be boolean.');
  }
  if (config.fluidRouting !== undefined && typeof config.fluidRouting !== 'boolean') {
    throw new TypeError('config.fluidRouting must be boolean.');
  }
  if (config.adaptiveTurning !== undefined && typeof config.adaptiveTurning !== 'boolean') {
    throw new TypeError('config.adaptiveTurning must be boolean.');
  }
  if (config.corridorRouting !== undefined && typeof config.corridorRouting !== 'boolean') {
    throw new TypeError('config.corridorRouting must be boolean.');
  }
  if (config.excessSpeedHalfLife !== undefined
    && (!Number.isFinite(config.excessSpeedHalfLife) || config.excessSpeedHalfLife < 0)) {
    throw new RangeError('config.excessSpeedHalfLife must be finite and nonnegative.');
  }
  if (config.preserveBlockedGoal !== undefined && typeof config.preserveBlockedGoal !== 'boolean') {
    throw new TypeError('config.preserveBlockedGoal must be boolean.');
  }
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError(`Nonfinite config.${key}`);
  }
  for (const key of ['width', 'height', 'navCellSize', 'crowdFieldCellSize', 'contactCellSize', 'agentRadius', 'fixedDelta'] as const) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new RangeError(`config.${key} must be positive.`);
  }
}

export function validateInitialState(initial: CrowdInitialState, config: CrowdConfig, capacity: number): void {
  validateCrowdConfig(config);
  validateGoalRegions(initial.goalRegions === undefined ? [] : initial.goalRegions, config.width, config.height);
  if (!Array.isArray(initial.agents) || initial.agents.length > capacity) throw new RangeError('Initial agents exceed capacity.');
  if (!Array.isArray(initial.flows) || initial.flows.length < 1 || initial.flows.length > 65536) throw new RangeError('Invalid flow count.');
  if (!Number.isFinite(initial.maxAgentRadius) || initial.maxAgentRadius < config.agentRadius) throw new RangeError('Invalid maximum radius.');
  const flowIds = new Set<string>();
  for (const flow of initial.flows) {
    if (typeof flow.id !== 'string' || !flow.id || flowIds.has(flow.id)
      || !Number.isFinite(flow.goal.x) || !Number.isFinite(flow.goal.y)) throw new RangeError('Invalid or duplicate flow.');
    flowIds.add(flow.id);
  }
  if (!Array.isArray(initial.obstacles)) throw new RangeError('Invalid obstacles.');
  for (const rect of initial.obstacles) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width < 0 || rect.height < 0) throw new RangeError('Invalid obstacle geometry.');
  }
  const ids = new Set<string>();
  for (const agent of initial.agents) {
    if (typeof agent.id !== 'string' || !agent.id || ids.has(agent.id)) throw new RangeError('Invalid or duplicate agent ID.');
    ids.add(agent.id);
    if (!Number.isInteger(agent.flow) || agent.flow < 0 || agent.flow >= initial.flows.length) throw new RangeError('Invalid agent flow.');
    if (!Number.isFinite(agent.radius) || agent.radius <= 0 || agent.radius > initial.maxAgentRadius) throw new RangeError('Invalid agent radius.');
    if (!Number.isFinite(agent.x) || !Number.isFinite(agent.y)) throw new RangeError('Invalid agent position.');
    for (const key of ['vx', 'vy', 'pushVx', 'pushVy', 'stalledFor', 'intentX', 'intentY', 'heading'] as const) {
      if (agent[key] !== undefined && !Number.isFinite(agent[key])) throw new RangeError(`Invalid agent.${key}`);
    }
    if (agent.active !== undefined && agent.active !== 0 && agent.active !== 1) throw new RangeError('Invalid active flag.');
    if ((agent.stalledFor ?? 0) < 0) throw new RangeError('Negative stalled duration.');
  }
}
