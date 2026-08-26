import type { Vec2 } from './types';

export const EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function normalize(x: number, y: number, out: Vec2): Vec2 {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= EPSILON) {
    out.x = 0;
    out.y = 0;
  } else {
    out.x = x / magnitude;
    out.y = y / magnitude;
  }
  return out;
}

export function limit(x: number, y: number, maximum: number, out: Vec2): Vec2 {
  const squared = x * x + y * y;
  if (squared > maximum * maximum) {
    const scale = maximum / Math.sqrt(squared);
    out.x = x * scale;
    out.y = y * scale;
  } else {
    out.x = x;
    out.y = y;
  }
  return out;
}

export function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
