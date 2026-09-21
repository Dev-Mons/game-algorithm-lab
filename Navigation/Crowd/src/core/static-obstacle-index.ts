import type { Rect } from './types';

interface Node {
  minX: number; minY: number; maxX: number; maxY: number;
  left: number; right: number; obstacle: number;
}

const LOCAL_CELL = 64;

/** Static BVH. Queries reuse their output and return original obstacle order.
 * Call update once before querying a changed geometry; in-place edits are detected.
 * Query results must be consumed before the next query on this instance.
 */
export class StaticObstacleIndex {
  obstacles: readonly Rect[] = [];
  private coordinates: number[] = [];
  private nodes: Node[] = [];
  private readonly stack: number[] = [];
  private readonly result: number[] = [];
  private readonly all: number[] = [];
  private readonly localCandidates = new Map<number, readonly number[]>();
  private originX = 0;
  private originY = 0;
  private columns = 0;
  private rows = 0;
  private readonly empty: readonly number[] = [];

  update(obstacles: readonly Rect[]): void {
    const changed = this.coordinates.length !== obstacles.length * 4 || obstacles.some((r, i) =>
      r.x !== this.coordinates[i * 4] || r.y !== this.coordinates[i * 4 + 1]
      || r.width !== this.coordinates[i * 4 + 2] || r.height !== this.coordinates[i * 4 + 3]);
    this.obstacles = obstacles;
    if (!changed) return;
    this.localCandidates.clear();
    this.coordinates = obstacles.flatMap(r => [r.x, r.y, r.width, r.height]);
    this.all.length = 0;
    for (let i = 0; i < obstacles.length; i++) this.all.push(i);
    this.nodes = [];
    if (obstacles.length) {
      this.build([...this.all]);
      const root = this.nodes[0]!;
      this.originX = Math.floor(root.minX / LOCAL_CELL) - 1;
      this.originY = Math.floor(root.minY / LOCAL_CELL) - 1;
      this.columns = Math.floor(root.maxX / LOCAL_CELL) + 2 - this.originX;
      this.rows = Math.floor(root.maxY / LOCAL_CELL) + 2 - this.originY;
    }
  }

  query(minX: number, minY: number, maxX: number, maxY: number): readonly number[] {
    // Tiny maps benefit more from a straight scan than a tree traversal.
    if (this.obstacles.length <= 8) return this.all;
    if (maxX - minX <= LOCAL_CELL && maxY - minY <= LOCAL_CELL) {
      const column = Math.floor((minX + maxX) * .5 / LOCAL_CELL) - this.originX;
      const row = Math.floor((minY + maxY) * .5 / LOCAL_CELL) - this.originY;
      if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return this.empty;
      const key = row * this.columns + column;
      const cached = this.localCandidates.get(key);
      if (cached) return cached;
      // Every <=64px query centred in this tile fits inside the tile plus a
      // 32px halo. Cache the conservative superset, leaving exact tests intact.
      const x = (column + this.originX) * LOCAL_CELL, y = (row + this.originY) * LOCAL_CELL;
      const candidates = [...this.queryTree(x - LOCAL_CELL / 2, y - LOCAL_CELL / 2,
        x + LOCAL_CELL * 1.5, y + LOCAL_CELL * 1.5)];
      this.localCandidates.set(key, candidates);
      return candidates;
    }
    return this.queryTree(minX, minY, maxX, maxY);
  }

  private queryTree(minX: number, minY: number, maxX: number, maxY: number): readonly number[] {
    this.result.length = 0;
    this.stack.length = 0;
    this.stack.push(0);
    while (this.stack.length) {
      const node = this.nodes[this.stack.pop()!]!;
      if (maxX < node.minX || minX > node.maxX || maxY < node.minY || minY > node.maxY) continue;
      if (node.obstacle >= 0) this.result.push(node.obstacle);
      else this.stack.push(node.left, node.right);
    }
    return this.result.sort((a, b) => a - b);
  }

  querySegment(x: number, y: number, endX: number, endY: number, clearance: number): readonly number[] {
    if (this.obstacles.length <= 8) return this.all;
    const padding = Math.max(0, clearance) + 1e-6;
    if (Math.abs(endX - x) + padding * 2 <= LOCAL_CELL && Math.abs(endY - y) + padding * 2 <= LOCAL_CELL) {
      return this.query(Math.min(x, endX) - padding, Math.min(y, endY) - padding,
        Math.max(x, endX) + padding, Math.max(y, endY) + padding);
    }
    this.result.length = 0;
    this.stack.length = 0;
    this.stack.push(0);
    // Conservative slack also covers the zero-clearance exact test's tolerance.
    const dx = endX - x, dy = endY - y;
    while (this.stack.length) {
      const node = this.nodes[this.stack.pop()!]!;
      let near = 0, far = 1;
      if (Math.abs(dx) <= 1e-12) {
        if (x < node.minX - padding || x > node.maxX + padding) continue;
      } else {
        const a = (node.minX - padding - x) / dx, b = (node.maxX + padding - x) / dx;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) continue;
      }
      if (Math.abs(dy) <= 1e-12) {
        if (y < node.minY - padding || y > node.maxY + padding) continue;
      } else {
        const a = (node.minY - padding - y) / dy, b = (node.maxY + padding - y) / dy;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        if (near > far) continue;
      }
      if (node.obstacle >= 0) this.result.push(node.obstacle);
      else this.stack.push(node.left, node.right);
    }
    return this.result.sort((a, b) => a - b);
  }

  private build(indices: number[]): number {
    const node: Node = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
      left: -1, right: -1, obstacle: -1 };
    for (const i of indices) {
      const r = this.obstacles[i]!;
      node.minX = Math.min(node.minX, r.x); node.minY = Math.min(node.minY, r.y);
      node.maxX = Math.max(node.maxX, r.x + r.width); node.maxY = Math.max(node.maxY, r.y + r.height);
    }
    const index = this.nodes.push(node) - 1;
    if (indices.length === 1) node.obstacle = indices[0]!;
    else {
      const horizontal = node.maxX - node.minX >= node.maxY - node.minY;
      indices.sort((a, b) => {
        const ra = this.obstacles[a]!, rb = this.obstacles[b]!;
        return horizontal ? (ra.x + ra.width * .5) - (rb.x + rb.width * .5)
          : (ra.y + ra.height * .5) - (rb.y + rb.height * .5);
      });
      const middle = indices.length >> 1;
      node.left = this.build(indices.slice(0, middle));
      node.right = this.build(indices.slice(middle));
    }
    return index;
  }
}
