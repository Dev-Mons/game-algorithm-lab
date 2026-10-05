import type { BoardDims } from './config';

export const RAW_ENTRY_V = -1.65;
export const RAW_FEED_V = -2.8;
export const RAW_EXIT_SPEED = 2.2;
/** Physical metering mouths span the configured hopper width, with radius clearance at both walls. */
export function rawFeedLanes(board: BoardDims): number[] {
  const half = Math.min(board.hopperSpread, board.width / 2 - board.itemRadius - 0.5);
  const count = Math.max(1, Math.min(12, Math.floor(half * 2 / (board.itemRadius * 2 + 0.4))));
  return Array.from({ length: count }, (_, i) => board.width / 2 + (count === 1 ? 0 : -half + i * 2 * half / (count - 1)));
}
