import { test, expect } from '@playwright/test';
import type { VehicleConfig } from '../../src/physics/config';

test('edits the friction graph, protects low speed, applies on release and supports keys', async ({ page }) => {
  await page.goto('/?paused=true&preset=minicar');
  const handle = page.locator('#friction-editor .friction-handle[data-point="3"]');
  await handle.scrollIntoViewIfNeeded();
  const bounds = (await handle.boundingBox())!;
  const applied = () => page.evaluate(() => (window as unknown as { __vehicleLab: { config: VehicleConfig } }).__vehicleLab.config);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 30, { steps: 5 });
  expect((await applied()).friction80).toBe(2.2);
  await page.mouse.up();
  expect((await applied()).friction80).toBeGreaterThan(3);
  await expect(page.locator('#dirty')).toHaveText('적용됨');
  const low = page.locator('#friction-editor .friction-handle[data-point="1"]'); await low.focus(); await page.keyboard.press('End');
  expect((await applied()).friction).toBe(2);
  await expect(page.locator('#friction-editor .friction-handle[data-point="0"]')).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('ArrowUp'); expect((await applied()).friction).toBe(2);
  await expect(page.locator('#live-friction')).toContainText('2.00 μ');
  await page.locator('#friction160').fill('8'); expect((await applied()).friction160).toBe(8);
  await page.locator('#friction-editor').screenshot({ path: 'artifacts/friction-curve.png' });
});
test('imports old constant friction safely and exports all curve points', async ({ page }) => {
  await page.goto('/?paused=true&preset=minicar');
  await page.locator('#config-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from('{"friction":0.4}') });
  await expect(page.locator('#toast')).toContainText('적용');
  for (const id of ['friction', 'friction40', 'friction80', 'friction160']) await expect(page.locator(`#${id}`)).toHaveValue('0.4');
  await page.locator('#friction80').fill('4');
  const download = page.waitForEvent('download'); await page.locator('#save').click();
  const { readFile } = await import('node:fs/promises');
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(json).toMatchObject({ friction: 0.4, friction40: 0.4, friction80: 4, friction160: 0.4 });
});
