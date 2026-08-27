import { distanceSquaredToRect } from './obstacle-collision';
import { SeededRandom } from './random';
import type { Rect, ScenarioFlowDefinition, Vec2 } from './types';

export interface SpawnPoint extends Vec2 {
  flow: number;
}

export interface SpawnLayoutInput {
  count: number;
  seed: number;
  agentRadius: number;
  agentGap: number;
  wallMargin: number;
  worldWidth: number;
  worldHeight: number;
  obstacles: readonly Rect[];
  flows: readonly ScenarioFlowDefinition[];
}

/** Deterministic non-overlapping hex layout. No retry loop or movement policy. */
export function createSpawnLayout(input: SpawnLayoutInput): SpawnPoint[] {
  const random = new SeededRandom(input.seed);
  const spacing = input.agentRadius * 2 + Math.max(0.05, input.agentGap);
  const minimumDistance = input.agentRadius * 2 + 0.001;
  const index = new PlacementIndex(minimumDistance);
  const result: SpawnPoint[] = [];
  const counts = allocateCounts(input.count, input.flows);

  for (let flow = 0; flow < input.flows.length; flow += 1) {
    const candidates = hexCandidates(input.flows[flow]!.spawn, input.agentRadius, spacing);
    shuffle(candidates, random);
    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= counts[flow]!) break;
      if (!isValid(candidate, input) || !index.canAdd(candidate)) continue;
      result.push({ ...candidate, flow });
      index.add(candidate);
      placed += 1;
    }
  }
  return result;
}

function allocateCounts(count: number, flows: readonly ScenarioFlowDefinition[]): Int32Array {
  const output = new Int32Array(flows.length);
  const weights = flows.map((flow) => Math.max(0, flow.weight ?? 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || flows.length;
  let assigned = 0;
  for (let flow = 0; flow < flows.length; flow += 1) {
    output[flow] = Math.floor(count * (weights[flow] || 1) / total);
    assigned += output[flow]!;
  }
  for (let flow = 0; assigned < count; flow = (flow + 1) % flows.length) {
    output[flow] = output[flow]! + 1;
    assigned += 1;
  }
  return output;
}

function hexCandidates(rect: Rect, radius: number, spacing: number): Vec2[] {
  const points: Vec2[] = [];
  const vertical = spacing * Math.sqrt(3) * 0.5;
  let row = 0;
  for (let y = rect.y + radius; y <= rect.y + rect.height - radius + 1e-9; y += vertical) {
    const offset = (row & 1) === 1 ? spacing * 0.5 : 0;
    for (
      let x = rect.x + radius + offset;
      x <= rect.x + rect.width - radius + 1e-9;
      x += spacing
    ) points.push({ x, y });
    row += 1;
  }
  return points;
}

function isValid(point: Vec2, input: SpawnLayoutInput): boolean {
  const clearance = input.agentRadius + input.wallMargin;
  if (
    point.x < clearance
    || point.y < clearance
    || point.x > input.worldWidth - clearance
    || point.y > input.worldHeight - clearance
  ) return false;
  const clearanceSquared = clearance * clearance;
  return input.obstacles.every(
    (obstacle) => distanceSquaredToRect(point.x, point.y, obstacle) >= clearanceSquared - 1e-9,
  );
}

function shuffle<T>(values: T[], random: SeededRandom): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.next() * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
}

class PlacementIndex {
  private readonly buckets = new Map<number, Vec2[]>();

  constructor(private readonly minimumDistance: number) {}

  canAdd(point: Vec2): boolean {
    const column = Math.floor(point.x / this.minimumDistance);
    const row = Math.floor(point.y / this.minimumDistance);
    const minimumSquared = this.minimumDistance * this.minimumDistance;
    for (let y = row - 1; y <= row + 1; y += 1) {
      for (let x = column - 1; x <= column + 1; x += 1) {
        const bucket = this.buckets.get(this.key(x, y));
        if (!bucket) continue;
        for (const other of bucket) {
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          if (dx * dx + dy * dy < minimumSquared - 1e-9) return false;
        }
      }
    }
    return true;
  }

  add(point: Vec2): void {
    const key = this.key(
      Math.floor(point.x / this.minimumDistance),
      Math.floor(point.y / this.minimumDistance),
    );
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(point);
    else this.buckets.set(key, [point]);
  }

  private key(column: number, row: number): number {
    return row * 1_000_003 + column;
  }
}
