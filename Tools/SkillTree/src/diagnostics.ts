import { connectionEndpoints } from './appearance';
import { unlockRule, type Project, type SkillNode } from './model';

// Authoring checks. They never block editing or export; they point at layouts and rules that are likely mistakes.
export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue { level: IssueLevel; code: string; message: string; nodes: string[] }

const levelOrder: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
type Box = { x1: number; y1: number; x2: number; y2: number };
const box = (node: SkillNode, inset = 0): Box => ({ x1: node.X + inset, y1: node.Y + inset, x2: node.X + node.NodeSize - inset, y2: node.Y + node.NodeSize - inset });

// Liang-Barsky clip of segment a→b against an axis-aligned box.
export function segmentHitsBox(a: { x: number; y: number }, b: { x: number; y: number }, r: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x1], [dx, r.x2 - a.x], [-dy, a.y - r.y1], [dy, r.y2 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

export function diagnose(project: Project): Issue[] {
  const issues: Issue[] = [];
  const nodes = project.nodes;
  const byId = new Map(nodes.map(node => [node.Name, node]));
  const label = (id: string) => byId.get(id)?.DisplayName ?? id;

  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = box(nodes[i]), b = box(nodes[j]);
    if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2)
      issues.push({ level: 'warning', code: 'overlap', message: `${nodes[i].DisplayName}와 ${nodes[j].DisplayName}가 겹칩니다.`, nodes: [nodes[i].Name, nodes[j].Name] });
  }

  for (const node of nodes) for (const from of node.Prerequisites) {
    const parent = byId.get(from)!;
    const line = connectionEndpoints(parent, node);
    // A 3px inset ignores lines that merely graze a frame corner.
    const blockers = nodes.filter(other => other !== node && other !== parent && segmentHitsBox(line.from, line.to, box(other, 3)));
    if (blockers.length) issues.push({ level: 'warning', code: 'edge-through-node',
      message: `${label(from)} → ${node.DisplayName} 연결선이 ${blockers.map(other => other.DisplayName).join(', ')}를 지나갑니다.`, nodes: [from, node.Name, ...blockers.map(other => other.Name)] });
  }

  const totalPoints = nodes.reduce((sum, node) => sum + node.MaxLevel * node.Cost, 0);
  for (const node of nodes) {
    const rule = unlockRule(node);
    const others = totalPoints - node.MaxLevel * node.Cost;
    if (rule.RequiredTreePoints > others)
      issues.push({ level: 'error', code: 'tree-points-unreachable', message: `${node.DisplayName}: 트리 요구 포인트 ${rule.RequiredTreePoints}가 다른 노드를 모두 찍은 포인트 ${others}보다 커서 해금할 수 없습니다.`, nodes: [node.Name] });
    if (rule.PrerequisiteMode === 'Any' && node.Prerequisites.length < 2)
      issues.push({ level: 'info', code: 'any-single-parent', message: `${node.DisplayName}: 선행 노드가 ${node.Prerequisites.length}개라 '하나 이상' 조건이 의미가 없습니다.`, nodes: [node.Name] });
    const capped = node.Prerequisites.filter(id => rule.RequiredParentRank > byId.get(id)!.MaxLevel);
    if (capped.length)
      issues.push({ level: 'info', code: 'parent-rank-capped', message: `${node.DisplayName}: 선행 요구 투자 ${rule.RequiredParentRank}회는 ${capped.map(label).join(', ')}의 최대치를 넘어 최대 투자로 처리됩니다.`, nodes: [node.Name, ...capped] });
    if (!node.StatId && !node.Description.trim())
      issues.push({ level: 'info', code: 'no-description', message: `${node.DisplayName}: 효과와 기본 설명이 모두 비어 있습니다.`, nodes: [node.Name] });
  }

  if (nodes.length > 1) {
    const children = new Set(nodes.flatMap(node => node.Prerequisites));
    for (const node of nodes) if (!node.Prerequisites.length && !children.has(node.Name))
      issues.push({ level: 'warning', code: 'isolated', message: `${node.DisplayName}: 연결이 없어 처음부터 투자할 수 있는 시작 노드가 됩니다.`, nodes: [node.Name] });
  }

  const placed = new Set(nodes.map(node => node.SkillId));
  const unused = (project.presets ?? []).filter(preset => !placed.has(preset.Name));
  if (unused.length) issues.push({ level: 'info', code: 'unused-preset', message: `배치하지 않은 프리셋: ${unused.map(preset => preset.DisplayName).join(', ')}`, nodes: [] });

  return issues.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
}
