import * as ui from './ui';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('unlock rules are edited per placement and exported in split tables with a ZIP package', async ({ page }) => {
  await page.goto('/');
  await ui.fileAction(page, 'machinegun');
  await ui.selectNode(page, 'MachineGunPierce');
  await page.locator('[name=PrerequisiteMode]').selectOption('Any');
  await page.locator('[name=RequiredParentRank]').fill('3');
  await page.locator('[name=RequiredTreePoints]').fill('4');
  await page.locator('#apply').click();
  await expect(page.locator('.edge.any')).toHaveCount(2);

  await ui.exportProject(page, 'split');
  await expect(page.locator('#legacy-actions')).toBeHidden();
  await expect(page.locator('[data-export-table]')).toHaveText([/DT_MachineGun_Tree · 1행/, /DT_MachineGun_Skills · 4행/, /DT_MachineGun_Nodes · 4행/, /DT_MachineGun_Links · 4행/]);
  await page.locator('[data-export-table=Nodes]').click();
  const nodes = JSON.parse(await page.locator('#json-preview').innerText());
  expect(nodes[3]).toMatchObject({ Name: 'MachineGunPierce', PrerequisiteMode: 'Any', RequiredParentRank: 3, RequiredTreePoints: 4, Depth: 2 });

  await page.locator('#export-tree-id').fill('Bad Id');
  await page.locator('#export-tree-id').press('Enter');
  await expect(page.locator('#export-message')).toContainText('트리 ID');
  await expect(page.locator('#export-tree-id')).toHaveValue('MachineGun');
  await page.locator('#export-tree-id').fill('MG');
  await page.locator('#export-encoding').selectOption('csv');
  await expect(page.locator('#export-summary')).toContainText('DT_MG_Nodes.csv');
  await expect(page.locator('#export-message')).toBeHidden();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-zip').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('MG_DataTables.zip');
  const bytes = await readFile((await download.path())!);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  const text = bytes.toString('utf8');
  for (const name of ['Json/DT_MG_Skills.json', 'Csv/DT_MG_Links.csv', 'Source/SkillTreeTypes.h', 'Source/SkillTreeRules.h', 'README.txt']) expect(text).toContain(name);

  await page.locator('#export-format').selectOption('legacy');
  await expect(page.locator('#split-options')).toBeHidden();
  expect(JSON.parse(await page.locator('#json-preview').innerText())[3]).not.toHaveProperty('PrerequisiteMode');
});
