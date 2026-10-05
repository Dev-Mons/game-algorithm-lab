import { expect, test } from '@playwright/test';
import * as ui from './ui';

test('workspace selects placement skills; settings preserve node selection and commit shared edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#new-preset')).not.toBeVisible();
  await expect(page.locator('#manage-targets')).not.toBeVisible();
  await expect(page.locator('#placed-nodes')).not.toHaveAttribute('open');
  await page.locator('[data-choose-preset=MachineGunRange]').click();
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('[name=Name]')).toHaveValue('MachineGunDamage');
  await page.locator('#edit-preset').click();
  await page.locator('[name=DisplayName]').fill('강화된 머신건 공격력');
  await page.locator('#manage-targets').click();
  await expect(page.locator('#settings-targets-panel')).toBeVisible();
  await page.locator('#manage-targets').press('ArrowUp');
  await expect(page.locator('[name=DisplayName]')).toHaveValue('강화된 머신건 공격력');
  await page.locator('#settings-presets').press('Escape');
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('[name=Name]')).toHaveValue('MachineGunDamage');
  await expect(page.locator('#edit-preset')).toBeFocused();
  await expect(page.locator('[data-preset-id=MachineGunDamage]')).toContainText('강화된 머신건 공격력');
});

test('invalid drafts block settings navigation; discard recovers, target drafts persist between tabs', async ({ page }) => {
  await page.goto('/');
  await ui.editPreset(page, 'MachineGunDamage');
  await page.locator('[name=CustomData]').fill('[]');
  await page.locator('#manage-targets').click();
  await expect(page.locator('#settings-presets-panel')).toBeVisible();
  await page.locator('#settings-done').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(page.locator('#settings-message')).toContainText('JSON 객체');
  await page.locator('#settings-discard').click();
  await page.locator('#manage-targets').click();
  let damage = page.locator('[data-target-row="MachineGun.Damage"] input');
  await damage.fill('MachineGun.DamageBoost');
  await page.locator('#settings-presets').click();
  await expect(page.locator('[name=StatId] option:checked')).toHaveText('MachineGun.DamageBoost');
  damage = page.locator('[data-target-row="MachineGun.DamageBoost"] input');
  await page.locator('#manage-targets').click();
  await damage.fill('  ');
  await page.locator('#settings-done').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.locator('#settings-discard').click();
  await expect(damage).toHaveValue('MachineGun.DamageBoost');
  await ui.closeSettings(page);
  await page.reload();
  await ui.targets(page);
  await expect(damage).toHaveValue('MachineGun.DamageBoost');
});

test('settings panels fit compact viewports and keep completion controls reachable', async ({ page }) => {
  await page.goto('/');
  for (const width of [800, 560, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await ui.editPreset(page, 'MachineGunDamage');
    await expect(page.locator('#settings-done')).toBeInViewport();
    await expect(page.locator('[name=DisplayName]')).toBeVisible();
    expect(await page.locator('#settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await ui.targets(page);
    expect(await page.locator('#settings-targets-panel').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.locator('#settings-done')).toBeInViewport();
    await page.screenshot({ path: `artifacts/settings-${width}.png` });
    await ui.closeSettings(page);
  }
});
