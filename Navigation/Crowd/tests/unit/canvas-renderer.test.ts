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
    const moveTo = vi.fn();
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
      moveTo,
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
    expect(moveTo).toHaveBeenCalledWith(
      agentArc![0] + simulation.config.agentRadius,
      agentArc![1],
    );
    expect(simulation.stateHash()).toBe(hash);
  });

  it('composites very large crowds once and bounds overlap warning markers', () => {
    const simulation = new CrowdSimulation(
      {
        ...DEFAULT_CONFIG,
        agentCount: 6_000,
        agentRadius: 1.5,
        agentGap: 0.05,
      },
      getScenario('open-field'),
    );
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const layerContext = {
      createImageData: vi.fn((width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      })),
      putImageData,
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => layerContext),
    } as unknown as HTMLCanvasElement;
    const ownerDocument = {
      createElement: vi.fn(() => layer),
    } as unknown as Document;
    const gradient = { addColorStop: vi.fn() };
    const context = {
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      fillRect,
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      drawImage,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: DEFAULT_CONFIG.width,
      height: DEFAULT_CONFIG.height,
      ownerDocument,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const debug = Object.fromEntries(
      Object.keys(DEFAULT_DEBUG_OPTIONS).map((key) => [key, false]),
    ) as unknown as typeof DEFAULT_DEBUG_OPTIONS;
    debug.overlaps = true;
    simulation.overlapFlags.fill(1);
    const renderer = new CanvasRenderer(canvas, () => simulation, debug);

    renderer.render(1);

    expect(simulation.state.count).toBe(6_000);
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(fillRect).toHaveBeenCalledTimes(1 + 1_000);
    const image = putImageData.mock.calls[0]![0] as ImageData;
    expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });
});
