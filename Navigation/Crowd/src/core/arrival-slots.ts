import { clamp } from './math';
import { distanceSquaredToRect } from './obstacle-collision';
import type { Rect, Vec2 } from './types';

const TAU = Math.PI * 2;
const UINT32_RANGE = 0x1_0000_0000;
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;
const ATTEMPT_X = 0.6180339887498949;
const ATTEMPT_Y = 0.41421356237309503;
const DISK_ATTEMPTS = 192;
const FALLBACK_RINGS = 192;
const FALLBACK_SPOKES = 24;
const WORLD_ATTEMPTS = 1024;
const EPSILON = 1e-9;

/**
 * Computes a deterministic, distributed approach point for one agent.
 *
 * The primary candidates form a seed-rotated R2 sequence mapped to the goal
 * disk. Invalid candidates are skipped in a fixed order. If the complete goal
 * disk is obstructed, concentric deterministic probes find a nearby safe point
 * before the function falls back to obstacle edges and the safe world box.
 */
export function computeArrivalSlot(
  agentIndex: number,
  seed: number,
  goal: Readonly<Vec2>,
  goalRadius: number,
  agentRadius: number,
  wallMargin: number,
  worldWidth: number,
  worldHeight: number,
  obstacles: readonly Rect[],
  out: Vec2,
): void {
  const id = Math.max(0, Math.trunc(Number.isFinite(agentIndex) ? agentIndex : 0));
  const clearance = Math.max(0, finiteOrZero(agentRadius)) + Math.max(0, finiteOrZero(wallMargin));
  const radius = Math.max(0, finiteOrZero(goalRadius));
  const width = Math.max(0, finiteOrZero(worldWidth));
  const height = Math.max(0, finiteOrZero(worldHeight));
  const goalX = finiteOrZero(goal.x);
  const goalY = finiteOrZero(goal.y);
  const seedBits = Number.isFinite(seed) ? Math.trunc(seed) | 0 : 0;
  const radialRotation = toUnitInterval(mix32(seedBits ^ 0x68bc21eb));
  const angularRotation = toUnitInterval(mix32(seedBits ^ 0x02e5be93));

  for (let attempt = 0; attempt < DISK_ATTEMPTS; attempt += 1) {
    const radialUnit = fract(
      0.5 + radialRotation + (id + 1) * R2_X + attempt * ATTEMPT_X,
    );
    const angularUnit = fract(
      angularRotation + (id + 1) * R2_Y + attempt * ATTEMPT_Y,
    );
    const distance = radius * Math.sqrt(radialUnit);
    const angle = angularUnit * TAU;
    const x = goalX + Math.cos(angle) * distance;
    const y = goalY + Math.sin(angle) * distance;
    if (!isSafeCenter(x, y, clearance, width, height, obstacles)) continue;
    out.x = x;
    out.y = y;
    return;
  }

  const safeMinimumX = width >= clearance * 2 ? clearance : width * 0.5;
  const safeMaximumX = width >= clearance * 2 ? width - clearance : width * 0.5;
  const safeMinimumY = height >= clearance * 2 ? clearance : height * 0.5;
  const safeMaximumY = height >= clearance * 2 ? height - clearance : height * 0.5;
  const clampedGoalX = clamp(goalX, safeMinimumX, safeMaximumX);
  const clampedGoalY = clamp(goalY, safeMinimumY, safeMaximumY);
  if (isSafeCenter(clampedGoalX, clampedGoalY, clearance, width, height, obstacles)) {
    out.x = clampedGoalX;
    out.y = clampedGoalY;
    return;
  }

  const maximumDistance = Math.max(
    Math.hypot(goalX - safeMinimumX, goalY - safeMinimumY),
    Math.hypot(goalX - safeMaximumX, goalY - safeMinimumY),
    Math.hypot(goalX - safeMinimumX, goalY - safeMaximumY),
    Math.hypot(goalX - safeMaximumX, goalY - safeMaximumY),
  );
  const ringStep = Math.max(0.5, clearance * 0.5, maximumDistance / FALLBACK_RINGS);
  for (let ring = 0; ring < FALLBACK_RINGS; ring += 1) {
    const distance = radius + (ring + 0.5) * ringStep;
    if (distance > maximumDistance + ringStep) break;
    const ringRotation = fract(
      angularRotation + (id + 1) * R2_Y + ring * ATTEMPT_Y,
    );
    for (let spoke = 0; spoke < FALLBACK_SPOKES; spoke += 1) {
      const angle = (ringRotation + spoke / FALLBACK_SPOKES) * TAU;
      const x = goalX + Math.cos(angle) * distance;
      const y = goalY + Math.sin(angle) * distance;
      if (!isSafeCenter(x, y, clearance, width, height, obstacles)) continue;
      out.x = x;
      out.y = y;
      return;
    }
  }

  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const obstacle of obstacles) {
    const left = obstacle.x - clearance;
    const right = obstacle.x + obstacle.width + clearance;
    const top = obstacle.y - clearance;
    const bottom = obstacle.y + obstacle.height + clearance;
    const alongX = clamp(goalX, obstacle.x, obstacle.x + obstacle.width);
    const alongY = clamp(goalY, obstacle.y, obstacle.y + obstacle.height);
    bestDistanceSquared = considerFallback(
      left,
      alongY,
      goalX,
      goalY,
      clearance,
      width,
      height,
      obstacles,
      out,
      bestDistanceSquared,
    );
    bestDistanceSquared = considerFallback(
      right,
      alongY,
      goalX,
      goalY,
      clearance,
      width,
      height,
      obstacles,
      out,
      bestDistanceSquared,
    );
    bestDistanceSquared = considerFallback(
      alongX,
      top,
      goalX,
      goalY,
      clearance,
      width,
      height,
      obstacles,
      out,
      bestDistanceSquared,
    );
    bestDistanceSquared = considerFallback(
      alongX,
      bottom,
      goalX,
      goalY,
      clearance,
      width,
      height,
      obstacles,
      out,
      bestDistanceSquared,
    );
  }
  if (Number.isFinite(bestDistanceSquared)) return;

  const safeSpanX = Math.max(0, safeMaximumX - safeMinimumX);
  const safeSpanY = Math.max(0, safeMaximumY - safeMinimumY);
  for (let attempt = 0; attempt < WORLD_ATTEMPTS; attempt += 1) {
    const xUnit = fract(radialRotation + (id + 1) * R2_X + attempt * ATTEMPT_X);
    const yUnit = fract(angularRotation + (id + 1) * R2_Y + attempt * ATTEMPT_Y);
    bestDistanceSquared = considerFallback(
      safeMinimumX + safeSpanX * xUnit,
      safeMinimumY + safeSpanY * yUnit,
      goalX,
      goalY,
      clearance,
      width,
      height,
      obstacles,
      out,
      bestDistanceSquared,
    );
  }
  if (Number.isFinite(bestDistanceSquared)) return;

  bestDistanceSquared = considerFallback(
    safeMinimumX,
    safeMinimumY,
    goalX,
    goalY,
    clearance,
    width,
    height,
    obstacles,
    out,
    bestDistanceSquared,
  );
  bestDistanceSquared = considerFallback(
    safeMaximumX,
    safeMinimumY,
    goalX,
    goalY,
    clearance,
    width,
    height,
    obstacles,
    out,
    bestDistanceSquared,
  );
  bestDistanceSquared = considerFallback(
    safeMinimumX,
    safeMaximumY,
    goalX,
    goalY,
    clearance,
    width,
    height,
    obstacles,
    out,
    bestDistanceSquared,
  );
  bestDistanceSquared = considerFallback(
    safeMaximumX,
    safeMaximumY,
    goalX,
    goalY,
    clearance,
    width,
    height,
    obstacles,
    out,
    bestDistanceSquared,
  );
  if (Number.isFinite(bestDistanceSquared)) return;

  // No geometrically safe center exists (for example, the world is narrower
  // than the requested diameter). Keep the unavoidable result finite and as
  // close to the requested goal as the world bounds allow.
  out.x = clampedGoalX;
  out.y = clampedGoalY;
}

