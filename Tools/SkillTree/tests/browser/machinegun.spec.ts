import * as ui from './ui';
import { expect, test } from '@playwright/test';

test('machine gun skills expose independent investment limits that persist and export', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-node]')).toHaveCount(4);
  for (const title of ['머신건 공격력 증가', '머신건 발사 속도 증가', '머신건 사거리 증가', '머신건 관통']) {
    await expect(page.getByRole('button', { name: `${title} 노드`, exact: true })).toBeVisible();
  }
  await page.locator('#edit-preset').click();
  const limit = page.getByRole('spinbutton', { name: '최대 투자 횟수', exact: true });
  await expect(limit).toHaveValue('5');
  await expect(limit).toBeVisible();
  await limit.fill('7');
  await page.locator('#apply').click();
  await expect(page.locator('[data-node=MachineGunDamage] .investment-limit')).toHaveText('×7');
  await ui.selectNode(page, 'MachineGunPierce');
  await page.locator('#edit-preset').click();
  await expect(limit).toHaveValue('1');
  await limit.fill('2');
  await ui.exportProject(page);
  const rows = JSON.parse(await page.locator('#json-preview').innerText());
  expect(rows.map((row: { Name: string; MaxLevel: number }) => [row.Name, row.MaxLevel])).toEqual([
    ['MachineGunDamage', 7], ['MachineGunFireRate', 5], ['MachineGunRange', 3], ['MachineGunPierce', 2],
  ]);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await ui.editPreset(page, 'MachineGunPierce');
  await limit.fill('0');
  await ui.exportProject(page);
  await expect(page.locator('#export-dialog')).not.toBeVisible();
  await limit.fill('2');
  await page.locator('#apply').click();
  await page.reload();
  await page.locator('#edit-preset').click();
  await expect(limit).toHaveValue('7');
  await ui.selectNode(page, 'MachineGunPierce');
  await page.locator('#edit-preset').click();
  await expect(limit).toHaveValue('2');
  // Loading the template replaces a prior project through the normal undoable flow.
  await ui.fileAction(page, 'demo');
  await ui.fileAction(page, 'machinegun');
  await expect(page.locator('[data-node]')).toHaveCount(4);
  await page.locator('#edit-preset').click();
  await expect(limit).toHaveValue('5');
  await page.screenshot({ path: 'artifacts/machinegun-skills.png' });
});
