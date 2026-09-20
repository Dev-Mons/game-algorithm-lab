import type { NeighborIndex } from '../../core/types';

export class SpatialHash implements NeighborIndex {
  readonly columns: number;
  readonly rows: number;
  readonly cellStart: Int32Array;
  readonly agentIndices: Int32Array;
  private readonly cursor: Int32Array;
  readonly populations: Int32Array;

  constructor(width: number, height: number, public readonly cellSize: number, capacity: number) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellStart = new Int32Array(this.columns * this.rows + 1);
    this.cursor = new Int32Array(this.columns * this.rows);
    this.populations = new Int32Array(this.columns * this.rows);
    this.agentIndices = new Int32Array(capacity);
  }

  rebuild(x: Float64Array, y: Float64Array, active: Uint8Array): void {
    this.populations.fill(0);
    for (let i = 0; i < x.length; i++) {
      if (active[i] !== 1) continue;
      const cell = this.cellIndex(x[i]!, y[i]!);
      this.populations[cell] = this.populations[cell]! + 1;
    }
    this.cellStart[0] = 0;
    for (let cell = 0; cell < this.populations.length; cell++) {
      this.cellStart[cell + 1] = this.cellStart[cell]! + this.populations[cell]!;
      this.cursor[cell] = this.cellStart[cell]!;
    }
    // Stable descending IDs preserve the existing deterministic query order.
    // GPU mapping: count, exclusive scan, stable scatter / radix sort.
    for (let i = x.length - 1; i >= 0; i--) {
      if (active[i] !== 1) continue;
      const cell = this.cellIndex(x[i]!, y[i]!);
      this.agentIndices[this.cursor[cell]!] = i;
      this.cursor[cell] = this.cursor[cell]! + 1;
    }
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
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = row * this.columns + column;
        for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
          visit(this.agentIndices[slot]!);
        }
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
          for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
            output[count++] = this.agentIndices[slot]!;
            if (count === limit) return count;
          }
        }
      }
      if (bottom !== top && bottom <= maxRow) {
        for (let column = Math.max(left, minColumn); column <= Math.min(right, maxColumn); column += 1) {
          const cell = bottom * this.columns + column;
          for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
            output[count++] = this.agentIndices[slot]!;
            if (count === limit) return count;
          }
        }
      }
      for (let row = Math.max(top + 1, minRow); row <= Math.min(bottom - 1, maxRow); row += 1) {
        if (left >= minColumn) {
          const cell = row * this.columns + left;
          for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
            output[count++] = this.agentIndices[slot]!;
            if (count === limit) return count;
          }
        }
        if (right !== left && right <= maxColumn) {
          const cell = row * this.columns + right;
          for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
            output[count++] = this.agentIndices[slot]!;
            if (count === limit) return count;
          }
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
    for (let slot = this.cellStart[cell]!; slot < this.cellStart[cell + 1]!; slot++) {
      if (!visit(this.agentIndices[slot]!)) return false;
    }
    return true;
  }

  private cellIndex(x: number, y: number): number {
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor(x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    return row * this.columns + column;
  }
}
