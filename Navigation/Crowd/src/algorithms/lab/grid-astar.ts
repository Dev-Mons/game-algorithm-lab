import { distanceSquaredToRect, segmentDistanceSquaredToRect } from '../../core/obstacle-collision';
import type { Rect, Vec2 } from '../../core/types';

const OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/** Original 8-connected A*: Euclidean consistent heuristic, swept-disc safe edges, stable tie order. */
export class GridAStar {
  readonly columns: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private readonly costs: Float64Array;
  private readonly parents: Int32Array;
  private readonly visited: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: number[] = [];
  private readonly heapCosts: number[] = [];
  private searchId = 0;
  expanded = 0;

  constructor(readonly width: number, readonly height: number, readonly cellSize: number,
    readonly clearance: number, readonly obstacles: readonly Rect[]) {
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const count = this.columns * this.rows;
    this.blocked = new Uint8Array(count);
    this.costs = new Float64Array(count);
    this.parents = new Int32Array(count);
    this.visited = new Uint32Array(count);
    this.closed = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) {
      const p = this.point(i);
      this.blocked[i] = this.isPointSafe(p.x, p.y) ? 0 : 1;
    }
  }

  isPointSafe(x: number, y: number): boolean {
    if (x < this.clearance || y < this.clearance || x > this.width - this.clearance || y > this.height - this.clearance) return false;
    return this.obstacles.every((o) => distanceSquaredToRect(x, y, o) >= this.clearance ** 2 - 1e-8);
  }

  isSegmentSafe(ax: number, ay: number, bx: number, by: number): boolean {
    return this.isPointSafe(ax, ay) && this.isPointSafe(bx, by)
      && this.obstacles.every((o) => segmentDistanceSquaredToRect(ax, ay, bx, by, o) >= this.clearance ** 2 - 1e-8);
  }

  find(start: Vec2, goal: Vec2): Vec2[] {
    this.expanded = 0;
    if (!this.isPointSafe(start.x, start.y) || !this.isPointSafe(goal.x, goal.y)) return [];
    if (this.isSegmentSafe(start.x, start.y, goal.x, goal.y)) return [{ ...goal }];
    const from = this.nearestVisible(start);
    const to = this.nearestVisible(goal);
    if (from < 0 || to < 0) return [];
    this.searchId += 1;
    if (this.searchId >= 0xffffffff) { this.visited.fill(0); this.closed.fill(0); this.searchId = 1; }
    this.heap.length = 0; this.heapCosts.length = 0;
    this.visited[from] = this.searchId;
    this.costs[from] = 0;
    this.parents[from] = -1;
    const end = this.point(to);
    this.push(from, this.heuristic(from, end));
    while (this.heap.length) {
      const current = this.pop();
      if (this.closed[current] === this.searchId) continue;
      this.closed[current] = this.searchId;
      this.expanded += 1;
      if (current === to) {
        const route: Vec2[] = [{ ...goal }];
        let node = current;
        while (node >= 0) { route.push(this.point(node)); node = this.parents[node]!; }
        route.reverse();
        // Keep conservative grid corners but remove provably visible intermediate points.
        const smooth: Vec2[] = [];
        let previous = start;
        for (let i = 0; i < route.length;) {
          let farthest = i;
          for (let j = i + 1; j < route.length; j += 1) {
            const point = route[j]!;
            if (!this.isSegmentSafe(previous.x, previous.y, point.x, point.y)) break;
            farthest = j;
          }
          previous = route[farthest]!;
          smooth.push(previous);
          i = farthest + 1;
        }
        return smooth;
      }
      const a = this.point(current);
      const column = current % this.columns;
      const row = Math.floor(current / this.columns);
      for (const [dx, dy] of OFFSETS) {
        const nx = column + dx; const ny = row + dy;
        if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows) continue;
        const next = ny * this.columns + nx;
        if (this.blocked[next] || this.closed[next] === this.searchId) continue;
        const b = this.point(next);
        if (!this.isSegmentSafe(a.x, a.y, b.x, b.y)) continue;
        const cost = this.costs[current]! + Math.hypot(b.x - a.x, b.y - a.y);
        if (this.visited[next] === this.searchId && cost >= this.costs[next]!) continue;
        this.visited[next] = this.searchId; this.costs[next] = cost; this.parents[next] = current;
        this.push(next, cost + this.heuristic(next, end));
      }
    }
    return [];
  }

  private nearestVisible(position: Vec2): number {
    const column = Math.max(0, Math.min(this.columns - 1, Math.floor(position.x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(position.y / this.cellSize)));
    let best = -1; let distance = Infinity;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const x = column + dx; const y = row + dy;
      if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) continue;
      const cell = y * this.columns + x;
      if (this.blocked[cell]) continue;
      const point = this.point(cell);
      const d = (point.x - position.x) ** 2 + (point.y - position.y) ** 2;
      if (d < distance && this.isSegmentSafe(position.x, position.y, point.x, point.y)) { best = cell; distance = d; }
    }
    return best;
  }
  private point(cell: number): Vec2 {
    return { x: Math.min(this.width - this.clearance, (cell % this.columns + 0.5) * this.cellSize),
      y: Math.min(this.height - this.clearance, (Math.floor(cell / this.columns) + 0.5) * this.cellSize) };
  }
  private heuristic(cell: number, end: Vec2): number { const p = this.point(cell); return Math.hypot(p.x - end.x, p.y - end.y); }
  private push(cell: number, cost: number): void {
    let i = this.heap.length;
    this.heap.push(cell); this.heapCosts.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heapCosts[parent]! <= cost) break;
      this.heap[i] = this.heap[parent]!; this.heapCosts[i] = this.heapCosts[parent]!; i = parent;
    }
    this.heap[i] = cell; this.heapCosts[i] = cost;
  }
  private pop(): number {
    const result = this.heap[0]!;
    const cell = this.heap.pop()!; const cost = this.heapCosts.pop()!;
    if (!this.heap.length) return result;
    let i = 0;
    while (i * 2 + 1 < this.heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.heap.length && this.heapCosts[child + 1]! < this.heapCosts[child]!) child += 1;
      if (this.heapCosts[child]! >= cost) break;
      this.heap[i] = this.heap[child]!; this.heapCosts[i] = this.heapCosts[child]!; i = child;
    }
    this.heap[i] = cell; this.heapCosts[i] = cost;
    return result;
  }
}
