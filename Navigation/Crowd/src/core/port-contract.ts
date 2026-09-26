import { CrowdKernel } from './crowd-kernel';
import { DEFAULT_CROWD_CONFIG } from './config';
import { validateInitialState, type CrowdInitialState, type CrowdAgentInput } from './kernel-input';
import type { CrowdConfig, Rect, Vec2 } from './types';
import type { ExternalInput } from './external-influences';

export const PORT_FIXTURE_SCHEMA = 'crowd-port-fixture-v1';
export const PORT_OUTPUT_SCHEMA = 'crowd-port-output-v1';
export const AGENT_STATE_FIELDS = ['x', 'y', 'vx', 'vy', 'active', 'stalledFor', 'intentX', 'intentY', 'heading'] as const;

/** Commands apply before the transition tick -> tick + 1, in array order. */
export type CrowdCommand = { tick: number } & (
  | { kind: 'goal'; x: number; y: number }
  | { kind: 'obstacles'; obstacles: Rect[] }
  | { kind: 'external'; input: ExternalInput }
);
export interface CrowdRunInput {
  schema: typeof PORT_FIXTURE_SCHEMA;
  id: string;
  config: CrowdConfig;
  initial: CrowdInitialState;
  commands: CrowdCommand[];
  checkpoints: number[];
}
export interface CrowdFrame {
  tick: number;
  goals: Vec2[];
  agents: Required<CrowdAgentInput>[];
}
export interface CrowdRunOutput {
  schema: typeof PORT_OUTPUT_SCHEMA;
  id: string;
  frames: CrowdFrame[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** JSON boundary validation. Solver-specific input limits are checked on dispatch. */
export function parseCrowdRun(value: unknown): CrowdRunInput {
  if (!object(value) || value.schema !== PORT_FIXTURE_SCHEMA || typeof value.id !== 'string' || !value.id
    || !object(value.config) || !object(value.initial) || !Array.isArray(value.commands) || !Array.isArray(value.checkpoints)) {
    throw new TypeError('Invalid crowd-port-fixture-v1 envelope.');
  }
  for (const [key, defaultValue] of Object.entries(DEFAULT_CROWD_CONFIG)) {
    const field = value.config[key];
    if (typeof field !== typeof defaultValue || (typeof field === 'number' && !Number.isFinite(field))) {
      throw new TypeError(`Missing or invalid config.${key}`);
    }
  }
  // Unknown configuration options must not silently select a different model.
  for (const key of Object.keys(value.config)) {
    if (!Object.hasOwn(DEFAULT_CROWD_CONFIG, key)) throw new TypeError(`Unknown config.${key}`);
  }
  const run = value as unknown as CrowdRunInput;
  validateInitialState(run.initial, run.config, run.initial.agents?.length ?? 0);
  if (!run.checkpoints.length || run.checkpoints[0] !== 0) throw new RangeError('Checkpoints must start at tick 0.');
  for (let i = 0; i < run.checkpoints.length; i++) {
    const tick = run.checkpoints[i]!;
    if (!Number.isSafeInteger(tick) || tick < 0 || (i > 0 && tick <= run.checkpoints[i - 1]!)) {
      throw new RangeError('Checkpoints must be strictly increasing nonnegative integers.');
    }
  }
  let previousTick = -1;
  for (const command of run.commands) {
    if (!object(command) || !Number.isSafeInteger(command.tick) || command.tick < previousTick
      || command.tick < 0 || command.tick >= run.checkpoints.at(-1)!) throw new RangeError('Invalid command tick/order.');
    previousTick = command.tick;
    if (command.kind === 'goal') {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) throw new RangeError('Invalid goal command.');
    } else if (command.kind === 'obstacles') {
      if (!Array.isArray(command.obstacles) || command.obstacles.some(rect => !object(rect)
        || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0)) {
        throw new RangeError('Invalid obstacle command.');
      }
    } else if (command.kind === 'external') {
      if (!object(command.input) || command.input.tick !== command.tick || command.input.generation !== 1) {
        throw new RangeError('External command requires the same tick and generation 1.');
      }
    } else throw new RangeError('Unknown crowd command.');
  }
  return run;
}

export function applyCrowdCommand(kernel: CrowdKernel, command: CrowdCommand): void {
  if (command.tick !== kernel.stepCount) throw new RangeError('Command does not match the current tick.');
  switch (command.kind) {
    case 'goal': kernel.setGoal(command.x, command.y); break;
    case 'obstacles': kernel.updateObstacles(command.obstacles); break;
    case 'external': kernel.enqueueExternal(command.input); break;
    default: throw new RangeError('Unknown crowd command.');
  }
}

/** Owned observations, never a resumable checkpoint or a view into mutable buffers. */
export function snapshotCrowd(kernel: CrowdKernel): CrowdFrame {
  return {
    tick: kernel.stepCount,
    goals: kernel.goals.map(goal => ({ ...goal })),
    agents: Array.from({ length: kernel.state.count }, (_, i) => ({
      id: kernel.agentIds[i]!, flow: kernel.agentFlow[i]!, radius: kernel.agentRadii[i]!,
      x: kernel.state.x[i]!, y: kernel.state.y[i]!, vx: kernel.state.vx[i]!, vy: kernel.state.vy[i]!,
      active: kernel.state.active[i]!, stalledFor: kernel.state.stalledFor[i]!,
      intentX: kernel.state.intentX[i]!, intentY: kernel.state.intentY[i]!, heading: kernel.state.heading[i]!,
    })),
  };
}

export function runCrowdReplay(input: unknown): CrowdRunOutput {
  const run = parseCrowdRun(input);
  const kernel = new CrowdKernel({ ...run.config }, run.initial.agents.length);
  kernel.initialize(run.initial);
  const frames = [snapshotCrowd(kernel)];
  let command = 0, checkpoint = 1;
  while (kernel.stepCount < run.checkpoints.at(-1)!) {
    while (command < run.commands.length && run.commands[command]!.tick === kernel.stepCount) {
      applyCrowdCommand(kernel, run.commands[command++]!);
    }
    kernel.step();
    if (kernel.stepCount === run.checkpoints[checkpoint]) {
      frames.push(snapshotCrowd(kernel));
      checkpoint++;
    }
  }
  kernel.dispose();
  return { schema: PORT_OUTPUT_SCHEMA, id: run.id, frames };
}
