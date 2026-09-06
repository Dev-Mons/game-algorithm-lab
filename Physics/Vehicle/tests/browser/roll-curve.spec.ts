import { test, expect } from '@playwright/test';
import type { VehicleConfig } from '../../src/physics/config';

test('edits roll points by pointer and keyboard independently of the friction graph', async ({ page }) => {
  await page.goto('/?paused=true&preset=minicar');
  const applied = () => page.evaluate(() => (window as unknown as { __vehicleLab: { config: VehicleConfig } }).__vehicleLab.config);
  const frictionBefore = (await applied()).friction80;
  const handle = page.locator('#roll-editor .friction-handle[data-point="3"]');
  await handle.scrollIntoViewIfNeeded(); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 25, { steps: 5 });
  expect((await applied()).rollInfluence80).toBe(0.3);
  await page.mouse.up(); expect((await applied()).rollInfluence80).toBeGreaterThan(0.4);
  expect((await applied()).friction80).toBe(frictionBefore);
  const low = page.locator('#roll-editor .friction-handle[data-point="1"]');
  await low.focus(); await page.keyboard.press('Home');
  expect((await applied()).rollInfluence).toBe(0);
  await expect(page.locator('#roll-editor .friction-handle[data-point="0"]')).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowDown'); expect((await applied()).rollInfluence).toBe(0);
  await page.keyboard.press('End'); expect((await applied()).rollInfluence).toBe(1);
  await expect(page.locator('#live-roll')).toContainText('1.00');
  await page.locator('#roll-editor').screenshot({ path: 'artifacts/roll-curve.png' });
});

test('imports a legacy constant and saves the edited speed curve', async ({ page }) => {
  await page.goto('/?paused=true');
  await page.locator('#config-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from('{"rollInfluence":0.25}') });
  await expect(page.locator('#toast')).toContainText('적용');
  for (const key of ['rollInfluence', 'rollInfluence40', 'rollInfluence80', 'rollInfluence160']) await expect(page.locator(`#${key}`)).toHaveValue('0.25');
  await page.locator('#rollInfluence80').fill('0.1');
  const pending = page.waitForEvent('download'); await page.locator('#save').click();
  const { readFile } = await import('node:fs/promises');
  const value = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(value).toMatchObject({ rollInfluence: 0.25, rollInfluence40: 0.25, rollInfluence80: 0.1, rollInfluence160: 0.25 });
});
