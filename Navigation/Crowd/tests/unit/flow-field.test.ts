import { describe, expect, it } from 'vitest';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import type { DynamicFlowFieldOptions } from '../../src/algorithms/flow-field/flow-field';
import { CrowdField } from '../../src/core/crowd-field';
import { segmentDistanceSquaredToRect } from '../../src/core/obstacle-collision';

describe('Reverse Dijkstra Flow Field', () => {
  it('always points to a lower integration cost on reachable cells', () => {
    const field = new FlowField(100, 100, 10);
    field.rebuild({ x: 95, y: 55 }, [{ x: 40, y: 20, width: 10, height: 60 }]);
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.columns; column += 1) {
        const index = row * field.columns + column;
        if (field.blocked[index] === 1 || !Number.isFinite(field.costs[index]) || index === field.goalCell) continue;
        const dx = Math.round(field.directionX[index]!);
        const dy = Math.round(field.directionY[index]!);
        const next = (row + dy) * field.columns + column + dx;
        expect(field.costs[next]).toBeLessThan(field.costs[index]!);
      }
    }
  });

  it('never creates a direction into an impassable cell', () => {
    const field = new FlowField(80, 80, 10);
    field.rebuild({ x: 75, y: 45 }, [{ x: 30, y: 10, width: 20, height: 60 }]);
    for (let row = 0; row < field.rows; row += 1) {
      for (let column = 0; column < field.columns; column += 1) {
        const index = row * field.columns + column;
        const dx = Math.round(field.directionX[index]!);
        const dy = Math.round(field.directionY[index]!);
        if (dx === 0 && dy === 0) continue;
        const next = (row + dy) * field.columns + column + dx;
        expect(field.blocked[next]).toBe(0);
      }
    }
  });

  it('distinguishes reachable and unreachable cells', () => {
    const field = new FlowField(100, 100, 10);
    field.rebuild({ x: 85, y: 50 }, [{ x: 40, y: 0, width: 20, height: 100 }]);
    expect(field.isReachable(8, 5)).toBe(true);
    expect(field.isReachable(1, 5)).toBe(false);
    expect(field.isReachable(4, 5)).toBe(false);
  });

  it('keeps sampled directions outside the radius-expanded blocked area', () => {
    const obstacle = { x: 50, y: 20, width: 20, height: 60 };
    const clearance = 4;
    const field = new FlowField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, [obstacle], clearance);
    const direction = { x: 0, y: 0 };
    for (let y = 5; y < 100; y += 5) {
      for (let x = 5; x < 120; x += 5) {
        if (field.isBlockedAt(x, y) || !field.sampleDirection(x, y, direction)) continue;
        expect(segmentDistanceSquaredToRect(
          x,
          y,
          x + direction.x * 8,
          y + direction.y * 8,
          obstacle,
        )).toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
      }
    }
  });

  it('rejects a bilinear direction whose exact look-ahead crosses clearance geometry', () => {
    const obstacle = { x: 50, y: 20, width: 20, height: 60 };
    const clearance = 4;
    const field = new FlowField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, [obstacle], clearance);
    const direction = { x: 0, y: 0 };
    const startX = 63.5;
    const startY = 15.7;

    field.sampleDirection(startX, startY, direction);

    expect(segmentDistanceSquaredToRect(
      startX,
      startY,
      startX + direction.x * 8,
      startY + direction.y * 8,
      obstacle,
    )).toBeGreaterThanOrEqual(clearance * clearance - 1e-9);
  });

  it('keeps static buffers unchanged while rebuilding separate crowd costs and potential', () => {
    const field = new FlowField(120, 100, 10);
    const crowd = new CrowdField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, [], 2);
    const staticPotential = new Float64Array(field.staticPotential);
    const staticClearance = new Float64Array(field.staticClearance);
    const congested = 5 * crowd.columns + 6;
    crowd.density[congested] = 4;
    crowd.overloadAge[congested] = 3;

    field.rebuildDynamic(crowd, dynamicOptions({
      densityScale: 1,
      densityWeight: 2,
      overloadWeight: 0.5,
    }));

    expect(field.staticPotential).toEqual(staticPotential);
    expect(field.staticClearance).toEqual(staticClearance);
    expect(field.dynamicDensityCost[congested]).toBe(2);
    expect(field.dynamicOverloadCost[congested]).toBe(1.5);
    expect(field.dynamicTraversalCost[congested]).toBeGreaterThan(field.terrainCost[congested]!);
    expect(field.dynamicPotential[5 * field.columns + 1]).toBeGreaterThan(
      field.staticPotential[5 * field.columns + 1]!,
    );
    expect(field.staticRebuildCount).toBe(1);
    expect(field.dynamicRebuildCount).toBe(1);
  });

  it('computes counter-flow with the sign of each goal route independently', () => {
    const crowd = new CrowdField(120, 100, 10);
    crowd.averageVelocityX.fill(50);
    const eastbound = new FlowField(120, 100, 10);
    const westbound = new FlowField(120, 100, 10);
    eastbound.rebuild({ x: 115, y: 50 }, []);
    westbound.rebuild({ x: 5, y: 50 }, []);

    const options = dynamicOptions({ maximumSpeed: 100, counterFlowWeight: 2 });
    eastbound.rebuildDynamic(crowd, options);
    westbound.rebuildDynamic(crowd, options);
    const sample = 5 * crowd.columns + 6;

    expect(eastbound.counterFlowRatio[sample]).toBe(0);
    expect(eastbound.dynamicCounterFlowCost[sample]).toBe(0);
    expect(westbound.counterFlowRatio[sample]).toBeCloseTo(0.5);
    expect(westbound.dynamicCounterFlowCost[sample]).toBeCloseTo(1);
  });

  it('routes around the congested gate and keeps near-tie updates stable', () => {
    const obstacles = [
      { x: 50, y: 0, width: 10, height: 20 },
      { x: 50, y: 40, width: 10, height: 20 },
      { x: 50, y: 80, width: 10, height: 20 },
    ];
    const field = new FlowField(120, 100, 10);
    const crowd = new CrowdField(120, 100, 10);
    field.rebuild({ x: 115, y: 50 }, obstacles);
    const direction = { x: 0, y: 0 };
    const options = dynamicOptions({
      densityWeight: 12,
      costSmoothing: 0.25,
      directionHysteresis: 0.75,
    });
    setGateDensity(crowd, 2, 3, 4);
    field.rebuildDynamic(crowd, options);
    field.sampleDirection(15, 50, direction);
    expect(direction.y).toBeGreaterThan(0);

    let previousSign = Math.sign(direction.y);
    let switches = 0;
    for (let rebuild = 0; rebuild < 8; rebuild += 1) {
      crowd.density.fill(0);
      if ((rebuild & 1) === 0) setGateDensity(crowd, 6, 7, 4.05);
      else setGateDensity(crowd, 2, 3, 4.05);
      field.rebuildDynamic(crowd, options);
      field.sampleDirection(15, 50, direction);
      const sign = Math.sign(direction.y);
      if (sign !== 0 && previousSign !== 0 && sign !== previousSign) switches += 1;
      if (sign !== 0) previousSign = sign;
    }
    expect(switches).toBeLessThanOrEqual(2);
  });

  it('uses the same local direct-goal gate in empty and congested fields', () => {
    const field = new FlowField(120, 100, 10);
    const crowd = new CrowdField(120, 100, 10);
    field.rebuild({ x: 115, y: 55 }, []);
    const direction = { x: 0, y: 0 };
    field.rebuildDynamic(crowd, dynamicOptions());
    field.sampleDirection(15, 50, direction);
    const directY = 5 / Math.hypot(100, 5);
    expect(direction.y).toBeCloseTo(directY, 6);

    for (let column = 1; column <= 9; column += 1) {
      crowd.density[5 * crowd.columns + column] = 5;
    }
    field.rebuildDynamic(crowd, dynamicOptions({ densityWeight: 8, costSmoothing: 1 }));
    field.sampleDirection(15, 50, direction);
    expect(Math.abs(direction.y - directY)).toBeGreaterThan(0.005);
    expect(direction.x).toBeGreaterThan(0);
  });

  it('does not escape a dense crowd through the rear of the static route', () => {
    const field = new FlowField(120, 100, 10);
    const crowd = new CrowdField(120, 100, 10);
    field.rebuild({ x: 115, y: 55 }, []);
    for (let row = 2; row <= 7; row += 1) {
      for (let column = 2; column <= 9; column += 1) {
        crowd.density[row * crowd.columns + column] = 5;
      }
    }
    crowd.averageVelocityX.fill(-100);
    field.rebuildDynamic(crowd, dynamicOptions({
      densityWeight: 12,
      counterFlowWeight: 2,
      costSmoothing: 1,
    }));

    const cell = 5 * field.columns + 2;
    const nextColumn = 2 + Math.round(field.directionX[cell]!);
    const nextRow = 5 + Math.round(field.directionY[cell]!);
    const next = nextRow * field.columns + nextColumn;
    const direction = { x: 0, y: 0 };
    field.sampleDirection(25, 55, direction);

    expect(field.directionX[cell]).toBeGreaterThan(0);
    expect(field.staticPotential[next]).toBeLessThan(field.staticPotential[cell]!);
    expect(direction.x).toBeGreaterThan(0);
  });
});

function dynamicOptions(
  overrides: Partial<DynamicFlowFieldOptions> = {},
): DynamicFlowFieldOptions {
  return {
    densityScale: 1,
    targetDensity: 1,
    densityWeight: 0,
    overloadWeight: 0,
    counterFlowWeight: 0,
    wallWeight: 0,
    costSmoothing: 1,
    directionHysteresis: 0,
    maximumSpeed: 100,
    directGoalLowDensity: 0.25,
    directGoalCounterFlow: 0.1,
    directGoalMinimumClearance: 0,
    ...overrides,
  };
}

function setGateDensity(
  crowd: CrowdField,
  minimumRow: number,
  maximumRow: number,
  density: number,
): void {
  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = 4; column <= 6; column += 1) {
      crowd.density[row * crowd.columns + column] = density;
    }
  }
}
