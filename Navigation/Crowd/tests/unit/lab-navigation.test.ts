import { describe, expect, it } from 'vitest';
import { GridAStar } from '../../src/algorithms/lab/grid-astar';
import { GateQueue } from '../../src/algorithms/lab/traffic';
import { PRESETS, resolveExperiment } from '../../src/algorithms/lab/registry';
import { AgentBuffer } from '../../src/core/agent-state';

describe('experimental navigation and traffic contracts', () => {
  it('A* detours around a wall with disc-safe edges and stable results', () => {
    const grid = new GridAStar(200, 200, 10, 4, [{ x: 90, y: 0, width: 20, height: 130 }]);
    const from = { x: 20, y: 50 }; const to = { x: 180, y: 50 };
    const route = grid.find(from, to);
    expect(route.length).toBeGreaterThan(1);
    expect(route).toEqual(grid.find(from, to));
    let previous = from;
    for (const point of route) { expect(grid.isSegmentSafe(previous.x, previous.y, point.x, point.y)).toBe(true); previous = point; }
    expect(route.at(-1)).toEqual(to);
  });
  it('clearance classes reject bodies wider than a doorway without a through-wall fallback', () => {
    const walls = [{ x: 94, y: 0, width: 12, height: 90 }, { x: 94, y: 110, width: 12, height: 90 }];
    expect(new GridAStar(200, 200, 5, 4, walls).find({ x: 30, y: 100 }, { x: 170, y: 100 }).length).toBeGreaterThan(0);
    expect(new GridAStar(200, 200, 5, 12, walls).find({ x: 30, y: 100 }, { x: 170, y: 100 })).toEqual([]);
  });
  it('unknown modes and incompatible layer combinations fail at the execution boundary', () => {
    expect(() => resolveExperiment({ preset: 'missing' })).toThrow();
    expect(() => resolveExperiment({ preset: 'legacy', experiment: { density: true } })).toThrow();
    expect(() => resolveExperiment({ preset: 'B0', experiment: { congestion: true } })).toThrow();
    expect(() => resolveExperiment({ preset: 'B1', experiment: { steering: 'formation' } })).toThrow();
    expect(() => resolveExperiment({ preset: 'B0', experiment: { planner: 'fake' as 'shared-flow' } })).toThrow();
    const b0 = PRESETS.find((p) => p.id === 'B0')!.options;
    const b1 = PRESETS.find((p) => p.id === 'B1')!.options;
    expect({ ...b0, planner: b1.planner }).toEqual(b1);
  });
  it('reservation timeout cannot release a physical occupant, including a retained arrival', () => {
    const state = new AgentBuffer(2); state.x.set([105, 145]); state.y.set([50, 50]); state.active.set([0, 1]);
    const queue = new GateQueue([{ id: 'door', region: { x: 100, y: 30, width: 20, height: 40 }, capacity: 1 }], 200, 100, 2);
    const goals = [{ x: 180, y: 50 }, { x: 20, y: 50 }];
    const radii = new Float64Array([4, 4]); const px = new Float64Array(2); const py = new Float64Array(2); const stopped = new Uint8Array(2);
    queue.apply(state, radii, goals, px, py, 0, 30, 1 / 60, stopped, true);
    queue.apply(state, radii, goals, px, py, 500, 30, 1 / 60, stopped, true);
    expect(queue.reservations()).toEqual([0]);
    state.x[0] = 130;
    queue.apply(state, radii, goals, px, py, 501, 30, 1 / 60, stopped, true);
    expect(queue.reservations()).toEqual([1]); expect(queue.passed).toBe(1);
  });
  it('requires downstream room and does not count a retreat as passage', () => {
    const state = new AgentBuffer(2); state.x.set([80, 132]); state.y.set([50, 50]); state.active.set([1, 0]);
    const queue = new GateQueue([{ id: 'door', region: { x: 100, y: 30, width: 20, height: 40 }, capacity: 1 }], 200, 100, 2);
    const goals = [{ x: 180, y: 50 }, { x: 180, y: 50 }]; const radii = new Float64Array([4, 4]);
    const px = new Float64Array(2); const py = new Float64Array(2); const stopped = new Uint8Array(2);
    queue.apply(state, radii, goals, px, py, 0, 30, 1 / 60, stopped, true);
    expect(queue.reservations()).toEqual([]);
    state.x[1] = 170;
    queue.apply(state, radii, goals, px, py, 1, 30, 1 / 60, stopped, true);
    expect(queue.reservations()).toEqual([0]);
    state.x[0] = 110; queue.apply(state, radii, goals, px, py, 2, 30, 1 / 60, stopped, true);
    state.x[0] = 80; queue.apply(state, radii, goals, px, py, 3, 30, 1 / 60, stopped, true);
    expect(queue.passed).toBe(0);
  });
  it('holds the opposing front behind the exit pocket while an admitted batch clears', () => {
    const state = new AgentBuffer(2); state.x.set([80, 146]); state.y.set([50, 50]); state.active.fill(1);
    const queue = new GateQueue([{ id: 'door', region: { x: 100, y: 30, width: 20, height: 40 }, capacity: 1 }], 220, 100, 2);
    const goals = [{ x: 200, y: 50 }, { x: 20, y: 50 }]; const radii = new Float64Array([4, 4]);
    const px = new Float64Array([30, -30]); const py = new Float64Array(2); const stopped = new Uint8Array(2);
    queue.apply(state, radii, goals, px, py, 0, 30, 1 / 60, stopped);
    expect(queue.reservations()).toEqual([0]);
    expect(stopped[1]).toBe(1);
    expect(Math.abs(px[1]!)).toBe(0);
  });
});
