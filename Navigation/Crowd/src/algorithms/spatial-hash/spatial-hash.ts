import type { NeighborIndex } from '../../core/types';

const INLINE_CAPACITY = 4;

export class SpatialHash implements NeighborIndex {
  readonly columns: number;
  readonly rows: number;
  private readonly inlineIndices: Int32Array;
  private readonly tails: Int32Array;
  private readonly overflowNext: Int32Array;
  private packedStarts?: Int32Array;
  private packedIndices?: Int32Array;
  readonly populations: Int32Array;

  constructor(width: number, height: number, public readonly cellSize: number, capacity: number) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.populations = new Int32Array(this.columns * this.rows);
    this.inlineIndices = new Int32Array(this.populations.length * INLINE_CAPACITY);
    this.tails = new Int32Array(this.populations.length);
    this.overflowNext = new Int32Array(capacity);
  }

  rebuild(x: Float64Array, y: Float64Array, active: Uint8Array): void {
    this.populations.fill(0);
    // TinyDead's inline cells avoid a prefix scan and second position pass.
    // Append overflow in descending ID order: bounded contact selection must
    // remain identical even when a cell contains more than the query budget.
    for (let i = x.length - 1; i >= 0; i--) {
      if (active[i] !== 1) continue;
      const cell = this.cellIndex(x[i]!, y[i]!);
      const slot = this.populations[cell]!;
      this.populations[cell] = slot + 1;
      if (slot < INLINE_CAPACITY) {
        this.inlineIndices[cell * INLINE_CAPACITY + slot] = i;
      } else {
        this.overflowNext[this.tails[cell]!] = i;
      }
      this.tails[cell] = i;
      this.overflowNext[i] = -1;
    }
    if (this.packedStarts) this.updatePackedView();
  }

  // Preserve the diagnostic packed-array API, including retained array views.
  // Runtime queries never request it and therefore pay no scan/scatter cost.
  get cellStart(): Int32Array {
    this.ensurePackedView();
    return this.packedStarts!;
  }

  get agentIndices(): Int32Array {
    this.ensurePackedView();
    return this.packedIndices!;
  }

  private ensurePackedView(): void {
    if (this.packedStarts) return;
    this.packedStarts = new Int32Array(this.populations.length + 1);
    this.packedIndices = new Int32Array(this.overflowNext.length);
    this.updatePackedView();
  }

  private updatePackedView(): void {
    let count = 0;
    for (let cell = 0; cell < this.populations.length; cell++) {
      this.packedStarts![cell] = count;
      count = this.writeCell(cell, this.packedIndices!, count, this.packedIndices!.length);
    }
    this.packedStarts![this.populations.length] = count;
  }

  populationAt(x: number, y: number): number {
    return this.populations[this.cellIndex(x, y)]!;
  }

  maximumPopulationNear(x: number, y: number): number {
    const centerColumn = Math.max(
      0,
      Math.min(this.columns - 1, Math.floor(x / this.cellSize)),
    );
    const centerRow = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(y / this.cellSize)),
    );
    let maximum = 0;
    for (let row = Math.max(0, centerRow - 1); row <= Math.min(this.rows - 1, centerRow + 1); row += 1) {
      for (
        let column = Math.max(0, centerColumn - 1);
        column <= Math.min(this.columns - 1, centerColumn + 1);
        column += 1
      ) {
        maximum = Math.max(maximum, this.populations[row * this.columns + column]!);
      }
    }
    return maximum;
  }

  forEachCandidate(x: number, y: number, radius: number, visit: (index: number) => void): void {
    const minColumn = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    const visitAll = (index: number): boolean => { visit(index); return true; };
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        this.visitCellUntil(column, row, visitAll);
      }
    }
  }

  /** Bounded variant used by overload-safe local queries. */
  forEachCandidateUntil(
    x: number,
    y: number,
    radius: number,
    visit: (index: number) => boolean,
  ): void {
    const minColumn = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    const centerColumn = Math.max(minColumn, Math.min(maxColumn, Math.floor(x / this.cellSize)));
    const centerRow = Math.max(minRow, Math.min(maxRow, Math.floor(y / this.cellSize)));
    const maximumRing = Math.max(
      centerColumn - minColumn,
      maxColumn - centerColumn,
      centerRow - minRow,
      maxRow - centerRow,
    );
    // A bounded query must see local cells first. Row-major traversal from the
    // query AABB corner can exhaust its budget before reaching the center.
    for (let ring = 0; ring <= maximumRing; ring += 1) {
      const left = centerColumn - ring;
      const right = centerColumn + ring;
      const top = centerRow - ring;
      const bottom = centerRow + ring;
      if (top >= minRow) {
        for (let column = Math.max(left, minColumn); column <= Math.min(right, maxColumn); column += 1) {
          if (!this.visitCellUntil(column, top, visit)) return;
        }
      }
      if (bottom !== top && bottom <= maxRow) {
        for (let column = Math.max(left, minColumn); column <= Math.min(right, maxColumn); column += 1) {
          if (!this.visitCellUntil(column, bottom, visit)) return;
        }
      }
      for (let row = Math.max(top + 1, minRow); row <= Math.min(bottom - 1, maxRow); row += 1) {
        if (left >= minColumn && !this.visitCellUntil(left, row, visit)) return;
        if (right !== left && right <= maxColumn && !this.visitCellUntil(right, row, visit)) return;
      }
    }
  }

  /**
   * Writes candidates into a caller-owned buffer in the same center-first order
   * as `forEachCandidateUntil`. Hot simulation paths use this form to avoid one
   * JavaScript callback invocation for every visited candidate.
   */
  queryCandidates(
    x: number,
    y: number,
    radius: number,
    output: Int32Array,
    maximumCount = output.length,
  ): number {
    const limit = Math.min(output.length, Math.max(0, Math.trunc(maximumCount)));
    if (limit === 0) return 0;
    const minColumn = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxColumn = Math.min(this.columns - 1, Math.floor((x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));
    const centerColumn = Math.max(minColumn, Math.min(maxColumn, Math.floor(x / this.cellSize)));
    const centerRow = Math.max(minRow, Math.min(maxRow, Math.floor(y / this.cellSize)));
    const maximumRing = Math.max(
      centerColumn - minColumn,
      maxColumn - centerColumn,
      centerRow - minRow,
      maxRow - centerRow,
    );
    let count = 0;
    for (let ring = 0; ring <= maximumRing; ring += 1) {
      const left = centerColumn - ring;
      const right = centerColumn + ring;
      const top = centerRow - ring;
      const bottom = centerRow + ring;
      if (top >= minRow) {
        for (let column = Math.max(left, minColumn); column <= Math.min(right, maxColumn); column += 1) {
          const cell = top * this.columns + column;
          count = this.writeCell(cell, output, count, limit);
          if (count === limit) return count;
        }
      }
      if (bottom !== top && bottom <= maxRow) {
        for (let column = Math.max(left, minColumn); column <= Math.min(right, maxColumn); column += 1) {
          const cell = bottom * this.columns + column;
          count = this.writeCell(cell, output, count, limit);
          if (count === limit) return count;
        }
      }
      for (let row = Math.max(top + 1, minRow); row <= Math.min(bottom - 1, maxRow); row += 1) {
        if (left >= minColumn) {
          const cell = row * this.columns + left;
          count = this.writeCell(cell, output, count, limit);
          if (count === limit) return count;
        }
        if (right !== left && right <= maxColumn) {
          const cell = row * this.columns + right;
          count = this.writeCell(cell, output, count, limit);
          if (count === limit) return count;
        }
      }
    }
    return count;
  }

  private visitCellUntil(
    column: number,
    row: number,
    visit: (index: number) => boolean,
  ): boolean {
    const cell = row * this.columns + column;
    const population = this.populations[cell]!;
    const base = cell * INLINE_CAPACITY;
    for (let slot = 0; slot < Math.min(population, INLINE_CAPACITY); slot++) {
      if (!visit(this.inlineIndices[base + slot]!)) return false;
    }
    if (population > INLINE_CAPACITY) {
      for (let agent = this.overflowNext[this.inlineIndices[base + INLINE_CAPACITY - 1]!]!;
        agent >= 0; agent = this.overflowNext[agent]!) {
        if (!visit(agent)) return false;
      }
    }
    return true;
  }

  private writeCell(cell: number, output: Int32Array, count: number, limit: number): number {
    const population = this.populations[cell]!;
    const base = cell * INLINE_CAPACITY;
    const end = Math.min(population, INLINE_CAPACITY, limit - count);
    for (let slot = 0; slot < end; slot++) output[count++] = this.inlineIndices[base + slot]!;
    if (population > INLINE_CAPACITY && count < limit) {
      for (let agent = this.overflowNext[this.inlineIndices[base + INLINE_CAPACITY - 1]!]!;
        agent >= 0 && count < limit; agent = this.overflowNext[agent]!) output[count++] = agent;
    }
    return count;
  }

  private cellIndex(x: number, y: number): number {
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor(x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    return row * this.columns + column;
  }
}
