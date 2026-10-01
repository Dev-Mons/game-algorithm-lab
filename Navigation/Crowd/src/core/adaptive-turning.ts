import { clamp } from './math';

/** Keep the base rate inside 30 degrees; smoothly rise to 4x at 120 degrees.
 * This scales an angular rate (not a frame-dependent interpolation factor).
 */
export function turnRateMultiplier(deltaRadians: number): number {
  const t = clamp((Math.abs(deltaRadians) - Math.PI / 6) / (Math.PI / 2), 0, 1);
  return 1 + 3 * t * t * (3 - 2 * t);
}
