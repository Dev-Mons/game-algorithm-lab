import { test, expect } from '@playwright/test';

test('applies cornering roll control and keeps a high-grip minicar upright', async ({ page }) => {
  await page.goto('/?paused=true&preset=minicar');
  await expect(page.getByRole('slider', { name: '0–20 km/h 기울기', exact: true })).toHaveValue('1');
  for (const key of ['rollInfluence', 'rollInfluence40', 'rollInfluence80', 'rollInfluence160']) await page.locator(`#${key}`).fill('0.2');
  await expect(page.locator('#applied-summary')).toContainText('기울기 곡선 0.2 / 0.2 / 0.2 / 0.2');
  const actual = await page.evaluate(() => (window as unknown as { __vehicleLab: { config: { rollInfluence: number } } }).__vehicleLab.config.rollInfluence);
  expect(actual).toBe(0.2);
  await page.locator('#friction80').fill('4'); await page.locator('#friction160').fill('4');
  await page.locator('#experiment').selectOption('slalom'); await page.getByRole('button', { name: '시험 시작 →' }).click();
  await expect(page.locator('#result')).toContainText('시험 완료', { timeout: 25000 });
  await expect(page.locator('#result')).toContainText('공중 0.00 s');
  expect(Math.abs(parseFloat((await page.locator('#roll').textContent())!))).toBeLessThan(3);
  await page.screenshot({ path: 'artifacts/roll-control-desktop.png', fullPage: true });
});
