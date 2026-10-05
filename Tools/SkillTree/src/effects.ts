import type { Project, SkillNode } from './model';

export const descriptionTokens = ['DisplayName', 'CurrentBonus', 'Delta', 'NextBonus', 'CurrentValue', 'NextValue', 'CurrentRank', 'NextRank', 'MaxRank'] as const;
export type EffectDefinition = {
  StatId: string;
  ModifierOp: 'Add' | 'AddPercent';
  ValuePerRank: number;
  DescriptionTemplate: string;
  MaxDescriptionTemplate: string;
};
export type InvestmentState = Record<string, number>;

export function effectDefaults(id = ''): EffectDefinition {
  const stats: Record<string, string> = { MachineGunDamage: 'MachineGun.Damage', MachineGunFireRate: 'MachineGun.FireRate', MachineGunRange: 'MachineGun.Range', MachineGunPierce: 'MachineGun.Pierce' };
  const stat = Object.hasOwn(stats, id) ? stats[id] : '';
  return { StatId: stat, ModifierOp: 'Add', ValuePerRank: stat ? 1 : 0,
    DescriptionTemplate: stat ? '{DisplayName}: {CurrentBonus} + {Delta}\n투자 후: {NextBonus}' : '',
    MaxDescriptionTemplate: stat ? '{DisplayName}: {CurrentBonus} (최대 투자 완료)' : '' };
}

export function validateTemplate(template: string) {
  const remainder = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, token: string) => {
    if (!(descriptionTokens as readonly string[]).includes(token)) throw new Error(`지원하지 않는 설명 변수: {${token}}`);
    return '';
  });
  if (/[{}]/.test(remainder)) throw new Error('설명 변수는 {CurrentBonus}처럼 작성하세요. 중괄호가 올바르지 않습니다.');
  // This deliberately supports a shared subset of FText formatting, not expressions.
  if (/[`|]/.test(template)) throw new Error('설명 템플릿에서는 서식 연산자(|)와 백틱(`)을 지원하지 않습니다.');
}

export function investedRank(node: SkillNode, state: InvestmentState): number {
  const rank = Object.hasOwn(state, node.Name) ? state[node.Name] : 0;
  return Number.isFinite(rank) ? Math.max(0, Math.min(node.MaxLevel, Math.trunc(rank))) : 0;
}

export function evaluateStat(project: Project, statId: string, state: InvestmentState, baseValue = 0): number {
  if (!statId) return baseValue;
  let flat = 0, percent = 0;
  for (const node of [...project.nodes].sort((a, b) => a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0)) {
    if (node.StatId.toLowerCase() !== statId.toLowerCase()) continue;
    const amount = investedRank(node, state) * node.ValuePerRank;
    if (node.ModifierOp === 'Add') flat += amount;
    else percent += amount;
  }
  return baseValue * (1 + percent / 100) + flat;
}

export function previewSkill(project: Project, nodeId: string, state: InvestmentState, baseValue = 0) {
  const node = project.nodes.find(item => item.Name === nodeId);
  if (!node) throw new Error('미리보기 노드를 선택하세요.');
  if (!Number.isFinite(baseValue)) throw new Error('기본값은 유한한 숫자여야 합니다.');
  const currentRank = investedRank(node, state), nextRank = Math.min(currentRank + 1, node.MaxLevel);
  const currentValue = evaluateStat(project, node.StatId, state, baseValue);
  const nextValue = evaluateStat(project, node.StatId, { ...state, [node.Name]: nextRank }, baseValue);
  const values = { DisplayName: node.DisplayName, CurrentBonus: currentValue - baseValue, Delta: nextValue - currentValue,
    NextBonus: nextValue - baseValue, CurrentValue: currentValue, NextValue: nextValue,
    CurrentRank: currentRank, NextRank: nextRank, MaxRank: node.MaxLevel };
  const maxed = currentRank >= node.MaxLevel;
  const template = maxed ? node.MaxDescriptionTemplate || '{DisplayName}: {CurrentBonus} (최대 투자 완료)' : node.DescriptionTemplate;
  const formatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
  const text = !node.StatId || !template ? node.Description : template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, token: string) => {
    const value = values[token as keyof typeof values];
    return typeof value === 'number' ? formatter.format(Math.abs(value) < 0.0005 ? 0 : value) : value;
  });
  return { ...values, maxed, text };
}