function considerFallback(
  x: number,
  y: number,
  goalX: number,
  goalY: number,
  clearance: number,
  worldWidth: number,
  worldHeight: number,
  obstacles: readonly Rect[],
  out: Vec2,
  bestDistanceSquared: number,
): number {
  if (!isSafeCenter(x, y, clearance, worldWidth, worldHeight, obstacles)) return bestDistanceSquared;
  const dx = x - goalX;
  const dy = y - goalY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= bestDistanceSquared - EPSILON) return bestDistanceSquared;
  out.x = x;
  out.y = y;
  return distanceSquared;
}

function isSafeCenter(
  x: number,
  y: number,
  clearance: number,
  worldWidth: number,
  worldHeight: number,
  obstacles: readonly Rect[],
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (
    x < clearance - EPSILON
    || y < clearance - EPSILON
    || x > worldWidth - clearance + EPSILON
    || y > worldHeight - clearance + EPSILON
  ) return false;
  for (const obstacle of obstacles) {
    const distanceSquared = distanceSquaredToRect(x, y, obstacle);
    if (clearance <= EPSILON) {
      if (distanceSquared <= EPSILON) return false;
    } else if (distanceSquared < clearance * clearance - EPSILON) {
      return false;
    }
  }
  return true;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function mix32(value: number): number {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function toUnitInterval(value: number): number {
  return value / UINT32_RANGE;
}
