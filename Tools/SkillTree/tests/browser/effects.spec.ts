import * as ui from './ui';
import { expect, test } from '@playwright/test';
import { createNode, createProject } from '../../src/model';

test('configure effects with choices and numbers; generate and persist runtime templates without typing IDs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#preview-open, #preview-dialog, #inline-preview')).toHaveCount(0);
  await ui.editPreset(page, 'MachineGunDamage');
  await expect(page.locator('input[name=StatId], textarea[name=DescriptionTemplate], textarea[name=MaxDescriptionTemplate]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '효과 대상', exact: true }).selectOption({ label: 'MachineGun.Range' });
  await page.getByRole('combobox', { name: '적용 방식', exact: true }).selectOption({ label: '비율 증가 (%)' });
  await page.getByRole('spinbutton', { name: '1회 투자 증가량', exact: true }).fill('10');
  await page.getByRole('combobox', { name: '설명 표시 방식', exact: true }).selectOption('change');
  await expect(page.locator('#effect-setting-summary')).toContainText('MachineGun.Range 기본값의 10%');
  await expect(page.locator('#description-structure')).toContainText('현재 능력치');
  await page.locator('#apply').click();
  await ui.exportProject(page);
  const rows = JSON.parse(await page.locator('#json-preview').innerText());
  expect(rows[0]).toMatchObject({ StatId: 'MachineGun.Range', ModifierOp: 'AddPercent', ValuePerRank: 10,
    DescriptionTemplate: '{DisplayName}: {CurrentValue} → {NextValue}', MaxDescriptionTemplate: '{DisplayName}: {CurrentValue} (최대 투자 완료)' });
  await page.locator('#close-export').click();
  await page.reload();
  await ui.editPreset(page, 'MachineGunDamage');
  await expect(page.locator('[name=StatId]')).toHaveValue('MachineGun.Range');
  await expect(page.locator('[name=DescriptionStyle]')).toHaveValue('change');
  await expect(page.locator('[name=ValuePerRank]')).toHaveValue('10');
  await page.screenshot({ path: 'artifacts/effect-settings.png' });
});

test('preserve imported custom effects when editing unrelated fields and replace them through supported selections', async ({ page }) => {
  const project = createProject('기존 효과');
  project.nodes = [{ ...createNode('Custom', 0, 0), StatId: 'Weapon.CustomDamage', ValuePerRank: 2,
    DescriptionTemplate: '피해 {CurrentBonus}, 추가 {Delta}', MaxDescriptionTemplate: '피해 {CurrentBonus} 완료' }];
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await ui.editPreset(page, 'Custom');
  await expect(page.locator('[name=DescriptionStyle]')).toHaveValue('legacy');
  await page.locator('[name=MaxLevel]').fill('5');
  await page.locator('#apply').click();
  await ui.exportProject(page);
  let rows = JSON.parse(await page.locator('#json-preview').innerText());
  expect(rows[0]).toMatchObject({ StatId: 'Weapon.CustomDamage', DescriptionTemplate: '피해 {CurrentBonus}, 추가 {Delta}', MaxLevel: 5 });
  await page.locator('#close-export').click();
  await ui.editPreset(page, 'Custom');
  await page.locator('[name=StatId]').selectOption('MachineGun.Damage');
  await page.locator('[name=DescriptionStyle]').selectOption('bonus');
  await page.locator('#apply').click();
  await ui.exportProject(page);
  rows = JSON.parse(await page.locator('#json-preview').innerText());
  expect(rows[0].StatId).toBe('MachineGun.Damage');
  expect(rows[0].DescriptionTemplate).toContain('{CurrentBonus} + {Delta}');
});
