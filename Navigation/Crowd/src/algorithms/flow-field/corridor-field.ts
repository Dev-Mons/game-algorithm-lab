import { clamp } from '../../core/math';
import type { Rect, Vec2 } from '../../core/types';

interface Room {
  id: number;
  left: number; right: number; top: number; bottom: number;
  neighbors: number[];
  cost: number;
  next: number;
  seed: number;
  directGoal: boolean;
  /** -2 means several incoming branches, with no single position-local lane. */
  incoming: number;
}

/** Per-agent route commitment; reset when geometry or destinations change. */
export interface CorridorRoute { room: number }

/** A shared, acyclic route through rectangular free-space cells.
 * Cuts extend obstacle boundaries across the map. Each portal spans a whole
 * room side, so turning lanes can connect opposite/perpendicular sides without
 * collapsing onto the nearest corner. This is a corridor approximation, not
 * an exact shortest-path mesh. The original grid remains the safety fallback.
 */
export class CorridorField {
  private readonly owner: Int32Array;
  private readonly rooms: Room[] = [];
  private readonly turnDirections = new Float64Array(16);
  private readonly turnWeights = new Float64Array(8);

  constructor(
    private readonly columns: number,
    private readonly rows: number,
    private readonly cellSize: number,
    width: number,
    height: number,
    clearance: number,
    blocked: Uint8Array,
    seeds: readonly { cell: number; x: number; y: number; seed: number }[],
    obstacles: readonly Rect[],
    referencePotential?: Float64Array,
    private readonly segmentSafe?: (x: number, y: number, endX: number, endY: number) => boolean,
  ) {
    this.owner = new Int32Array(blocked.length).fill(-1);
    const cutX = new Set([0, columns]), cutY = new Set([0, rows]);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      if (x && blocked[i] !== blocked[i - 1]) cutX.add(x);
      if (y && blocked[i] !== blocked[i - columns]) cutY.add(y);
    }
    const xs = [...cutX].sort((a, b) => a - b), ys = [...cutY].sort((a, b) => a - b);
    const roomGrid = new Int32Array((xs.length - 1) * (ys.length - 1)).fill(-1);
    const stride = xs.length - 1;
    for (let ry = 0; ry < ys.length - 1; ry++) for (let rx = 0; rx < stride; rx++) {
      const x0 = xs[rx]!, x1 = xs[rx + 1]!, y0 = ys[ry]!, y1 = ys[ry + 1]!;
      if (blocked[y0 * columns + x0]) continue;
      const room = this.rooms.length;
      this.rooms.push({ id: room, left: Math.max(clearance, x0 * cellSize), right: Math.min(width - clearance, x1 * cellSize),
        top: Math.max(clearance, y0 * cellSize), bottom: Math.min(height - clearance, y1 * cellSize),
        neighbors: [], cost: Infinity, next: -1, seed: -1, directGoal: false, incoming: -1 });
      roomGrid[ry * stride + rx] = room;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.owner[y * columns + x] = room;
      for (const neighbor of [rx ? roomGrid[ry * stride + rx - 1]! : -1, ry ? roomGrid[(ry - 1) * stride + rx]! : -1]) {
        if (neighbor < 0) continue;
        this.rooms[room]!.neighbors.push(neighbor);
        this.rooms[neighbor]!.neighbors.push(room);
      }
    }
    // Lazy binary heap. Graph work occurs only on geometry/goal changes.
    const heap: { room: number; cost: number }[] = [];
    const push = (room: number, cost: number): void => {
      const item = { room, cost };
      let i = heap.length; heap.push(item);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent]!.cost <= cost) break;
        heap[i] = heap[parent]!; i = parent;
      }
      heap[i] = item;
    };
    for (const seed of seeds) {
      const id = this.owner[seed.cell] ?? -1;
      if (id < 0) continue;
      const room = this.rooms[id]!;
      const cost = Math.hypot((room.left + room.right) / 2 - seed.x, (room.top + room.bottom) / 2 - seed.y);
      if (cost >= room.cost) continue;
      room.cost = cost; room.seed = seed.seed; push(id, cost);
    }
    while (heap.length) {
      const item = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          const left = i * 2 + 1, right = left + 1;
          const child = right < heap.length && heap[right]!.cost < heap[left]!.cost ? right : left;
          if (heap[child]!.cost >= last.cost) break;
          heap[i] = heap[child]!; i = child;
        }
        heap[i] = last;
      }
      const room = this.rooms[item.room]!;
      if (item.cost !== room.cost) continue;
      for (const id of room.neighbors) {
        const neighbor = this.rooms[id]!;
        const cost = room.cost + Math.hypot((room.left + room.right - neighbor.left - neighbor.right) / 2,
          (room.top + room.bottom - neighbor.top - neighbor.bottom) / 2);
        if (cost >= neighbor.cost) continue;
        neighbor.cost = cost; neighbor.next = item.room; neighbor.seed = room.seed;
        push(id, cost);
      }
    }
    // Resolve equal-length routes after distances have settled. Heap insertion
    // order is not a route preference: it creates alternating upper/lower paths.
    // Integrating the underlying safe-grid potential favours one coherent route
    // and agrees with the grid used outside the conservative room coverage.
    const preference = new Float64Array(this.rooms.length);
    const reference = (room: Room): number => {
      const cell = Math.floor((room.top + room.bottom) / 2 / cellSize) * columns
        + Math.floor((room.left + room.right) / 2 / cellSize);
      const cost = referencePotential?.[cell];
      return cost !== undefined && Number.isFinite(cost) ? cost : room.cost;
    };
    const ordered = this.rooms.map((room, id) => ({ room, id }))
      .filter(({ room }) => Number.isFinite(room.cost)).sort((a, b) => a.room.cost - b.room.cost || a.id - b.id);
    for (const { room, id } of ordered) {
      if (room.next < 0) continue;
      let best = Infinity;
      for (const next of room.neighbors) {
        const neighbor = this.rooms[next]!;
        const distance = Math.hypot((room.left + room.right - neighbor.left - neighbor.right) / 2,
          (room.top + room.bottom - neighbor.top - neighbor.bottom) / 2);
        if (neighbor.cost >= room.cost || Math.abs(neighbor.cost + distance - room.cost) > 1e-7) continue;
        const score = preference[next]! + distance * (reference(room) + reference(neighbor)) / 2;
        if (score < best - 1e-7 || (Math.abs(score - best) <= 1e-7 && next < room.next)) {
          best = score; room.next = next; room.seed = neighbor.seed;
        }
      }
      preference[id] = best;
    }
    for (let id = 0; id < this.rooms.length; id++) {
      const next = this.rooms[id]!.next;
      if (next < 0) continue;
      const room = this.rooms[next]!;
      room.incoming = room.incoming === -1 ? id : -2;
    }
    const targets = new Map(seeds.map(seed => [seed.seed, seed]));
    for (const room of this.rooms) {
      const target = targets.get(room.seed);
      if (!target) continue;
      // A clear bounding rectangle conservatively certifies all room-to-target
      // segments. Per-point LOS alone releases lanes too early beside a corner,
      // while forcing the partition cuts through a clear merge area makes fake turns.
      const left = Math.min(room.left, target.x), right = Math.max(room.right, target.x);
      const top = Math.min(room.top, target.y), bottom = Math.max(room.bottom, target.y);
      room.directGoal = !obstacles.some(obstacle => left < obstacle.x + obstacle.width + clearance
        && right > obstacle.x - clearance && top < obstacle.y + obstacle.height + clearance
        && bottom > obstacle.y - clearance);
    }
  }

  private roomAt(x: number, y: number): Room | undefined {
    const column = Math.floor(x / this.cellSize), row = Math.floor(y / this.cellSize);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return undefined;
    const direct = this.rooms[this.owner[row * this.columns + column]!];
    if (direct) return direct;
    // A conservative room cell can be blocked while the body's exact position
    // remains walkable. Extend the nearest visible room to that fringe instead
    // of switching to a separately chosen grid route one pixel across its edge.
    let nearest: Room | undefined, best = Infinity;
    for (let ry = Math.max(0, row - 1); ry <= Math.min(this.rows - 1, row + 1); ry++) {
      for (let rx = Math.max(0, column - 1); rx <= Math.min(this.columns - 1, column + 1); rx++) {
        const room = this.rooms[this.owner[ry * this.columns + rx]!];
        if (!room || !Number.isFinite(room.cost)) continue;
        const px = clamp(x, room.left + 1e-5, room.right - 1e-5);
        const py = clamp(y, room.top + 1e-5, room.bottom - 1e-5);
        const distance = (x - px) ** 2 + (y - py) ** 2;
        if (distance >= best || !this.segmentSafe?.(x, y, px, py)) continue;
        best = distance; nearest = room;
      }
    }
    return nearest;
  }

  /** Preserve an already chosen branch across small sideways displacements.
   * Crossing its actual next portal advances immediately. Real displacement
   * beyond half a cell releases the commitment, so a pushed body can reroute.
   */
  private routeRoom(x: number, y: number, route?: CorridorRoute): Room | undefined {
    const current = this.roomAt(x, y);
    if (!route) return current;
    const previous = this.rooms[route.room];
    if (previous && current !== previous && current !== this.rooms[previous.next]) {
      const px = clamp(x, previous.left + 1e-5, previous.right - 1e-5);
      const py = clamp(y, previous.top + 1e-5, previous.bottom - 1e-5);
      if (Math.hypot(x - px, y - py) <= this.cellSize * 0.5 && this.segmentSafe?.(x, y, px, py)) return previous;
    }
    route.room = current?.id ?? -1;
    return current;
  }

  targetSeed(x: number, y: number, route?: CorridorRoute): number { return this.routeRoom(x, y, route)?.seed ?? -1; }

  canApproachDirectly(x: number, y: number): boolean { return this.roomAt(x, y)?.directGoal ?? false; }

  /** 0..1 along the portal, oriented consistently relative to forward travel. */
  laneAt(x: number, y: number): number {
    const room = this.roomAt(x, y);
    if (!room || room.next < 0) return 0.5;
    const next = this.rooms[room.next]!;
    const dx = next.left >= room.right ? 1 : next.right <= room.left ? -1 : 0;
    const dy = next.top >= room.bottom ? 1 : next.bottom <= room.top ? -1 : 0;
    let lane = this.lateralCoordinate(room, dx, dy, x, y);
    const incoming = this.rooms[room.incoming];
    if (incoming) {
      const ix = incoming.right <= room.left ? 1 : incoming.left >= room.right ? -1 : 0;
      const iy = incoming.bottom <= room.top ? 1 : incoming.top >= room.bottom ? -1 : 0;
      if (dx * ix + dy * iy === 0) {
        // Infer the same lane on both sides of a perpendicular portal pair.
        // Merely projecting onto the outgoing side makes the field preview
        // jump at the incoming side even when an agent retains a smooth lane.
        const cornerX = ix ? (ix > 0 ? room.left : room.right) : (dx > 0 ? room.right : room.left);
        const cornerY = iy ? (iy > 0 ? room.top : room.bottom) : (dy > 0 ? room.bottom : room.top);
        lane += this.lateralCoordinate(room, ix, iy, x, y) - this.lateralCoordinate(room, dx, dy, cornerX, cornerY);
      }
    }
    return clamp(lane, 0, 1);
  }

  private lateralCoordinate(room: Room, dx: number, dy: number, x: number, y: number): number {
    if (dx > 0) return (y - room.top) / (room.bottom - room.top);
    if (dx < 0) return (room.bottom - y) / (room.bottom - room.top);
    if (dy > 0) return (room.right - x) / (room.right - room.left);
    return (x - room.left) / (room.right - room.left);
  }

  /** Blend into upcoming lane directions before reaching each portal plane.
   * At a plane the downstream contribution is exactly one, so switching rooms
   * does not switch directions. The caller shortens unsafe turn horizons.
   */
  sampleTarget(x: number, y: number, lane: number, out: Vec2, lookAhead = 0, goalX = NaN, goalY = NaN, route?: CorridorRoute): boolean {
    const startRoom = this.routeRoom(x, y, route);
    if (!startRoom || startRoom.next < 0) return false;
    let room: Room = startRoom;
    if (lookAhead <= 0) { this.portalTarget(room, lane, out, true); return true; }
    let count = 0, directionX = 0, directionY = 0;
    for (; count < 8; count++) {
      if (room.next < 0 || room.directGoal) {
        const dx = goalX - x, dy = goalY - y, length = Math.hypot(dx, dy);
        if (Number.isFinite(length) && length > 1e-9) { directionX = dx / length; directionY = dy / length; }
        break;
      }
      const next = this.rooms[room.next]!;
      this.portalTarget(room, lane, out, false);
      const dx = out.x - x, dy = out.y - y, length = Math.hypot(dx, dy);
      directionX = length > 1e-9 ? dx / length : 0;
      directionY = length > 1e-9 ? dy / length : 0;
      this.turnDirections[count * 2] = directionX;
      this.turnDirections[count * 2 + 1] = directionY;
      // Normal distance, not distance to a waypoint: lateral movement during
      // the turn must not pull a body back towards the old portal position.
      const distance = next.left >= room.right ? room.right - x
        : next.right <= room.left ? x - room.left
        : next.top >= room.bottom ? room.bottom - y : y - room.top;
      const t = clamp(1 - distance / lookAhead, 0, 1);
      this.turnWeights[count] = t * t * (3 - 2 * t);
      if (t === 0) { count++; break; }
      room = next;
    }
    for (let i = count - 1; i >= 0; i--) {
      const weight = this.turnWeights[i]!;
      const dx = this.turnDirections[i * 2]! * (1 - weight) + directionX * weight;
      const dy = this.turnDirections[i * 2 + 1]! * (1 - weight) + directionY * weight;
      const length = Math.hypot(dx, dy);
      if (length > 1e-9) { directionX = dx / length; directionY = dy / length; }
    }
    out.x = x + directionX * lookAhead;
    out.y = y + directionY * lookAhead;
    return true;
  }

  private portalTarget(room: Room, lane: number, out: Vec2, advance: boolean): void {
    const next = this.rooms[room.next]!;
    // Keep edge lanes clear of room corners, without reserving a central lane.
    const insetX = Math.min(this.cellSize * 0.3, (room.right - room.left) * 0.15);
    const insetY = Math.min(this.cellSize * 0.3, (room.bottom - room.top) * 0.15);
    const u = clamp(lane, 0, 1);
    if (next.left >= room.right || next.right <= room.left) {
      const east = next.left >= room.right;
      out.x = (east ? room.right : room.left) + (advance ? (east ? 1 : -1) * Math.min(this.cellSize * 0.15, (next.right - next.left) * 0.25) : 0);
      out.y = room.top + insetY + (east ? u : 1 - u) * (room.bottom - room.top - 2 * insetY);
    } else {
      const south = next.top >= room.bottom;
      out.y = (south ? room.bottom : room.top) + (advance ? (south ? 1 : -1) * Math.min(this.cellSize * 0.15, (next.bottom - next.top) * 0.25) : 0);
      out.x = room.left + insetX + (south ? 1 - u : u) * (room.right - room.left - 2 * insetX);
    }
  }
}
