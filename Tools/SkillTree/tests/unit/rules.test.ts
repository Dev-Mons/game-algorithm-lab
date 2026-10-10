import { expect, it } from 'vitest';
import { canInvest, canRefund, prerequisitesMet, treePoints } from '../../src/rules';
import { machineGunProject, setUnlockRule, unlockDefaults, withLibrary } from '../../src/model';

// Damage(5) → FireRate(5), Range(3) → Pierce(1, needs FireRate and Range).
function tree() { return withLibrary(machineGunProject()); }
const pierce = (project = tree()) => project.nodes.find(node => node.Name === 'MachineGunPierce')!;

it('checks rank limits, prerequisites and available points in that order', () => {
  const project = tree();
  expect(canInvest(project, 'Missing', {}, 10)).toBe('UnknownNode');
  expect(canInvest(project, 'MachineGunDamage', {}, 0)).toBe('NotEnoughPoints');
  expect(canInvest(project, 'MachineGunDamage', {}, 1)).toBe('Ok');
  expect(canInvest(project, 'MachineGunDamage', { MachineGunDamage: 5 }, 1)).toBe('MaxRankReached');
  expect(canInvest(project, 'MachineGunFireRate', {}, 1)).toBe('PrerequisitesNotMet');
  expect(canInvest(project, 'MachineGunFireRate', { MachineGunDamage: 1 }, 1)).toBe('Ok');
});

it('supports All / Any prerequisite modes and required parent ranks clamped to the parent limit', () => {
  const project = tree(), node = pierce(project);
  const state = { MachineGunDamage: 1, MachineGunFireRate: 1 };
  expect(prerequisitesMet(project, node, state)).toBe(false);
  setUnlockRule(node, { ...unlockDefaults, PrerequisiteMode: 'Any' });
  expect(prerequisitesMet(project, node, state)).toBe(true);
  setUnlockRule(node, { ...unlockDefaults, PrerequisiteMode: 'Any', RequiredParentRank: 4 });
  expect(prerequisitesMet(project, node, state)).toBe(false);
  // Range only has 3 ranks, so a requirement of 4 means "Range fully invested".
  expect(prerequisitesMet(project, node, { MachineGunRange: 3 })).toBe(true);
});

it('gates on points spent on other nodes of the tree', () => {
  const project = tree(), node = pierce(project);
  setUnlockRule(node, { ...unlockDefaults, PrerequisiteMode: 'Any', RequiredTreePoints: 6 });
  const state = { MachineGunDamage: 4, MachineGunRange: 1 };
  expect(treePoints(project, state)).toBe(5);
  expect(canInvest(project, 'MachineGunPierce', state, 1)).toBe('TreePointsNotMet');
  expect(canInvest(project, 'MachineGunPierce', { ...state, MachineGunDamage: 5 }, 1)).toBe('Ok');
});

it('allows refunds only when every invested node stays unlocked', () => {
  const project = tree();
  const state = { MachineGunDamage: 2, MachineGunFireRate: 1, MachineGunRange: 1, MachineGunPierce: 1 };
  expect(canRefund(project, 'MachineGunDamage', state)).toBe(true);
  expect(canRefund(project, 'MachineGunDamage', { ...state, MachineGunDamage: 1 })).toBe(false);
  expect(canRefund(project, 'MachineGunRange', state)).toBe(false);
  expect(canRefund(project, 'MachineGunPierce', state)).toBe(true);
  expect(canRefund(project, 'MachineGunPierce', {})).toBe(false);
});
