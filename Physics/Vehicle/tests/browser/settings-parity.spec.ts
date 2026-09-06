import { test, expect, type Page } from '@playwright/test';
import type { VehicleConfig } from '../../src/physics/config';
import type { Telemetry } from '../../src/lab/experiments';

const applied = (page: Page) => page.evaluate(() => (window as unknown as { __vehicleLab: { config: VehicleConfig } }).__vehicleLab.config);
async function acceleration(page: Page) {
  await page.locator('#experiment').selectOption('acceleration');
  await page.getByRole('button', { name: '시험 시작 →' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vehicleLab: { snapshot(): { step: number } } }).__vehicleLab.snapshot().step)).toBeGreaterThanOrEqual(240);
  await page.getByRole('button', { name: 'Ⅱ 일시정지', exact: true }).click();
  return page.evaluate(() => (window as unknown as { __vehicleLab: { rows: Telemetry[] } }).__vehicleLab.rows.filter(r => r.time <= 2));
}
test('manual minicar values from balanced produce the same straight-line acceleration', async ({ page }) => {
  await page.goto('/?paused=true&course=flat');
  await page.getByRole('button', { name: '미니카', exact: true }).click();
  const minicar = await applied(page), reference = await acceleration(page);
  await page.getByRole('button', { name: '밸런스', exact: true }).click();
  await page.getByText('조향 · 제동 · 주행 저항', { exact: true }).click();
  for (const [key, value] of Object.entries(minicar)) {
    if (key === 'drive') await page.locator('#drive').selectOption(String(value));
    else await page.locator(`#${key}`).fill(String(value));
  }
  expect(await applied(page)).toEqual(minicar);
  await expect(page.locator('#preset-description')).toContainText('미니카 설정과 일치');
  await expect(page.getByRole('button', { name: '미니카', exact: true })).toHaveClass('active');
  expect(await acceleration(page)).toEqual(reference);
});
test('pointer release and arrow keys update the actual vehicle without an Apply button', async ({ page }) => {
  await page.goto('/?paused=true&course=flat');
  const slider = page.locator('#engineForce'); await slider.scrollIntoViewIfNeeded();
  const bounds = (await slider.boundingBox())!;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + bounds.width * 0.45, centerY); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, centerY, { steps: 4 });
  const during = Number(await slider.inputValue());
  expect((await applied(page)).engineForce).toBe(10000);
  await expect(page.locator('#dirty')).toHaveText('조절 중');
  await page.mouse.up();
  expect((await applied(page)).engineForce).toBe(during);
  await expect(page.locator('#dirty')).toHaveText('적용됨');
  await slider.focus(); await page.keyboard.press('ArrowLeft');
  expect((await applied(page)).engineForce).toBe(during - 500);
  await expect(page.locator('#applied-summary')).toContainText((during - 500).toLocaleString());
});
test('imported resistance values apply and saving exports the active vehicle configuration', async ({ page }) => {
  await page.goto('/?paused=true');
  const imported = { ...(await applied(page)), drag: 0.73, rolling: 250, mass: 650 };
  await page.locator('#config-file').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('#toast')).toContainText('차량에 적용');
  expect(await applied(page)).toEqual(imported);
  await page.getByText('조향 · 제동 · 주행 저항', { exact: true }).click();
  await expect(page.locator('#drag')).toHaveValue('0.73'); await expect(page.locator('#rolling')).toHaveValue('250');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '적용값 저장 ↓' }).click();
  const { readFile } = await import('node:fs/promises');
  expect(JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))).toEqual(imported);
});
