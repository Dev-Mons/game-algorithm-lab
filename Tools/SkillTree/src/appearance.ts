import bodies from './game-icons.json' with { type: 'json' };
import type { SkillNode } from './model';

export const symbols: Record<keyof typeof bodies, string> = {
  'machine-gun': '머신건', 'machine-gun-magazine': '탄창', crosshair: '조준경', 'supersonic-bullet': '관통탄',
};

// Unmodified Game-icons.net silhouette paths via Iconify (CC BY 3.0).
export function skillIcon(symbol: string): string {
  const body = Object.hasOwn(bodies, symbol) ? bodies[symbol as keyof typeof bodies] : bodies['machine-gun'];
  return `<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function categoryColor(category: string): string {
  const colors: Record<string, string> = { '기본': '#d8c089', '화염': '#c58d77', '냉기': '#8cafc5', '번개': '#b19ac9', '전투': '#8aabc2', '생명': '#91b59c', '제작': '#b2aa76' };
  return colors[category] ?? '#b9a98b';
}

export function categorySymbol(_category: string): string {
  return 'machine-gun';
}

type Position = { x: number; y: number };

export function nodeBoundary(node: SkillNode, toward: Position, position: Position = { x: node.X, y: node.Y }): Position {
  const center = { x: position.x + node.NodeSize / 2, y: position.y + node.NodeSize / 2 };
  let dx = toward.x - center.x, dy = toward.y - center.y;
  if (dx === 0 && dy === 0) dx = 1;
  const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
  const half = node.NodeSize / 2;
  const radius = node.NodeShape === 'Circle' ? half : node.NodeShape === 'Diamond'
    ? half / (Math.abs(ux) + Math.abs(uy)) : half / Math.max(Math.abs(ux), Math.abs(uy));
  return { x: center.x + ux * radius, y: center.y + uy * radius };
}

// Intersect the center-to-center line with each node's visible border.
export function connectionEndpoints(from: SkillNode, to: SkillNode, start: Position = { x: from.X, y: from.Y }, end: Position = { x: to.X, y: to.Y }) {
  const a = { x: start.x + from.NodeSize / 2, y: start.y + from.NodeSize / 2 };
  const b = { x: end.x + to.NodeSize / 2, y: end.y + to.NodeSize / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { from: a, to: b };
  const first = nodeBoundary(from, b, start), last = nodeBoundary(to, a, end);
  const r1 = Math.hypot(first.x - a.x, first.y - a.y), r2 = Math.hypot(last.x - b.x, last.y - b.y);
  // Overlapping nodes should not produce an inverted line across their centers.
  if (r1 + r2 >= length) return { from: a, to: a };
  return { from: first, to: last };
}
