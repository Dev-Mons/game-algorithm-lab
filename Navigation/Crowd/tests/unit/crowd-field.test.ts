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

  it('produces symmetric gradients for symmetric deposits', () => {
    const field = new CrowdField(112, 112, 16);
    const state = agents(40);
    for (let agent = 0; agent < state.count; agent += 1) {
      const left = agent % 2 === 0;
      setAgent(state, agent, left ? 40 : 72, 56, 0, 0, 1, 0);
    }
    field.update(state, 0.5, 1 / 60);
    const left = { x: 0, y: 0 };
    const right = { x: 0, y: 0 };
    field.samplePressureGradient(32, 56, left);
    field.samplePressureGradient(80, 56, right);

    expect(left.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(0);
    expect(left.x).toBeCloseTo(-right.x, 10);
    expect(left.y).toBeCloseTo(-right.y, 10);
  });

  it('keeps an internal uniform density gradient near zero', () => {
    const field = new CrowdField(112, 112, 16);
    const state = agents(25);
    let agent = 0;
    for (let row = 1; row <= 5; row += 1) {
      for (let column = 1; column <= 5; column += 1) {
        setAgent(state, agent, (column + 0.5) * 16, (row + 0.5) * 16, 0, 0, 1, 0);
        agent += 1;
      }
    }
    field.update(state, 0.25, 1 / 60);
    const gradient = { x: 0, y: 0 };
    field.samplePressureGradient(56, 56, gradient);

    expect(gradient.x).toBeCloseTo(0, 12);
    expect(gradient.y).toBeCloseTo(0, 12);
  });

  it('points the pressure descent away from a dense center', () => {
    const field = new CrowdField(112, 112, 16);
    const state = agents(64);
    for (let agent = 0; agent < state.count; agent += 1) {
      setAgent(state, agent, 56, 56, 0, 0, 1, 0);
    }
    field.update(state, 1, 1 / 60);
    const left = { x: 0, y: 0 };
    const right = { x: 0, y: 0 };
    field.samplePressureGradient(40, 56, left);
    field.samplePressureGradient(72, 56, right);

    expect(-left.x).toBeLessThan(0);
    expect(-right.x).toBeGreaterThan(0);
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
    const gradient = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    field.samplePressureGradient(32, 32, gradient);
    field.sampleAverageVelocity(-100, 1000, velocity);

    expect(Number.isFinite(gradient.x)).toBe(true);
    expect(Number.isFinite(gradient.y)).toBe(true);
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
