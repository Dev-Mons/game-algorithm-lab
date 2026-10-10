import { expect, it } from 'vitest';
import { diagnose, segmentHitsBox } from '../../src/diagnostics';
import { completionPoints, statTotals } from '../../src/rules';
import { createNode, machineGunProject, setUnlockRule, unlockDefaults, withLibrary } from '../../src/model';

const codes = (project = withLibrary(machineGunProject())) => diagnose(project).map(issue => issue.code);

it('reports no layout or rule problems for the machine gun example', () => {
  expect(codes()).toEqual([]);
});

it('finds overlapping nodes, lines through nodes and isolated nodes', () => {
  const project = withLibrary(machineGunProject());
  // Pierce sits on the straight line from Damage to a new node to its right.
  project.nodes.push({ ...createNode('Far', 600, 120), NodeSize: 48, Description: '설명', Prerequisites: ['MachineGunDamage'] });
  project.nodes.push({ ...createNode('Stack', 10, 130), Description: '설명' });
  const issues = diagnose(project);
  expect(issues.find(issue => issue.code === 'edge-through-node')!.nodes).toEqual(['MachineGunDamage', 'Far', 'MachineGunPierce']);
  expect(issues.find(issue => issue.code === 'overlap')!.nodes).toEqual(['MachineGunDamage', 'Stack']);
  expect(issues.find(issue => issue.code === 'isolated')!.nodes).toEqual(['Stack']);
});

it('flags unreachable tree point gates as errors first and explains no-op rules', () => {
  const project = withLibrary(machineGunProject());
  const [damage, , range, pierce] = project.nodes;
  setUnlockRule(pierce, { ...unlockDefaults, RequiredTreePoints: 14 });
  setUnlockRule(damage, { ...unlockDefaults, PrerequisiteMode: 'Any' });
  setUnlockRule(range, { ...unlockDefaults, RequiredParentRank: 9 });
  const issues = diagnose(project);
  expect(issues[0]).toMatchObject({ level: 'error', code: 'tree-points-unreachable', nodes: ['MachineGunPierce'] });
  expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['any-single-parent', 'parent-rank-capped']));
  setUnlockRule(pierce, { ...unlockDefaults, RequiredTreePoints: 13 });
  expect(codes(project)).not.toContain('tree-points-unreachable');
});

it('clips segments against boxes', () => {
  const r = { x1: 0, y1: 0, x2: 10, y2: 10 };
  expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(true);
  expect(segmentHitsBox({ x: -5, y: 15 }, { x: 15, y: 15 }, r)).toBe(false);
  expect(segmentHitsBox({ x: -5, y: -5 }, { x: -1, y: 20 }, r)).toBe(false);
});

it('sums investment effects per stat and the full-completion cost', () => {
  const project = withLibrary(machineGunProject());
  project.nodes[1].ModifierOp = 'AddPercent';
  expect(statTotals(project, { MachineGunDamage: 3, MachineGunFireRate: 2 })).toEqual([
    { statId: 'MachineGun.Damage', flat: 3, percent: 0 }, { statId: 'MachineGun.FireRate', flat: 0, percent: 2 }]);
  expect(completionPoints(project)).toBe(14);
});
