/**
 * Uniform grid whose entries occupy every cell touched by a swept AABB.
 *
 * Routine density/following queries use the ordinary point hash. This index is
 * dedicated to predictive collision candidates, so a long horizon does not
 * require a large isotropic radius around every agent. Buffers grow only when
 * configuration capacity proves insufficient and are then reused.
 */
export class SweptSpatialHash {
  readonly columns: number;
  readonly rows: number;
  readonly heads: Int32Array;
  private next: Int32Array;
  private entries: Int32Array;
  private readonly visited: Uint32Array;
  private visitGeneration = 0;
  private entryCount = 0;

  constructor(
    width: number,
    height: number,
    private readonly cellSize: number,
    capacity: number,
  ) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.heads = new Int32Array(this.columns * this.rows);
    this.next = new Int32Array(Math.max(1, capacity * 16));
    this.entries = new Int32Array(Math.max(1, capacity * 16));
    this.visited = new Uint32Array(capacity);
  }

  rebuild(
    x: Float64Array,
    y: Float64Array,
    velocityX: Float64Array,
    velocityY: Float64Array,
    active: Uint8Array,
    horizon: number,
    expansion: number,
  ): void {
    this.heads.fill(-1);
    this.entryCount = 0;
    for (let agent = 0; agent < x.length; agent += 1) {
      if (active[agent] !== 1) continue;
      const endX = x[agent]! + velocityX[agent]! * horizon;
      const endY = y[agent]! + velocityY[agent]! * horizon;
      const minColumn = this.column(Math.min(x[agent]!, endX) - expansion);
      const maxColumn = this.column(Math.max(x[agent]!, endX) + expansion);
      const minRow = this.row(Math.min(y[agent]!, endY) - expansion);
      const maxRow = this.row(Math.max(y[agent]!, endY) + expansion);
      this.ensureEntryCapacity(
        this.entryCount + (maxColumn - minColumn + 1) * (maxRow - minRow + 1),
      );
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const cell = row * this.columns + column;
          this.entries[this.entryCount] = agent;
          this.next[this.entryCount] = this.heads[cell]!;
          this.heads[cell] = this.entryCount;
          this.entryCount += 1;
        }
      }
    }
  }

  forEachCandidate(
    agent: number,
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
    horizon: number,
    expansion: number,
    visit: (candidate: number) => void,
  ): void {
    this.visitGeneration = (this.visitGeneration + 1) >>> 0;
    if (this.visitGeneration === 0) {
      this.visited.fill(0);
      this.visitGeneration = 1;
    }
    const endX = x + velocityX * horizon;
    const endY = y + velocityY * horizon;
    const minColumn = this.column(Math.min(x, endX) - expansion);
    const maxColumn = this.column(Math.max(x, endX) + expansion);
    const minRow = this.row(Math.min(y, endY) - expansion);
    const maxRow = this.row(Math.max(y, endY) + expansion);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        let entry = this.heads[row * this.columns + column]!;
        while (entry !== -1) {
          const candidate = this.entries[entry]!;
          entry = this.next[entry]!;
          if (candidate === agent || this.visited[candidate] === this.visitGeneration) continue;
          this.visited[candidate] = this.visitGeneration;
          visit(candidate);
        }
      }
    }
  }

  /** Bounded variant used when a pathological contact cluster saturates a query. */
  forEachCandidateUntil(
    agent: number,
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
    horizon: number,
    expansion: number,
    visit: (candidate: number) => boolean,
  ): void {
    this.visitGeneration = (this.visitGeneration + 1) >>> 0;
    if (this.visitGeneration === 0) {
      this.visited.fill(0);
      this.visitGeneration = 1;
    }
    const endX = x + velocityX * horizon;
    const endY = y + velocityY * horizon;
    const minColumn = this.column(Math.min(x, endX) - expansion);
    const maxColumn = this.column(Math.max(x, endX) + expansion);
    const minRow = this.row(Math.min(y, endY) - expansion);
    const maxRow = this.row(Math.max(y, endY) + expansion);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        let entry = this.heads[row * this.columns + column]!;
        while (entry !== -1) {
          const candidate = this.entries[entry]!;
          entry = this.next[entry]!;
          if (candidate === agent || this.visited[candidate] === this.visitGeneration) continue;
          this.visited[candidate] = this.visitGeneration;
          if (!visit(candidate)) return;
        }
      }
    }
  }

  private ensureEntryCapacity(required: number): void {
    if (required <= this.entries.length) return;
    let capacity = this.entries.length;
    while (capacity < required) capacity *= 2;
    const entries = new Int32Array(capacity);
    const next = new Int32Array(capacity);
    entries.set(this.entries);
    next.set(this.next);
    this.entries = entries;
    this.next = next;
  }

  private column(x: number): number {
    return Math.max(0, Math.min(this.columns - 1, Math.floor(x / this.cellSize)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
  }
}
