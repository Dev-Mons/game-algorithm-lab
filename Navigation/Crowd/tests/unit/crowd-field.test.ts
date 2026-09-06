import { describe, expect, it } from 'vitest';
import { AgentBuffer } from '../../src/core/agent-state';
import { CrowdField } from '../../src/core/crowd-field';

describe('CrowdField', () => {
  it('preserves one active Agent bilinear density and momentum weight', () => {
    const field = new CrowdField(96, 96, 16);
    const state = agents(2);
    setAgent(state, 0, 29, 37, 12, -4, 1, 0);
    state.active[1] = 0;

    field.update(state, 8, 1 / 60);

    expect(sum(field.density)).toBeCloseTo(1, 12);
    expect(sum(field.momentumX)).toBeCloseTo(12, 12);
    expect(sum(field.momentumY)).toBeCloseTo(-4, 12);
  });

  it('preserves mass when deposits touch blocked cells and boundaries', () => {
    const field = new CrowdField(96, 96, 16);
    field.setObstacles([{x: 32, y: 16, width: 32, height: 64}], 0);
    const state = agents(3);
    setAgent(state, 0, 31, 47, 12, -4, 1, 0);
    setAgent(state, 1, 0, 0, 12, -4, 1, 0);
    setAgent(state, 2, 95.99, 95.99, 12, -4, 1, 0);
    field.update(state, 8, 1/60);
    expect(sum(field.density)).toBeCloseTo(3, 12);
    expect(sum(field.momentumX)).toBeCloseTo(36, 12);
    for (let cell = 0; cell < field.cellCount; cell++) {
      if (field.blocked[cell]) expect(field.density[cell]).toBe(0);
    }
  });

  it('reports counter-flow relative to the requested desired direction', () => {
    const field = new CrowdField(64, 64, 16);
    const state = agents(2);
    setAgent(state, 0, 32, 32, 10, 0, 1, 0);
    setAgent(state, 1, 32, 32, -30, 0, -1, 0);
    field.update(state, 8, 1 / 60);

    expect(field.sampleCounterFlow(32, 32, 1, 0)).toBeCloseTo(10, 10);
    expect(field.sampleCounterFlow(32, 32, -1, 0)).toBe(0);
  });

  it('keeps blocked and boundary samples finite while aging overloads', () => {
    const field = new CrowdField(64, 64, 16);
    field.setObstacles([{ x: 24, y: 24, width: 16, height: 16 }], 1);
    const state = agents(12);
    for (let agent = 0; agent < state.count; agent += 1) {
      setAgent(state, agent, agent % 2 === 0 ? 0 : 63.999, 0, 1, 2, 1, 0);
    }
    field.update(state, 0.1, 1 / 60);
    field.update(state, 0.1, 1 / 60);
    const velocity = { x: 0, y: 0 };
    field.sampleAverageVelocity(-100, 1000, velocity);

    expect(Number.isFinite(velocity.x)).toBe(true);
    expect(Number.isFinite(velocity.y)).toBe(true);
    expect(field.overloadedCellCount).toBeGreaterThan(0);
    expect(field.maximumOverloadAge).toBeCloseTo(2 / 60, 12);
  });
});

function agents(count: number): AgentBuffer {
  return new AgentBuffer(count);
}

function setAgent(
  state: AgentBuffer,
  agent: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  intentX: number,
  intentY: number,
): void {
  state.x[agent] = x;
  state.y[agent] = y;
  state.vx[agent] = vx;
  state.vy[agent] = vy;
  state.intentX[agent] = intentX;
  state.intentY[agent] = intentY;
  state.active[agent] = 1;
}

function sum(values: Float64Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
