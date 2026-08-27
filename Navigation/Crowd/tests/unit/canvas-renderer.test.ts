import { describe, expect, it, vi } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { CanvasRenderer } from '../../src/rendering/canvas-renderer';
import { DEFAULT_DEBUG_OPTIONS } from '../../src/rendering/debug-drawing';
import { getScenario } from '../../src/scenarios/scenarios';

describe('CanvasRenderer', () => {
  it('interpolates previous/current fixed-step positions without changing simulation state', () => {
    const simulation = new CrowdSimulation(
      { ...DEFAULT_CONFIG, agentCount: 1, seed: 42 },
      getScenario('open-field'),
    );
    simulation.step();
    const previousX = simulation.previousState.x[0]!;
    const previousY = simulation.previousState.y[0]!;
    const currentX = simulation.state.x[0]!;
    const currentY = simulation.state.y[0]!;
    const arcs: Array<[number, number, number]> = [];
    const gradient = { addColorStop: vi.fn() };
    const context = {
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn((x: number, y: number, radius: number) => arcs.push([x, y, radius])),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: DEFAULT_CONFIG.width,
      height: DEFAULT_CONFIG.height,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const debug = {
      ...DEFAULT_DEBUG_OPTIONS,
      recovery: false,
      overlaps: false,
      stalled: false,
    };
    const renderer = new CanvasRenderer(canvas, () => simulation, debug);
    const hash = simulation.stateHash();

    renderer.render(0.5);

    const agentArc = arcs.find(([, , radius]) => radius === simulation.config.agentRadius);
    expect(agentArc).toBeDefined();
    expect(agentArc![0]).toBeCloseTo((previousX + currentX) * 0.5, 10);
    expect(agentArc![1]).toBeCloseTo((previousY + currentY) * 0.5, 10);
    expect(simulation.stateHash()).toBe(hash);
  });
});
