import type { EffectDefinition } from './effects';
export interface EffectTarget { id: string }
export const effectTagPattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
export function validateEffectTag(id: string) {
  if (id.length > 128 || !effectTagPattern.test(id) || id.toLowerCase() === 'none') throw new Error('효과 태그는 영문으로 시작하는 영문·숫자·밑줄을 점(.)으로 구분하여 1~128자로 입력하세요. 예: MachineGun.Damage');
}

// Presets select registered tags; the tag itself is the runtime ID.
export const effectTargets = [
  { id: 'MachineGun.Damage' },
  { id: 'MachineGun.FireRate' },
  { id: 'MachineGun.Range' },
  { id: 'MachineGun.Pierce' },
] as const;

export const descriptionStyles = {
  bonus: {
    label: '누적 증가량 + 이번 증가량',
    parts: ['스킬 이름', '누적 증가량', '+', '이번 증가량', '→', '투자 후 증가량'],
    DescriptionTemplate: '{DisplayName}: {CurrentBonus} + {Delta}\n투자 후: {NextBonus}',
    MaxDescriptionTemplate: '{DisplayName}: {CurrentBonus} (최대 투자 완료)',
  },
  total: {
    label: '현재 능력치 + 이번 증가량',
    parts: ['스킬 이름', '현재 능력치', '+', '이번 증가량', '→', '다음 능력치'],
    DescriptionTemplate: '{DisplayName}: {CurrentValue} + {Delta}\n투자 후: {NextValue}',
    MaxDescriptionTemplate: '{DisplayName}: {CurrentValue} (최대 투자 완료)',
  },
  change: {
    label: '현재 능력치 → 다음 능력치',
    parts: ['스킬 이름', '현재 능력치', '→', '다음 능력치'],
    DescriptionTemplate: '{DisplayName}: {CurrentValue} → {NextValue}',
    MaxDescriptionTemplate: '{DisplayName}: {CurrentValue} (최대 투자 완료)',
  },
  ranks: {
    label: '현재 투자 횟수 / 최대 투자 횟수',
    parts: ['스킬 이름', '현재 투자 횟수', '/', '최대 투자 횟수', '→', '다음 투자 횟수'],
    DescriptionTemplate: '{DisplayName}: {CurrentRank} / {MaxRank}\n다음 투자: {NextRank} / {MaxRank}',
    MaxDescriptionTemplate: '{DisplayName}: {CurrentRank} / {MaxRank} (최대 투자 완료)',
  },
} as const;
export type DescriptionStyle = keyof typeof descriptionStyles | 'legacy';

export function getDescriptionStyle(effect: EffectDefinition): DescriptionStyle {
  for (const [id, style] of Object.entries(descriptionStyles)) {
    if (effect.DescriptionTemplate === style.DescriptionTemplate && effect.MaxDescriptionTemplate === style.MaxDescriptionTemplate) return id as keyof typeof descriptionStyles;
  }
  if (!effect.StatId && !effect.DescriptionTemplate && !effect.MaxDescriptionTemplate) return 'bonus';
  return 'legacy';
}

export function configureEffect(previous: EffectDefinition, settings: { target: string; operation: string; amount: number; description: string }, catalog: readonly EffectTarget[] = effectTargets): EffectDefinition {
  const known = settings.target === '' || catalog.some(target => target.id === settings.target);
  if (!known && settings.target !== previous.StatId) throw new Error('목록에서 효과 대상을 선택하세요.');
  if (settings.operation !== 'Add' && settings.operation !== 'AddPercent') throw new Error('목록에서 적용 방식을 선택하세요.');
  if (!Number.isFinite(settings.amount) || Math.abs(settings.amount) > 1_000_000) throw new Error('증가량은 ±1,000,000 이내의 숫자여야 합니다.');
  let templates: Pick<EffectDefinition, 'DescriptionTemplate' | 'MaxDescriptionTemplate'>;
  if (settings.description === 'legacy' && getDescriptionStyle(previous) === 'legacy') {
    templates = previous;
  } else {
    if (!Object.hasOwn(descriptionStyles, settings.description)) throw new Error('목록에서 설명 표시 방식을 선택하세요.');
    templates = descriptionStyles[settings.description as keyof typeof descriptionStyles];
  }
  return { StatId: settings.target, ModifierOp: settings.operation, ValuePerRank: settings.amount,
    DescriptionTemplate: templates.DescriptionTemplate, MaxDescriptionTemplate: templates.MaxDescriptionTemplate };
}
