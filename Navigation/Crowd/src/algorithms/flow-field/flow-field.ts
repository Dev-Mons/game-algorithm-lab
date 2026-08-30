import type { CrowdField } from '../../core/crowd-field';
import { clamp } from '../../core/math';
import { distanceSquaredToRect, segmentDistanceSquaredToRect } from '../../core/obstacle-collision';
import type { GlobalNavigator, Rect, Vec2 } from '../../core/types';

const EPSILON = 1e-9;
const DIRECT_GOAL_DENSITY_FALLOFF = 0.1;
// Density is normalized by the pressure threshold. Once it exceeds the routing
// target by this span, congestion avoidance must keep the full obstacle-aware
// static progress instead of escaping through the crowd's rear.
const STATIC_PROGRESS_DENSITY_SPAN = 0.875;
const OFFSETS = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
] as const;

export interface DynamicFlowFieldOptions {
  densityScale: number;
  targetDensity: number;
  densityWeight: number;
  overloadWeight: number;
  counterFlowWeight: number;
  wallWeight: number;
  costSmoothing: number;
  directionHysteresis: number;
  maximumSpeed: number;
  directGoalLowDensity: number;
  directGoalCounterFlow: number;
  directGoalMinimumClearance: number;
}

/** Allocation-free indexed heap: one entry per navigation cell. */
class IndexedMinHeap {
  private readonly cells: Int32Array;
  private readonly priorities: Float64Array;
  private readonly positions: Int32Array;
  private length = 0;

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
    this.positions = new Int32Array(capacity);
    this.positions.fill(-1);
  }

  get size(): number { return this.length; }

  clear(): void {
    this.positions.fill(-1);
    this.length = 0;
  }

  pushOrDecrease(cell: number, priority: number): void {
    let index = this.positions[cell]!;
    if (index >= 0) {
      if (priority >= this.priorities[index]!) return;
      this.priorities[index] = priority;
    } else {
      index = this.length;
      this.length += 1;
      this.cells[index] = cell;
      this.priorities[index] = priority;
      this.positions[cell] = index;
    }
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.move(parent, index);
      index = parent;
    }
    this.cells[index] = cell;
    this.priorities[index] = priority;
    this.positions[cell] = index;
  }

  pop(): number {
    const cell = this.cells[0]!;
    this.positions[cell] = -1;
    this.length -= 1;
    if (this.length === 0) return cell;
    const lastCell = this.cells[this.length]!;
    const lastPriority = this.priorities[this.length]!;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.length) break;
      const right = left + 1;
      const child = right < this.length && this.priorities[right]! < this.priorities[left]!
        ? right
        : left;
      if (this.priorities[child]! >= lastPriority) break;
      this.move(child, index);
      index = child;
    }
    this.cells[index] = lastCell;
    this.priorities[index] = lastPriority;
    this.positions[lastCell] = index;
    return cell;
  }

  private move(from: number, to: number): void {
    const cell = this.cells[from]!;
    this.cells[to] = cell;
    this.priorities[to] = this.priorities[from]!;
    this.positions[cell] = to;
  }
}

/**
 * Per-goal static and dynamic flow data.
 *
 * Static buffers only change with geometry/goal. Crowd-derived costs and the
 * final integration field are updated independently at a lower cadence.
 */
export class FlowField implements GlobalNavigator {
  readonly columns: number;
  readonly rows: number;
  readonly cellCount: number;
  readonly blocked: Uint8Array;
  readonly staticClearance: Float64Array;
  readonly terrainCost: Float64Array;
  readonly staticPotential: Float64Array;
  readonly staticDirectionX: Float64Array;
  readonly staticDirectionY: Float64Array;
  readonly densityRatio: Float64Array;
  readonly counterFlowRatio: Float64Array;
  readonly dynamicDensityCost: Float64Array;
  readonly dynamicOverloadCost: Float64Array;
  readonly dynamicCounterFlowCost: Float64Array;
  readonly dynamicWallCost: Float64Array;
  readonly dynamicCostTarget: Float64Array;
  readonly dynamicTraversalCost: Float64Array;
  readonly dynamicPotential: Float64Array;
  readonly directionX: Float64Array;
  readonly directionY: Float64Array;
  /** Backward-compatible alias for the final potential. */
  readonly costs: Float64Array;
  goalCell = -1;
  clearance = 0;
  staticRebuildCount = 0;
  dynamicRebuildCount = 0;

