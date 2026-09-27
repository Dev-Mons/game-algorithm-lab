import type { Rect } from './types';

export const MAX_GOAL_REGIONS = 32;

/** Empty regions select the legacy point destination. */
export function validateGoalRegions(regions: readonly Rect[], width: number, height: number): void {
  if (!Array.isArray(regions) || regions.length > MAX_GOAL_REGIONS) throw new RangeError('Invalid goal region count.');
  for (const region of regions) {
    if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite)
      || region.width <= 0 || region.height <= 0 || region.x < 0 || region.y < 0
      || region.x + region.width > width || region.y + region.height > height) {
      throw new RangeError('Goal regions must be finite positive rectangles inside the world.');
    }
  }
}

export function containsPoint(region: Rect, x: number, y: number): boolean {
  return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
}
