import { expect, it } from 'vitest';
import { addTarget, removeTarget, renameTarget, renameTargets } from '../../src/target-catalog';
import { createProject, exportRows, machineGunProject, parseProject, updatePreset, validateProject, withLibrary } from '../../src/model';
import { configureEffect } from '../../src/effect-settings';

it('renames tag references in placed and unused presets and exports the tag verbatim', () => {
  const project = withLibrary(machineGunProject());
  const id = addTarget(project, 'MachineGun.ReloadSpeed');
  const preset = project.presets![0];
  updatePreset(project, preset.Name, { ...preset, ...configureEffect(preset, { target: id, operation: 'Add', amount: 2, description: 'bonus' }, project.effectTargets) });
  project.presets!.push({ ...project.presets![0], Name: 'Unused' });
  renameTarget(project, id, 'MachineGun.ReloadEfficiency');
  expect(project.presets!.filter(preset => preset.StatId === 'MachineGun.ReloadEfficiency')).toHaveLength(2);
  expect(project.nodes[0].StatId).toBe('MachineGun.ReloadEfficiency');
  expect(JSON.parse(exportRows(project))[0].StatId).toBe('MachineGun.ReloadEfficiency');
  expect(parseProject(JSON.stringify(project))).toEqual(project);
  project.nodes = [];
  expect(() => removeTarget(project, 'MachineGun.ReloadEfficiency')).toThrow('사용 중');
});

it('rejects malformed and duplicate tags without corrupting references', () => {
  const project = withLibrary(machineGunProject());
  const before = structuredClone(project);
  for (const tag of ['', '  ', 'MachineGun..Damage', '.Damage', 'Damage.', 'Machine Gun.Damage', 'A.1Damage', 'None', 'A'.repeat(129)]) {
    expect(() => addTarget(project, tag)).toThrow('1~128자');
  }
  expect(() => addTarget(project, 'machinegun.damage')).toThrow('중복');
  expect(() => renameTarget(project, 'MachineGun.Range', 'machinegun.damage')).toThrow('중복');
  expect(project).toEqual(before);
  project.effectTargets!.shift();
  expect(() => validateProject(project)).toThrow('등록되지 않은');
});

it('renames a batch simultaneously and handles case-only edits', () => {
  const project = withLibrary(machineGunProject());
  renameTargets(project, [{ id: 'MachineGun.Damage', tag: 'MachineGun.Range' }, { id: 'MachineGun.Range', tag: 'MachineGun.Damage' }]);
  expect(project.nodes[0].StatId).toBe('MachineGun.Range');
  expect(project.nodes[2].StatId).toBe('MachineGun.Damage');
  renameTarget(project, 'MachineGun.Range', 'machinegun.range');
  expect(project.nodes[0].StatId).toBe('machinegun.range');
  validateProject(project);
});

it('migrates legacy labels without changing IDs and keeps empty catalogs empty', () => {
  const legacy = withLibrary(machineGunProject());
  const saved = { ...legacy, effectTargets: legacy.effectTargets!.map(target => ({ ...target, label: '이전 표시 이름' })) };
  expect(withLibrary(parseProject(JSON.stringify(saved))).effectTargets).toEqual(legacy.effectTargets);
  const unknown = machineGunProject(); unknown.nodes[0].StatId = 'Stat_old_generated_id';
  expect(withLibrary(unknown).effectTargets).toContainEqual({ id: 'Stat_old_generated_id' });
  const empty = { ...createProject(), effectTargets: [], presets: [] };
  expect(withLibrary(empty).effectTargets).toEqual([]);
});
