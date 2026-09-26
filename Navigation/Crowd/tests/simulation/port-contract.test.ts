import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CrowdKernel, parseCrowdRun, runCrowdReplay, snapshotCrowd } from '../../src/core';
import { applyCrowdCommand, type CrowdRunInput, type CrowdRunOutput } from '../../src/core/port-contract';

const root = new URL('../../porting/fixtures/', import.meta.url);
const files = readdirSync(root).filter(name => name !== 'manifest.json' && name.endsWith('.json'));
type Fixture = CrowdRunInput & { expected: CrowdRunOutput; referenceHashes: Array<{ tick: number; hash: string }> };
function fixture(name = 'open-goal.json'): Fixture { return JSON.parse(readFileSync(new URL(name, root), 'utf8')); }

describe('native port contract against the pre-extraction solver', () => {
  it('preserves the frozen evidence bytes', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as { files: Record<string, string> };
    expect(files.sort()).toEqual(Object.keys(manifest.files).sort());
    for (const name of files) expect(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex')).toBe(manifest.files[name]);
  });

  it.each(files)('reproduces every exported number and legacy hash: %s', name => {
    const run = fixture(name);
    expect(runCrowdReplay(run)).toEqual(run.expected);
    const kernel = new CrowdKernel({ ...run.config }, run.initial.agents.length);
    kernel.initialize(run.initial);
    for (const reference of run.referenceHashes) {
      while (kernel.stepCount < reference.tick) {
        for (const command of run.commands) if (command.tick === kernel.stepCount) applyCrowdCommand(kernel, command);
        kernel.step();
      }
      expect(kernel.stateHash()).toBe(reference.hash);
    }
  });

  it('owns initialization and output data and preserves reset generations', () => {
    const run = fixture();
    const kernel = new CrowdKernel({ ...run.config }, run.initial.agents.length);
    expect(() => kernel.step()).toThrow(/Initialize/);
    kernel.initialize(run.initial);
    const before = snapshotCrowd(kernel);
    const initialX = kernel.state.x[0];
    run.initial.agents[0]!.x += 100;
    run.initial.flows[0]!.goal.x = 1;
    before.agents[0]!.x = -1;
    before.goals[0]!.x = -1;
    expect(kernel.state.x[0]).toBe(initialX);
    expect(kernel.goals[0]!.x).not.toBe(1);
    expect(kernel.goals[0]!.x).not.toBe(-1);
    kernel.enqueueExternal({kind:'impulse', id:'hit', tick:0, generation:1, target:{agent:0}, dvx:5, dvy:0});
    kernel.step();
    kernel.initialize(fixture().initial);
    expect(kernel.external.generation).toBe(2);
    expect(kernel.external.record()).toEqual([]);
    expect(snapshotCrowd(kernel)).toEqual(fixture().expected.frames[0]);
    expect(() => kernel.enqueueExternal({kind:'impulse', id:'stale', tick:0, generation:1, target:{agent:0}, dvx:5, dvy:0})).toThrow(/Stale/);
  });

  it('rejects malformed cross-language inputs before replay', () => {
    const missing = fixture() as unknown as { config: Record<string, unknown> };
    delete missing.config.fixedDelta;
    expect(() => parseCrowdRun(missing)).toThrow(/fixedDelta/);
    const unknown = fixture() as unknown as { config: Record<string, unknown> };
    unknown.config.preset = 'legacy';
    expect(() => parseCrowdRun(unknown)).toThrow(/Unknown config/);
    delete unknown.config.preset;
    Object.defineProperty(unknown.config, 'toString', { value: 1, enumerable: true });
    expect(() => parseCrowdRun(unknown)).toThrow(/Unknown config/);
    const duplicate = fixture(); duplicate.initial.agents[1]!.id = duplicate.initial.agents[0]!.id;
    expect(() => parseCrowdRun(duplicate)).toThrow(/duplicate agent/);
    const badFlow = fixture(); badFlow.initial.agents[0]!.flow = 65536;
    expect(() => parseCrowdRun(badFlow)).toThrow(/agent flow/);
    const nonfinite = fixture(); nonfinite.initial.agents[0]!.vx = Infinity;
    expect(() => parseCrowdRun(nonfinite)).toThrow(/agent.vx/);
    const ticks = fixture(); ticks.checkpoints = [0, 20, 10];
    expect(() => parseCrowdRun(ticks)).toThrow(/increasing/);
    const wrongGeneration = fixture('external.json');
    const command = wrongGeneration.commands[0]!;
    if (command.kind === 'external') command.input.generation = 2;
    expect(() => parseCrowdRun(wrongGeneration)).toThrow(/generation 1/);
  });

  it('accepts inactive and empty populations without inventing live bodies', () => {
    const run = fixture();
    const kernel = new CrowdKernel({ ...run.config }, run.initial.agents.length);
    for (const agent of run.initial.agents) agent.active = 0;
    kernel.initialize(run.initial);
    expect(kernel.metrics.activeCount).toBe(0);
    kernel.step();
    expect(kernel.metrics.activeCount).toBe(0);
    kernel.initialize({ ...run.initial, agents: [] });
    kernel.step();
    expect(kernel.metrics.arrivalRate).toBe(0);
    expect(snapshotCrowd(kernel).agents).toEqual([]);
  });
});
