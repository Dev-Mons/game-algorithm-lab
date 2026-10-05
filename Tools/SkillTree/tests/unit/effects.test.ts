import { expect, it } from 'vitest';
import { evaluateStat, previewSkill, validateTemplate } from '../../src/effects';
import { createNode, createProject, exportRows, machineGunProject, parseProject, withLibrary } from '../../src/model';

function fixture() {
  const project = createProject();
  project.nodes = ['A', 'B', 'C'].map(id => ({ ...createNode(id, 0, 0), StatId: 'MachineGun.Damage', ValuePerRank: 1, MaxLevel: 5,
    DescriptionTemplate: '{CurrentBonus} + {Delta} → {NextBonus}', MaxDescriptionTemplate: '{CurrentBonus} (최대 투자 완료)' }));
  return project;
}
it('aggregates investments by stat across different skills and previews 10 + 1 without changing state', () => {
  const project = fixture(), state = { A: 5, B: 5, C: 0 };
  project.nodes.push({ ...createNode('Other', 0, 0), StatId: 'MachineGun.Range', ValuePerRank: 500 });
  const result = previewSkill(project, 'C', { ...state, Other: 1 }, 20);
  expect(result.text).toBe('10 + 1 → 11');
  expect(result).toMatchObject({ CurrentValue: 30, NextValue: 31, Delta: 1, CurrentRank: 0, NextRank: 1 });
  expect(state).toEqual({ A: 5, B: 5, C: 0 });
});
it('uses the same evaluator for additive percentages and flat effects, with case-insensitive stat IDs', () => {
  const project = fixture();
  Object.assign(project.nodes[0], { ModifierOp: 'AddPercent', ValuePerRank: 10, StatId: 'machinegun.damage' });
  const state = { A: 2, B: 3 };
  expect(evaluateStat(project, 'MachineGun.Damage', state, 100)).toBeCloseTo(123);
  expect(previewSkill(project, 'A', state, 100)).toMatchObject({ CurrentValue: 123, NextValue: 133, Delta: 10 });
});
it('caps per-node investments and uses max text without advertising another purchase', () => {
  const result = previewSkill(fixture(), 'C', { A: 5, B: 5, C: 999 });
  expect(result).toMatchObject({ CurrentBonus: 15, NextBonus: 15, Delta: 0, CurrentRank: 5, NextRank: 5, maxed: true });
  expect(result.text).toBe('15 (최대 투자 완료)');
});
it('supports all tokens, decimals, negative effects, and clamps invalid or absent state', () => {
  const project = fixture();
  project.nodes[0].ValuePerRank = -0.125;
  project.nodes[0].DescriptionTemplate = '{DisplayName} {CurrentValue} {NextValue} {CurrentRank}/{MaxRank} → {NextRank}';
  expect(previewSkill(project, 'A', { A: 1, B: Infinity, C: -4 }, 10).text).toBe('새 스킬 9.875 9.75 1/5 → 2');
});
it('preserves plain descriptions and rejects unsupported template syntax', () => {
  const project = fixture();
  project.nodes[0].StatId = ''; project.nodes[0].Description = '일반 설명';
  expect(previewSkill(project, 'A', {}).text).toBe('일반 설명');
  for (const invalid of ['{Damage}', '{CurrentBonus + 1}', '{Delta', '{{Delta}}', '{Delta}|plural(one=x)']) expect(() => validateTemplate(invalid)).toThrow();
  project.nodes[0].DescriptionTemplate = '{Unknown}';
  expect(() => exportRows(project)).toThrow('지원하지 않는 설명 변수');
});
it('migrates legacy definitions and nodes consistently and exports effect definitions only', () => {
  const original = withLibrary(machineGunProject());
  const legacy = JSON.parse(JSON.stringify(original));
  for (const row of [...legacy.nodes, ...legacy.presets]) for (const field of ['StatId', 'ModifierOp', 'ValuePerRank', 'DescriptionTemplate', 'MaxDescriptionTemplate']) delete row[field];
  const migrated = parseProject(JSON.stringify(legacy));
  expect(migrated).toEqual(original);
  const rows = JSON.parse(exportRows(migrated));
  expect(rows[0]).toMatchObject({ StatId: 'MachineGun.Damage', ModifierOp: 'Add', ValuePerRank: 1 });
  expect(rows[0]).not.toHaveProperty('CurrentRank');
  expect(rows[0]).not.toHaveProperty('CurrentBonus');
});
