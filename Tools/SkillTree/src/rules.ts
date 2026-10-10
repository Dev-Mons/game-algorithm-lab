import { investedRank, type InvestmentState } from './effects';
import { unlockRule, type Project, type SkillNode } from './model';

// Reference for src/unreal/SkillTreeRules.h. Investment keys are placement IDs (Row Name), never SkillId.
export type InvestResult = 'Ok' | 'UnknownNode' | 'MaxRankReached' | 'PrerequisitesNotMet' | 'TreePointsNotMet' | 'NotEnoughPoints';

function find(project: Project, id: string) { return project.nodes.find(node => node.Name === id); }

// Points spent in this tree: Σ rank × Cost. `except` excludes one placement's own investment.
export function treePoints(project: Project, state: InvestmentState, except = ''): number {
  return project.nodes.reduce((sum, node) => node.Name === except ? sum : sum + investedRank(node, state) * node.Cost, 0);
}

export function parentSatisfied(project: Project, node: SkillNode, parentId: string, state: InvestmentState): boolean {
  const parent = find(project, parentId);
  if (!parent) return false;
  // A requirement above the parent's limit means "parent fully invested".
  return investedRank(parent, state) >= Math.min(unlockRule(node).RequiredParentRank, parent.MaxLevel);
}

export function prerequisitesMet(project: Project, node: SkillNode, state: InvestmentState): boolean {
  if (!node.Prerequisites.length) return true;
  const met = node.Prerequisites.filter(id => parentSatisfied(project, node, id, state)).length;
  return unlockRule(node).PrerequisiteMode === 'Any' ? met > 0 : met === node.Prerequisites.length;
}

function gated(project: Project, node: SkillNode, state: InvestmentState): InvestResult {
  if (!prerequisitesMet(project, node, state)) return 'PrerequisitesNotMet';
  if (treePoints(project, state, node.Name) < unlockRule(node).RequiredTreePoints) return 'TreePointsNotMet';
  return 'Ok';
}

export function canInvest(project: Project, nodeId: string, state: InvestmentState, availablePoints: number): InvestResult {
  const node = find(project, nodeId);
  if (!node) return 'UnknownNode';
  if (investedRank(node, state) >= node.MaxLevel) return 'MaxRankReached';
  const gate = gated(project, node, state);
  if (gate !== 'Ok') return gate;
  return availablePoints < node.Cost ? 'NotEnoughPoints' : 'Ok';
}

// A refund is allowed only when every still-invested placement keeps satisfying its unlock rules.
export function canRefund(project: Project, nodeId: string, state: InvestmentState): boolean {
  const node = find(project, nodeId);
  if (!node || investedRank(node, state) <= 0) return false;
  const next = { ...state, [nodeId]: investedRank(node, state) - 1 };
  return project.nodes.every(item => investedRank(item, next) === 0 || gated(project, item, next) === 'Ok');
}

export const investMessages: Record<InvestResult, string> = {
  Ok: '투자할 수 있습니다.', UnknownNode: '노드를 찾을 수 없습니다.', MaxRankReached: '최대 투자 횟수에 도달했습니다.',
  PrerequisitesNotMet: '선행 조건을 만족하지 않습니다.', TreePointsNotMet: '트리 요구 포인트가 부족합니다.', NotEnoughPoints: '보유 포인트가 부족합니다.',
};

// Flat and percentage totals per StatId, as summed by evaluateStat.
export function statTotals(project: Project, state: InvestmentState) {
  const totals = new Map<string, { statId: string; flat: number; percent: number }>();
  for (const node of project.nodes) {
    const rank = investedRank(node, state);
    if (!node.StatId || !rank) continue;
    const entry = totals.get(node.StatId.toLowerCase()) ?? { statId: node.StatId, flat: 0, percent: 0 };
    if (node.ModifierOp === 'Add') entry.flat += rank * node.ValuePerRank;
    else entry.percent += rank * node.ValuePerRank;
    totals.set(node.StatId.toLowerCase(), entry);
  }
  return [...totals.values()];
}

// Points needed to fully invest every placement.
export function completionPoints(project: Project) {
  return project.nodes.reduce((sum, node) => sum + node.MaxLevel * node.Cost, 0);
}
