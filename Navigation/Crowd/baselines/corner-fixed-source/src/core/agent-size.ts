import { clamp } from './math';

/** Shared bounds for the UI, spawn layout, and radius-specific navigation data. */
export function largeAgentPercent(value = 0): number {
  return Number.isFinite(value) ? clamp(value, 0, 100) : 0;
}

export function largeAgentScale(value = 2): number {
  return Number.isFinite(value) ? clamp(value, 1, 4) : 2;
}
