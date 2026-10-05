import { expect, it } from 'vitest';
import { deletePreset, exportRows, machineGunProject, parseProject, placePreset, updatePreset, validateProject, withLibrary } from '../../src/model';

it('migrates legacy nodes without moving them and places the same definition with independent IDs and links', () => {
  const original = machineGunProject();
  const project = withLibrary(original);
  expect(project.presets).toHaveLength(4);
  expect(project.nodes[0]).toMatchObject(original.nodes[0]);
  const id = placePreset(project, 'MachineGunDamage', 700, 500);
  expect(id).not.toBe('MachineGunDamage');
  const placed = project.nodes.find(node => node.Name === id)!;
  expect(placed).toMatchObject({ SkillId: 'MachineGunDamage', X: 700, Y: 500, Prerequisites: [] });
  expect(project.nodes[0].X).toBe(original.nodes[0].X);
  const change = { ...project.presets![0], Name: 'DamageSkill', DisplayName: '개선된 머신건 공격력', MaxLevel: 9 };
  updatePreset(project, 'MachineGunDamage', change);
  expect(project.nodes.filter(node => node.SkillId === 'DamageSkill').map(node => node.MaxLevel)).toEqual([9, 9]);
  expect(project.nodes[1].Prerequisites).toEqual(['MachineGunDamage']);
  expect(placed).toMatchObject({ Name: id, X: 700, Y: 500 });
  validateProject(project);
});

it('preserves unused definitions in project files and reconstructs shared definitions from flat DataTable rows', () => {
  const project = withLibrary(machineGunProject());
  project.presets!.push({ ...project.presets![0], Name: 'Unused' });
  placePreset(project, 'MachineGunDamage', 700, 500);
  expect(parseProject(JSON.stringify(project))).toEqual(project);
  const rows = exportRows(project);
  const imported = withLibrary(parseProject(rows));
  expect(imported.nodes).toEqual(project.nodes);
  expect(imported.presets).toHaveLength(4);
  expect(() => deletePreset(project, 'MachineGunDamage')).toThrow('배치 중');
  deletePreset(project, 'Unused');
  expect(project.presets).toHaveLength(4);
});

it('rejects dangling or conflicting definitions instead of silently overwriting node data', () => {
  const project = withLibrary(machineGunProject());
  project.nodes[0].SkillId = 'Missing';
  expect(() => validateProject(project)).toThrow('찾을 수');
  project.nodes[0].SkillId = 'MachineGunDamage';
  project.nodes[0].MaxLevel = 88;
  expect(() => validateProject(project)).toThrow('프리셋과 다릅니다');
  const rows = machineGunProject();
  rows.nodes[0].SkillId = rows.nodes[1].SkillId = 'Shared';
  expect(() => withLibrary(rows)).toThrow('서로 다른 속성');
});
