import { expect, test } from '@playwright/test';

test('page opens with the default 1000-agent scenario', async ({ page }) => {
  await page.goto('/?paused=true');
  await expect(page).toHaveTitle(/Crowd Navigation Lab/);
  await expect(page.locator('body')).toHaveAttribute('data-agents', '1000');
  await expect(page.getByText('Open Field', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#crowd-canvas')).toBeVisible();
});

test('run, pause, single step, and reset controls work', async ({ page }) => {
  await page.goto('/?paused=true&agents=120&seed=9');
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
  await page.getByRole('button', { name: '실행' }).click();
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-step'))).toBeGreaterThan(2);
  await page.getByRole('button', { name: '일시정지' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const pausedAt = Number(await page.locator('body').getAttribute('data-step'));
  await page.getByRole('button', { name: '한 스텝' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-step', String(pausedAt + 1));
  await page.getByRole('button', { name: '초기화' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
});

test('deterministic URL stops at the requested step and produces a visual artifact', async ({ page }, testInfo) => {
  await page.goto('/?scenario=obstacle-field&agents=1000&seed=42&step=900&paused=true');
  await expect(page.locator('body')).toHaveAttribute('data-step', '900', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const first = await page.evaluate(() => window.crowdDebug.getSnapshot());
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-step', '900', { timeout: 30_000 });
  const second = await page.evaluate(() => window.crowdDebug.getSnapshot());
  expect(second.hash).toBe(first.hash);
  await page.screenshot({ path: testInfo.outputPath('deterministic-obstacle-field.png'), fullPage: true });
});
