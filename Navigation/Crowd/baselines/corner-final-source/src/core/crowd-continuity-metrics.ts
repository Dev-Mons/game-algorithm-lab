import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { CrowdSimulation } from './simulation';
import { distanceSquaredToRect } from './obstacle-collision';

/** Diagnostics only; never feeds back into movement. All queries are bounded. */
export class CrowdContinuityTracker {
  private readonly grid: SpatialHash;
  private readonly candidates = new Int32Array(256);
  private readonly spacing = new Float64Array(512);
  private readonly counts: Uint32Array;
  private readonly blocked: Uint8Array;
  private readonly columns: number;
  private readonly rows: number;
  readonly cellSize: number;
  private samples = 0;
  private spacingSum = 0;
  private spacingSquared = 0;
  private spacingFound = 0;
  private queried = 0;
  private truncated = 0;
  private velocityDifference = 0;
  private velocityPairs = 0;
  private variance = 0;
  private voidCells = 0;
  private interiorCells = 0;

  constructor(private readonly simulation: CrowdSimulation) {
    this.cellSize = simulation.config.agentRadius * 4;
    this.columns = Math.ceil(simulation.config.width / this.cellSize);
    this.rows = Math.ceil(simulation.config.height / this.cellSize);
    this.counts = new Uint32Array(this.columns * this.rows);
    this.blocked = new Uint8Array(this.counts.length);
    this.grid = new SpatialHash(simulation.config.width, simulation.config.height,
      this.cellSize, simulation.state.count);
    for (let i = 0; i < this.counts.length; i++) {
      const x = (i % this.columns + 0.5) * this.cellSize;
      const y = (Math.floor(i / this.columns) + 0.5) * this.cellSize;
      this.blocked[i] = simulation.scenario.obstacles.some((obstacle) =>
        distanceSquaredToRect(x, y, obstacle) <= simulation.config.agentRadius ** 2) ? 1 : 0;
    }
  }

  update(): void {
    const { state, agentFlow } = this.simulation;
    this.grid.rebuild(state.x, state.y, state.active);
    this.counts.fill(0);
    const radius = this.cellSize * 2;
    for (let agent = 0; agent < state.count; agent++) {
      if (state.active[agent] !== 1) continue;
      const x = state.x[agent]!;
      const y = state.y[agent]!;
      const cell = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize))) * this.columns
        + Math.min(this.columns - 1, Math.max(0, Math.floor(x / this.cellSize)));
      this.counts[cell] = this.counts[cell]! + 1;
      const count = this.grid.queryCandidates(x, y, radius, this.candidates);
      this.queried++;
      if (count === this.candidates.length) this.truncated++;
      let nearest = radius;
      let found = false;
      for (let j = 0; j < count; j++) {
        const other = this.candidates[j]!;
        if (other === agent || agentFlow[other] !== agentFlow[agent]) continue;
        const distance = Math.hypot(state.x[other]! - x, state.y[other]! - y);
        if (distance > radius) continue;
        nearest = Math.min(nearest, distance);
        found = true;
        this.velocityDifference += (state.vx[agent]! - state.vx[other]!) ** 2
          + (state.vy[agent]! - state.vy[other]!) ** 2;
        this.velocityPairs++;
      }
      if (found) {
        this.spacingFound++;
        this.spacingSum += nearest;
        this.spacingSquared += nearest * nearest;
        const bin = Math.min(511, Math.floor(nearest / radius * 512));
        this.spacing[bin] = this.spacing[bin]! + 1;
      }
    }
    let sum = 0;
    let squared = 0;
    let cells = 0;
    for (let row = 1; row < this.rows - 1; row++) {
      for (let column = 1; column < this.columns - 1; column++) {
        const i = row * this.columns + column;
        if (this.blocked[i]) continue;
        // An interior sample must be enclosed on all four axes within three
        // cells. Rays stop at statics. Exterior space and channels through a
        // wall cannot be counted as crowd voids. This is a local gap proxy,
        // not a claim to detect arbitrarily large holes or concave boundaries.
        if (!this.enclosed(column, row, -1, 0) || !this.enclosed(column, row, 1, 0)
          || !this.enclosed(column, row, 0, -1) || !this.enclosed(column, row, 0, 1)) continue;
        cells++;
        sum += this.counts[i]!;
        squared += this.counts[i]! ** 2;
        this.interiorCells++;
        if (this.counts[i] === 0) this.voidCells++;
      }
    }
    if (cells > 0 && sum > 0) {
      // Squared coefficient of variation: dimensionless and radius invariant.
      this.variance += Math.max(0, squared * cells / (sum * sum) - 1);
      this.samples++;
    }
  }

  snapshot() {
    return {
      spacingP50: this.percentile(0.5),
      spacingP95: this.percentile(0.95),
      spacingVariance: this.spacingSquared / Math.max(1, this.spacingFound)
        - (this.spacingSum / Math.max(1, this.spacingFound)) ** 2,
      spacingCoverage: this.spacingFound / Math.max(1, this.queried),
      truncatedQueryFraction: this.truncated / Math.max(1, this.queried),
      densityVariance: this.variance / Math.max(1, this.samples),
      interiorVoidFraction: this.voidCells / Math.max(1, this.interiorCells),
      interiorCellSamples: this.interiorCells,
      sameFlowVelocityRms: Math.sqrt(this.velocityDifference / Math.max(1, this.velocityPairs)),
      continuityCellSize: this.cellSize,
    };
  }

  private enclosed(column: number, row: number, dx: number, dy: number): boolean {
    for (let step = 1; step <= 3; step++) {
      const x = column + dx * step;
      const y = row + dy * step;
      if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) return false;
      const cell = y * this.columns + x;
      if (this.blocked[cell]) return false;
      if (this.counts[cell]! > 0) return true;
    }
    return false;
  }

  private percentile(fraction: number): number {
    if (this.spacingFound === 0) return 0;
    let cumulative = 0;
    for (let bin = 0; bin < 512; bin++) {
      cumulative += this.spacing[bin]!;
      if (cumulative >= this.spacingFound * fraction) return (bin + 0.5) / 512 * this.cellSize * 2;
    }
    return this.cellSize * 2;
  }
}