  private goalX = 0;
  private goalY = 0;
  private obstacles: readonly Rect[] = [];
  private readonly heap: IndexedMinHeap;
  private readonly averageVelocity = { x: 0, y: 0 };
  private hasDynamicSample = false;
  private targetDensity = 1;
  private directGoalLowDensity = 0.35;
  private directGoalCounterFlow = 0.1;
  private directGoalMinimumClearance = 0;
  private readonly directGoalDirectionX: Float64Array;
  private readonly directGoalDirectionY: Float64Array;
  private readonly minimumDirectGoalProgress: Float64Array;
  private readonly staticProgressDrop: Float64Array;
  private readonly minimumDynamicStaticDrop: Float64Array;

  constructor(public readonly width: number, public readonly height: number, public readonly cellSize: number) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellCount = this.columns * this.rows;
    this.blocked = new Uint8Array(this.cellCount);
    this.staticClearance = new Float64Array(this.cellCount);
    this.terrainCost = new Float64Array(this.cellCount);
    this.staticPotential = new Float64Array(this.cellCount);
    this.staticDirectionX = new Float64Array(this.cellCount);
    this.staticDirectionY = new Float64Array(this.cellCount);
    this.densityRatio = new Float64Array(this.cellCount);
    this.counterFlowRatio = new Float64Array(this.cellCount);
    this.dynamicDensityCost = new Float64Array(this.cellCount);
    this.dynamicOverloadCost = new Float64Array(this.cellCount);
    this.dynamicCounterFlowCost = new Float64Array(this.cellCount);
    this.dynamicWallCost = new Float64Array(this.cellCount);
    this.dynamicCostTarget = new Float64Array(this.cellCount);
    this.dynamicTraversalCost = new Float64Array(this.cellCount);
    this.dynamicPotential = new Float64Array(this.cellCount);
    this.directionX = new Float64Array(this.cellCount);
    this.directionY = new Float64Array(this.cellCount);
    this.directGoalDirectionX = new Float64Array(this.cellCount);
    this.directGoalDirectionY = new Float64Array(this.cellCount);
    this.minimumDirectGoalProgress = new Float64Array(this.cellCount);
    this.staticProgressDrop = new Float64Array(this.cellCount);
    this.minimumDynamicStaticDrop = new Float64Array(this.cellCount);
    this.costs = this.dynamicPotential;
    this.heap = new IndexedMinHeap(this.cellCount);
  }

  rebuild(goal: Vec2, obstacles: readonly Rect[], clearance = 0): void {
    this.rebuildStatic(goal, obstacles, clearance);
  }

  rebuildStatic(goal: Vec2, obstacles: readonly Rect[], clearance = 0): void {
    this.clearance = Math.max(0, clearance);
    this.obstacles = obstacles;
    this.goalX = goal.x;
    this.goalY = goal.y;
    this.blocked.fill(0);
    for (const obstacle of obstacles) this.rasterizeObstacle(obstacle);
    const goalColumn = clamp(Math.floor(goal.x / this.cellSize), 0, this.columns - 1);
    const goalRow = clamp(Math.floor(goal.y / this.cellSize), 0, this.rows - 1);
    this.goalCell = goalRow * this.columns + goalColumn;
    this.blocked[this.goalCell] = 0;
    this.computeStaticTraversal();
    this.computePotential(this.terrainCost, this.staticPotential);
    this.computeDirections(this.staticPotential, this.staticDirectionX, this.staticDirectionY, 0, false);
    this.computeProgressReferences();
    this.resetDynamicToStatic();
    this.staticRebuildCount += 1;
  }

  rebuildDynamic(crowdField: CrowdField, options: DynamicFlowFieldOptions): void {
    const densityScale = Math.max(EPSILON, options.densityScale);
    const maximumSpeed = Math.max(EPSILON, options.maximumSpeed);
    const smoothing = clamp(options.costSmoothing, 0, 1);
    this.targetDensity = Math.max(0, options.targetDensity);
    this.directGoalLowDensity = Math.max(0, options.directGoalLowDensity);
    this.directGoalCounterFlow = Math.max(EPSILON, options.directGoalCounterFlow);
    this.directGoalMinimumClearance = Math.max(0, options.directGoalMinimumClearance);

    for (let row = 0; row < this.rows; row += 1) {
      const y = Math.min(this.height - EPSILON, (row + 0.5) * this.cellSize);
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (this.blocked[index] === 1) {
          this.densityRatio[index] = 0;
          this.counterFlowRatio[index] = 0;
          this.dynamicDensityCost[index] = 0;
          this.dynamicOverloadCost[index] = 0;
          this.dynamicCounterFlowCost[index] = 0;
          this.dynamicWallCost[index] = 0;
          this.dynamicCostTarget[index] = Number.POSITIVE_INFINITY;
          this.dynamicTraversalCost[index] = Number.POSITIVE_INFINITY;
          this.minimumDynamicStaticDrop[index] = 0;
          continue;
        }
        const x = Math.min(this.width - EPSILON, (column + 0.5) * this.cellSize);
        const density = crowdField.sampleDensity(x, y) / densityScale;
        crowdField.sampleAverageVelocity(x, y, this.averageVelocity);
        const routeX = this.staticDirectionX[index]!;
        const routeY = this.staticDirectionY[index]!;
        const counterFlow = Math.max(0, -(
          this.averageVelocity.x * routeX + this.averageVelocity.y * routeY
        ) / maximumSpeed);
        const overloadAge = crowdField.sampleOverloadAge(x, y);
        // Saturation keeps pathological complete-overlap inputs from creating
        // enormous potential deltas while preserving the quadratic response
        // throughout the normal operating range.
        const densityExcess = Math.min(1, Math.max(0, density - this.targetDensity));
        const densityCost = Math.max(0, options.densityWeight) * densityExcess * densityExcess;
        const overloadCost = Math.max(0, options.overloadWeight) * overloadAge;
        const counterFlowCost = Math.max(0, options.counterFlowWeight) * counterFlow;
        const clearanceCells = this.staticClearance[index]! / this.cellSize;
        const wallCost = Math.max(0, options.wallWeight) / Math.max(0.25, clearanceCells);
        const target = this.terrainCost[index]!
          + densityCost + overloadCost + counterFlowCost + wallCost;

        this.densityRatio[index] = density;
        this.counterFlowRatio[index] = counterFlow;
        this.dynamicDensityCost[index] = densityCost;
        this.dynamicOverloadCost[index] = overloadCost;
        this.dynamicCounterFlowCost[index] = counterFlowCost;
        this.dynamicWallCost[index] = wallCost;
        const denseBlend = clamp(
          (density - this.targetDensity) / STATIC_PROGRESS_DENSITY_SPAN,
          0,
          1,
        );
        this.minimumDynamicStaticDrop[index] = this.staticProgressDrop[index]! * denseBlend;
        this.dynamicCostTarget[index] = target;
        this.dynamicTraversalCost[index] = this.hasDynamicSample
          ? this.dynamicTraversalCost[index]! + (target - this.dynamicTraversalCost[index]!) * smoothing
          : target;
      }
    }
    this.computePotential(this.dynamicTraversalCost, this.dynamicPotential);
    // A dense footprint can make the cheapest unconstrained route leave through
    // the rear of its own crowd. Keep dynamic choices on an obstacle-safe,
    // statically progressing route while still comparing their crowd costs.
    this.computeDirections(
      this.dynamicPotential,
      this.directionX,
      this.directionY,
      Math.max(0, options.directionHysteresis),
      this.hasDynamicSample,
      true,
    );
    this.hasDynamicSample = true;
    this.dynamicRebuildCount += 1;
  }

  sampleDirection(x: number, y: number, out: Vec2): boolean {
    const gx = clamp(x / this.cellSize - 0.5, 0, this.columns - 1);
    const gy = clamp(y / this.cellSize - 0.5, 0, this.rows - 1);
    const column0 = Math.floor(gx);
    const row0 = Math.floor(gy);
    const column1 = Math.min(this.columns - 1, column0 + 1);
    const row1 = Math.min(this.rows - 1, row0 + 1);
    const tx = gx - column0;
    const ty = gy - row0;
    const weight00 = (1 - tx) * (1 - ty);
    const weight10 = tx * (1 - ty);
    const weight01 = (1 - tx) * ty;
    const weight11 = tx * ty;
    const index00 = row0 * this.columns + column0;
    const index10 = row0 * this.columns + column1;
    const index01 = row1 * this.columns + column0;
    const index11 = row1 * this.columns + column1;
    const fieldX = this.sampleStencil(
      this.directionX,
      index00, index10, index01, index11,
      weight00, weight10, weight01, weight11,
    );
    const fieldY = this.sampleStencil(
      this.directionY,
      index00, index10, index01, index11,
      weight00, weight10, weight01, weight11,
    );
    const fieldLength = Math.sqrt(fieldX * fieldX + fieldY * fieldY);
    if (fieldLength > EPSILON) {
      out.x = fieldX / fieldLength;
      out.y = fieldY / fieldLength;
    } else {
      out.x = 0;
      out.y = 0;
    }

    if (this.hasLineOfSight(x, y, this.goalX, this.goalY)) {
      const directX = this.goalX - x;
      const directY = this.goalY - y;
      const directLength = Math.sqrt(directX * directX + directY * directY);
      if (directLength > EPSILON) {
        const density = this.sampleStencil(
          this.densityRatio,
          index00, index10, index01, index11,
          weight00, weight10, weight01, weight11,
        );
        const counterFlow = this.sampleStencil(
          this.counterFlowRatio,
          index00, index10, index01, index11,
          weight00, weight10, weight01, weight11,
        );
        const localClearance = this.sampleStencil(
          this.staticClearance,
          index00, index10, index01, index11,
          weight00, weight10, weight01, weight11,
        );
        const densitySpan = Math.max(EPSILON, this.targetDensity - this.directGoalLowDensity);
        const densityExcess = Math.max(0, density - this.directGoalLowDensity);
        // Keep LOS steering continuous at high density. A hard zero exposes the
        // discrete grid direction all at once and can create synchronized bands.
        const densityBlend = 1 / (
          1 + densityExcess / densitySpan * DIRECT_GOAL_DENSITY_FALLOFF
        );
        const counterBlend = 1 - clamp(counterFlow / this.directGoalCounterFlow, 0, 1);
        const clearanceBlend = this.directGoalMinimumClearance <= EPSILON
          ? 1
          : clamp(localClearance / this.directGoalMinimumClearance, 0, 1);
        const directBlend = this.hasDynamicSample
          ? densityBlend * counterBlend * clearanceBlend
          : 1;
        const normalizedDirectX = directX / directLength;
        const normalizedDirectY = directY / directLength;
        const blendedX = out.x * (1 - directBlend) + normalizedDirectX * directBlend;
        const blendedY = out.y * (1 - directBlend) + normalizedDirectY * directBlend;
        const blendedLength = Math.sqrt(blendedX * blendedX + blendedY * blendedY);
        if (blendedLength > EPSILON) {
          out.x = blendedX / blendedLength;
          out.y = blendedY / blendedLength;
        }
      }
    }

    // Bilinear blending can point between two individually safe grid edges.
    const lookAhead = this.cellSize * 0.8;
    if (!this.isSegmentSafe(x, y, x + out.x * lookAhead, y + out.y * lookAhead)) {
      this.sampleSafeDiscreteDirection(x, y, lookAhead, out);
    }
    return out.x !== 0 || out.y !== 0;
  }

  isBlockedAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const column = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return this.blocked[row * this.columns + column] === 1;
  }

  /** Approximate remaining dynamic route cost for deterministic movement priority. */
  sampleCost(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return Number.POSITIVE_INFINITY;
    }
    const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
    const row = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    const cell = row * this.columns + column;
    const cost = this.dynamicPotential[cell]!;
    if (!Number.isFinite(cost)) return Number.POSITIVE_INFINITY;
    const centerX = (column + 0.5) * this.cellSize;
    const centerY = (row + 0.5) * this.cellSize;
    const withinCellProgress = (x - centerX) * this.directionX[cell]!
      + (y - centerY) * this.directionY[cell]!;
    return cost * this.cellSize - withinCellProgress
      + Math.hypot(this.goalX - x, this.goalY - y) * 1e-9;
  }

  isReachable(column: number, row: number): boolean {
    return Number.isFinite(this.staticPotential[row * this.columns + column]);
  }

  private resetDynamicToStatic(): void {
    this.densityRatio.fill(0);
    this.counterFlowRatio.fill(0);
    this.dynamicDensityCost.fill(0);
    this.dynamicOverloadCost.fill(0);
    this.dynamicCounterFlowCost.fill(0);
    this.dynamicWallCost.fill(0);
    this.dynamicCostTarget.set(this.terrainCost);
    this.dynamicTraversalCost.set(this.terrainCost);
    this.dynamicPotential.set(this.staticPotential);
    this.directionX.set(this.staticDirectionX);
    this.directionY.set(this.staticDirectionY);
    this.minimumDynamicStaticDrop.fill(0);
    this.hasDynamicSample = false;
  }

  private hasLineOfSight(startX: number, startY: number, endX: number, endY: number): boolean {
    return this.isSegmentSafe(startX, startY, endX, endY);
  }

  private isSegmentSafe(startX: number, startY: number, endX: number, endY: number): boolean {
    if (
      startX < this.clearance || startY < this.clearance
      || endX < this.clearance || endY < this.clearance
      || startX > this.width - this.clearance || startY > this.height - this.clearance
      || endX > this.width - this.clearance || endY > this.height - this.clearance
    ) return false;
    const clearanceSquared = this.clearance * this.clearance;
    for (const obstacle of this.obstacles) {
      const distanceSquared = segmentDistanceSquaredToRect(startX, startY, endX, endY, obstacle);
      if (clearanceSquared <= 1e-12 ? distanceSquared <= 1e-12 : distanceSquared < clearanceSquared - 1e-10) {
        return false;
      }
    }
    return true;
  }

  private sampleSafeDiscreteDirection(x: number, y: number, lookAhead: number, out: Vec2): void {
    const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
    const row = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    const cell = row * this.columns + column;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;
    for (const [dx, dy, movementCost] of OFFSETS) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (
        nextColumn < 0 || nextRow < 0
        || nextColumn >= this.columns || nextRow >= this.rows
      ) continue;
      const next = nextRow * this.columns + nextColumn;
      if (
        this.blocked[next] === 1
        || !this.preservesStaticProgress(cell, next, dx, dy, movementCost)
        || this.dynamicPotential[next]! >= bestCost
      ) continue;
      if (dx !== 0 && dy !== 0 && !this.diagonalIsOpen(column, row, nextColumn, nextRow)) continue;
      const scale = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
      const directionX = dx * scale;
      const directionY = dy * scale;
      if (!this.isSegmentSafe(
        x,
        y,
        x + directionX * lookAhead,
        y + directionY * lookAhead,
      )) continue;
      bestCost = this.dynamicPotential[next]!;
      bestX = directionX;
      bestY = directionY;
    }
    out.x = bestX;
    out.y = bestY;
  }

  private rasterizeObstacle(rect: Rect): void {
    const minimumX = rect.x - this.clearance;
    const maximumX = rect.x + rect.width + this.clearance;
    const minimumY = rect.y - this.clearance;
    const maximumY = rect.y + rect.height + this.clearance;
    const minColumn = clamp(Math.floor(minimumX / this.cellSize), 0, this.columns - 1);
    const maxColumn = clamp(Math.ceil(maximumX / this.cellSize) - 1, 0, this.columns - 1);
    const minRow = clamp(Math.floor(minimumY / this.cellSize), 0, this.rows - 1);
    const maxRow = clamp(Math.ceil(maximumY / this.cellSize) - 1, 0, this.rows - 1);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const centerX = (column + 0.5) * this.cellSize;
        const centerY = (row + 0.5) * this.cellSize;
        if (centerX < minimumX || centerX >= maximumX || centerY < minimumY || centerY >= maximumY) continue;
        this.blocked[row * this.columns + column] = 1;
      }
    }
  }

  private computeStaticTraversal(): void {
    for (let row = 0; row < this.rows; row += 1) {
      const y = Math.min(this.height - EPSILON, (row + 0.5) * this.cellSize);
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (this.blocked[index] === 1) {
          this.staticClearance[index] = 0;
          this.terrainCost[index] = Number.POSITIVE_INFINITY;
          continue;
        }
        const x = Math.min(this.width - EPSILON, (column + 0.5) * this.cellSize);
        let minimumClearance = Math.min(
          x - this.clearance,
          y - this.clearance,
          this.width - this.clearance - x,
          this.height - this.clearance - y,
        );
        for (const obstacle of this.obstacles) {
          minimumClearance = Math.min(
            minimumClearance,
            Math.sqrt(distanceSquaredToRect(x, y, obstacle)) - this.clearance,
          );
        }
        this.staticClearance[index] = Math.max(0, minimumClearance);
        this.terrainCost[index] = 1;
      }
    }
  }

  private computePotential(traversalCost: Float64Array, output: Float64Array): void {
    output.fill(Number.POSITIVE_INFINITY);
    output[this.goalCell] = 0;
    this.heap.clear();
    this.heap.pushOrDecrease(this.goalCell, 0);
    while (this.heap.size > 0) {
      const cell = this.heap.pop();
      const currentCost = output[cell]!;
      const column = cell % this.columns;
      const row = Math.floor(cell / this.columns);
      for (const [dx, dy, movementCost] of OFFSETS) {
        const nx = column + dx;
        const ny = row + dy;
        if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
        const next = ny * this.columns + nx;
        if (this.blocked[next] === 1) continue;
        if (dx !== 0 && dy !== 0 && !this.diagonalIsOpen(column, row, nx, ny)) continue;
        const edgeTraversal = (traversalCost[cell]! + traversalCost[next]!) * 0.5;
        const nextCost = currentCost + movementCost * edgeTraversal;
        if (nextCost < output[next]!) {
          output[next] = nextCost;
          this.heap.pushOrDecrease(next, nextCost);
        }
      }
    }
  }

  private computeDirections(
    potential: Float64Array,
    outputX: Float64Array,
    outputY: Float64Array,
    hysteresis: number,
    retainPrevious: boolean,
    preserveStaticProgress = false,
  ): void {
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const cell = row * this.columns + column;
        const previousX = outputX[cell]!;
        const previousY = outputY[cell]!;
        if (this.blocked[cell] === 1 || !Number.isFinite(potential[cell]) || cell === this.goalCell) {
          outputX[cell] = 0;
          outputY[cell] = 0;
          continue;
        }
        let bestCost = preserveStaticProgress
          ? Number.POSITIVE_INFINITY
          : potential[cell]!;
        let bestX = 0;
        let bestY = 0;
        for (const [dx, dy, movementCost] of OFFSETS) {
          const nx = column + dx;
          const ny = row + dy;
          if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
          const next = ny * this.columns + nx;
          if (this.blocked[next] === 1) continue;
          if (dx !== 0 && dy !== 0 && !this.diagonalIsOpen(column, row, nx, ny)) continue;
          if (
            preserveStaticProgress
            && !this.preservesStaticProgress(cell, next, dx, dy, movementCost)
          ) {
            continue;
          }
          if (potential[next]! < bestCost) {
            bestCost = potential[next]!;
            bestX = dx;
            bestY = dy;
          }
        }
        if (retainPrevious && (previousX !== 0 || previousY !== 0)) {
          const previousColumn = column + Math.round(previousX);
          const previousRow = row + Math.round(previousY);
          if (
            previousColumn >= 0 && previousRow >= 0
            && previousColumn < this.columns && previousRow < this.rows
          ) {
            const previousCell = previousRow * this.columns + previousColumn;
            const previousCost = potential[previousCell]!;
            if (
              this.blocked[previousCell] === 0
              && (!preserveStaticProgress
                || this.preservesStaticProgress(
                  cell,
                  previousCell,
                  Math.round(previousX),
                  Math.round(previousY),
                  previousX !== 0 && previousY !== 0 ? Math.SQRT2 : 1,
                ))
              && (preserveStaticProgress || previousCost < potential[cell]!)
              && previousCost <= bestCost + hysteresis
            ) {
              outputX[cell] = previousX;
              outputY[cell] = previousY;
              continue;
            }
          }
        }
        const scale = bestX !== 0 && bestY !== 0 ? Math.SQRT1_2 : 1;
        outputX[cell] = bestX * scale;
        outputY[cell] = bestY * scale;
      }
    }
  }

  private diagonalIsOpen(column: number, row: number, nextColumn: number, nextRow: number): boolean {
    return this.blocked[row * this.columns + nextColumn] === 0
      && this.blocked[nextRow * this.columns + column] === 0;
  }

  private computeProgressReferences(): void {
    for (let row = 0; row < this.rows; row += 1) {
      const centerY = Math.min(this.height - EPSILON, (row + 0.5) * this.cellSize);
      for (let column = 0; column < this.columns; column += 1) {
        const cell = row * this.columns + column;
        const centerX = Math.min(this.width - EPSILON, (column + 0.5) * this.cellSize);
        const goalX = this.goalX - centerX;
        const goalY = this.goalY - centerY;
        const goalLength = Math.hypot(goalX, goalY);
        if (goalLength > EPSILON) {
          this.directGoalDirectionX[cell] = goalX / goalLength;
          this.directGoalDirectionY[cell] = goalY / goalLength;
          this.minimumDirectGoalProgress[cell] = Math.min(0,
            this.staticDirectionX[cell]! * this.directGoalDirectionX[cell]!
              + this.staticDirectionY[cell]! * this.directGoalDirectionY[cell]!,
          );
        } else {
          this.directGoalDirectionX[cell] = 0;
          this.directGoalDirectionY[cell] = 0;
          this.minimumDirectGoalProgress[cell] = -1;
        }

        if (
          this.blocked[cell] === 1
          || !Number.isFinite(this.staticPotential[cell])
          || cell === this.goalCell
        ) {
          this.staticProgressDrop[cell] = 0;
          continue;
        }
        const staticColumn = column + Math.round(this.staticDirectionX[cell]!);
        const staticRow = row + Math.round(this.staticDirectionY[cell]!);
        if (
          staticColumn < 0 || staticRow < 0
          || staticColumn >= this.columns || staticRow >= this.rows
        ) {
          this.staticProgressDrop[cell] = 0;
          continue;
        }
        const staticNext = staticRow * this.columns + staticColumn;
        this.staticProgressDrop[cell] = Math.max(
          0,
          this.staticPotential[cell]! - this.staticPotential[staticNext]!,
        );
      }
    }
  }

  private preservesStaticProgress(
    cell: number,
    next: number,
    dx: number,
    dy: number,
    movementCost: number,
  ): boolean {
    const currentPotential = this.staticPotential[cell]!;
    const candidateDrop = currentPotential - this.staticPotential[next]!;
    if (
      candidateDrop <= EPSILON
      || candidateDrop + EPSILON < this.minimumDynamicStaticDrop[cell]!
    ) return false;

    const candidateGoalProgress = (
      dx * this.directGoalDirectionX[cell]!
      + dy * this.directGoalDirectionY[cell]!
    ) / movementCost;
    return candidateGoalProgress + EPSILON >= this.minimumDirectGoalProgress[cell]!;
  }

  private sampleStencil(
    buffer: Float64Array,
    index00: number,
    index10: number,
    index01: number,
    index11: number,
    weight00: number,
    weight10: number,
    weight01: number,
    weight11: number,
  ): number {
    return buffer[index00]! * weight00
      + buffer[index10]! * weight10
      + buffer[index01]! * weight01
      + buffer[index11]! * weight11;
  }
}
