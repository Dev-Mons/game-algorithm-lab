import { clamp, normalize } from '../../core/math';
import type { GlobalNavigator, Rect, Vec2 } from '../../core/types';

const OFFSETS = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
] as const;

class MinHeap {
  private cells: number[] = [];
  private priorities: number[] = [];

  get size(): number { return this.cells.length; }

  push(cell: number, priority: number): void {
    let index = this.cells.length;
    this.cells.push(cell);
    this.priorities.push(priority);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.cells[index] = this.cells[parent]!;
      this.priorities[index] = this.priorities[parent]!;
      index = parent;
    }
    this.cells[index] = cell;
    this.priorities[index] = priority;
  }

  pop(): [number, number] {
    const cell = this.cells[0]!;
    const priority = this.priorities[0]!;
    const lastCell = this.cells.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.cells.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        if (left >= this.cells.length) break;
        const right = left + 1;
        const child = right < this.cells.length && this.priorities[right]! < this.priorities[left]! ? right : left;
        if (this.priorities[child]! >= lastPriority) break;
        this.cells[index] = this.cells[child]!;
        this.priorities[index] = this.priorities[child]!;
        index = child;
      }
      this.cells[index] = lastCell;
      this.priorities[index] = lastPriority;
    }
    return [cell, priority];
  }
}

export class FlowField implements GlobalNavigator {
  readonly columns: number;
  readonly rows: number;
  readonly costs: Float64Array;
  readonly blocked: Uint8Array;
  readonly directionX: Float64Array;
  readonly directionY: Float64Array;
  goalCell = -1;

  constructor(public readonly width: number, public readonly height: number, public readonly cellSize: number) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const count = this.columns * this.rows;
    this.costs = new Float64Array(count);
    this.blocked = new Uint8Array(count);
    this.directionX = new Float64Array(count);
    this.directionY = new Float64Array(count);
  }

  rebuild(goal: Vec2, obstacles: readonly Rect[]): void {
    this.blocked.fill(0);
    for (const obstacle of obstacles) this.rasterizeObstacle(obstacle);
    const goalColumn = clamp(Math.floor(goal.x / this.cellSize), 0, this.columns - 1);
    const goalRow = clamp(Math.floor(goal.y / this.cellSize), 0, this.rows - 1);
    this.goalCell = goalRow * this.columns + goalColumn;
    this.blocked[this.goalCell] = 0;
    this.computeCosts();
    this.computeDirections();
  }

  sampleDirection(x: number, y: number, out: Vec2): boolean {
    const gx = clamp(x / this.cellSize - 0.5, 0, this.columns - 1);
    const gy = clamp(y / this.cellSize - 0.5, 0, this.rows - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(this.columns - 1, x0 + 1);
    const y1 = Math.min(this.rows - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;
    const i00 = y0 * this.columns + x0;
    const i10 = y0 * this.columns + x1;
    const i01 = y1 * this.columns + x0;
    const i11 = y1 * this.columns + x1;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    const dx = this.directionX[i00]! * w00 + this.directionX[i10]! * w10 + this.directionX[i01]! * w01 + this.directionX[i11]! * w11;
    const dy = this.directionY[i00]! * w00 + this.directionY[i10]! * w10 + this.directionY[i01]! * w01 + this.directionY[i11]! * w11;
    normalize(dx, dy, out);
    // Interpolation smooths turns, but near obstacle boundaries it can blend two
    // valid vectors into an invalid direction. Fall back to the source cell's
    // discrete safe direction when a short look-ahead enters a blocked cell.
    if (this.isBlockedAt(x + out.x * this.cellSize * 0.8, y + out.y * this.cellSize * 0.8)) {
      const column = clamp(Math.floor(x / this.cellSize), 0, this.columns - 1);
      const row = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
      const index = row * this.columns + column;
      out.x = this.directionX[index]!;
      out.y = this.directionY[index]!;
    }
    return out.x !== 0 || out.y !== 0;
  }

  isBlockedAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const column = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    return this.blocked[row * this.columns + column] === 1;
  }

  isReachable(column: number, row: number): boolean {
    return Number.isFinite(this.costs[row * this.columns + column]);
  }

  private rasterizeObstacle(rect: Rect): void {
    const minColumn = clamp(Math.floor(rect.x / this.cellSize), 0, this.columns - 1);
    const maxColumn = clamp(Math.ceil((rect.x + rect.width) / this.cellSize) - 1, 0, this.columns - 1);
    const minRow = clamp(Math.floor(rect.y / this.cellSize), 0, this.rows - 1);
    const maxRow = clamp(Math.ceil((rect.y + rect.height) / this.cellSize) - 1, 0, this.rows - 1);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        this.blocked[row * this.columns + column] = 1;
      }
    }
  }

  private computeCosts(): void {
    this.costs.fill(Number.POSITIVE_INFINITY);
    this.costs[this.goalCell] = 0;
    const heap = new MinHeap();
    heap.push(this.goalCell, 0);
    while (heap.size > 0) {
      const [cell, currentCost] = heap.pop();
      if (currentCost !== this.costs[cell]) continue;
      const column = cell % this.columns;
      const row = Math.floor(cell / this.columns);
      for (const [dx, dy, movementCost] of OFFSETS) {
        const nx = column + dx;
        const ny = row + dy;
        if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
        const next = ny * this.columns + nx;
        if (this.blocked[next] === 1) continue;
        if (dx !== 0 && dy !== 0) {
          if (this.blocked[row * this.columns + nx] === 1 || this.blocked[ny * this.columns + column] === 1) continue;
        }
        const nextCost = currentCost + movementCost;
        if (nextCost < this.costs[next]!) {
          this.costs[next] = nextCost;
          heap.push(next, nextCost);
        }
      }
    }
  }

  private computeDirections(): void {
    this.directionX.fill(0);
    this.directionY.fill(0);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const cell = row * this.columns + column;
        if (this.blocked[cell] === 1 || !Number.isFinite(this.costs[cell]) || cell === this.goalCell) continue;
        let bestCost = this.costs[cell]!;
        let bestX = 0;
        let bestY = 0;
        for (const [dx, dy] of OFFSETS) {
          const nx = column + dx;
          const ny = row + dy;
          if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
          const next = ny * this.columns + nx;
          if (this.blocked[next] === 1) continue;
          if (dx !== 0 && dy !== 0 && (this.blocked[row * this.columns + nx] === 1 || this.blocked[ny * this.columns + column] === 1)) continue;
          if (this.costs[next]! < bestCost) {
            bestCost = this.costs[next]!;
            bestX = dx;
            bestY = dy;
          }
        }
        const scale = bestX !== 0 && bestY !== 0 ? Math.SQRT1_2 : 1;
        this.directionX[cell] = bestX * scale;
        this.directionY[cell] = bestY * scale;
      }
    }
  }
}
