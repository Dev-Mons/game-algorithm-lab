import { effectTargets, validateEffectTag, type EffectTarget } from './effect-settings';
import type { Project } from './model';

export function targetsFor(project: Project): readonly EffectTarget[] { return project.effectTargets ?? effectTargets; }

export function targetUsage(project: Project, id: string) {
  const matches = (stat: string) => stat.toLowerCase() === id.toLowerCase();
  return { presets: project.presets?.filter(preset => matches(preset.StatId)).length ?? 0,
    nodes: project.nodes.filter(node => matches(node.StatId)).length };
}

export function addTarget(project: Project, tag: string): string {
  const id = tag.trim();
  validateEffectTag(id);
  if (targetsFor(project).some(target => target.id.toLowerCase() === id.toLowerCase())) throw new Error('효과 태그 ID가 중복됩니다.');
  (project.effectTargets ??= effectTargets.map(target => ({ ...target }))).push({ id });
  return id;
}

export function renameTargets(project: Project, drafts: { id: string; tag: string }[]) {
  const replacements = new Map(drafts.map(draft => [draft.id.toLowerCase(), draft.tag.trim()]));
  const targets = targetsFor(project);
  for (const draft of drafts) {
    if (!targets.some(target => target.id.toLowerCase() === draft.id.toLowerCase())) throw new Error('효과 대상을 찾을 수 없습니다.');
    validateEffectTag(draft.tag.trim());
  }
  const next = targets.map(target => ({ id: replacements.get(target.id.toLowerCase()) ?? target.id }));
  if (new Set(next.map(target => target.id.toLowerCase())).size !== next.length) throw new Error('효과 태그 ID가 중복됩니다.');
  project.effectTargets = next;
  for (const item of [...project.nodes, ...(project.presets ?? [])]) {
    item.StatId = replacements.get(item.StatId.toLowerCase()) ?? item.StatId;
  }
}

export function renameTarget(project: Project, id: string, tag: string) {
  renameTargets(project, [{ id, tag }]);
}

export function removeTarget(project: Project, id: string) {
  const usage = targetUsage(project, id);
  if (usage.presets || usage.nodes) throw new Error('사용 중인 효과 대상입니다. 프리셋의 효과 대상을 먼저 변경하세요.');
  project.effectTargets = project.effectTargets?.filter(target => target.id !== id);
}
