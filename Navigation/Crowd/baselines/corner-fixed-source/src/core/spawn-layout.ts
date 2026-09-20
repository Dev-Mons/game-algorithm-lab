import { distanceSquaredToRect } from './obstacle-collision';
import { SeededRandom } from './random';
import { largeAgentPercent, largeAgentScale } from './agent-size';
import type { Rect, ScenarioFlowDefinition, Vec2 } from './types';

export interface SpawnPoint extends Vec2 {
  flow: number;
  radius: number;
}

export interface SpawnLayoutInput {
  count: number;
  seed: number;
  agentRadius: number;
  largeAgentPercent?: number;
  largeAgentScale?: number;
  agentGap: number;
  wallMargin: number;
  worldWidth: number;
  worldHeight: number;
  obstacles: readonly Rect[];
  flows: readonly ScenarioFlowDefinition[];
}

/** Deterministic non-overlapping placement; retries occur only at creation. */
export function createSpawnLayout(input: SpawnLayoutInput): SpawnPoint[] {
  const scale = largeAgentScale(input.largeAgentScale);
  const fraction = scale > 1 ? largeAgentPercent(input.largeAgentPercent) / 100 : 0;
  const initial = placePopulation(input, scale, fraction);
  if (fraction === 0 || initial.length === input.count) return initial;
  // Find a population that fits with the requested ratio intact. This bounded
  // search avoids silently replacing unplaceable large bodies with small ones.
  let lower = 0;
  let upper = input.count - 1;
  let best: SpawnPoint[] = [];
  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2);
    const points = placePopulation({ ...input, count }, scale, fraction);
    if (points.length === count) {
      best = points;
      lower = count + 1;
    } else upper = count - 1;
  }
  return best;
}

function placePopulation(input: SpawnLayoutInput, scale: number, fraction: number): SpawnPoint[] {
  const random = new SeededRandom(input.seed);
  const spacing = input.agentRadius * 2 + Math.max(0.05, input.agentGap);
  const largeRadius = input.agentRadius * scale;
  const index = new PlacementIndex((fraction > 0 ? largeRadius : input.agentRadius) * 2 + 0.001);
  const result: SpawnPoint[] = [];
  const counts = allocateCounts(input.count, input.flows);

  let assigned = 0;
  for (let flow = 0; flow < input.flows.length; flow += 1) {
    const spawn = input.flows[flow]!.spawn;
    const candidates = hexCandidates(spawn, input.agentRadius, spacing);
    shuffle(candidates, random);
    const largeCount = Math.round((assigned + counts[flow]!) * fraction)
      - Math.round(assigned * fraction);
    assigned += counts[flow]!;
    let placed = 0;
    // Reserve the larger footprints first, scattered by the seeded shuffle.
    // Smaller circles fill the remaining space without enlarging every slot.
    for (const radius of largeCount > 0 ? [largeRadius, input.agentRadius] : [input.agentRadius]) {
      const target = radius === largeRadius && largeCount > 0
        ? largeCount : placed + counts[flow]! - largeCount;
      for (const candidate of candidates) {
        if (placed >= target) break;
        const point = { ...candidate, flow, radius };
        if (point.x < spawn.x + radius || point.x > spawn.x + spawn.width - radius + 1e-9
          || point.y < spawn.y + radius || point.y > spawn.y + spawn.height - radius + 1e-9) continue;
        if (!isValid(point, input) || !index.canAdd(point)) continue;
        result.push(point);
        index.add(point);
        placed += 1;
      }
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

function isValid(point: SpawnPoint, input: SpawnLayoutInput): boolean {
  const clearance = point.radius + input.wallMargin;
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
  private readonly buckets = new Map<number, SpawnPoint[]>();

  constructor(private readonly minimumDistance: number) {}

  canAdd(point: SpawnPoint): boolean {
    const column = Math.floor(point.x / this.minimumDistance);
    const row = Math.floor(point.y / this.minimumDistance);
    for (let y = row - 1; y <= row + 1; y += 1) {
      for (let x = column - 1; x <= column + 1; x += 1) {
        const bucket = this.buckets.get(this.key(x, y));
        if (!bucket) continue;
        for (const other of bucket) {
          const minimumSquared = (point.radius + other.radius + 0.001) ** 2;
          const dx = point.x - other.x;
          const dy = point.y - other.y;
          if (dx * dx + dy * dy < minimumSquared - 1e-9) return false;
        }
      }
    }
    return true;
  }

  add(point: SpawnPoint): void {
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
