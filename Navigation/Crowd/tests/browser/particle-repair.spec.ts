import { expect, test } from '@playwright/test';

test('replays identical physical fixtures and exposes the measured repair effect', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror',error => errors.push(error.message));
  await page.goto('/experiments/fluid-navigation/');
  await expect(page.locator('#message')).toContainText('검증 통과');
  await expect(page.locator('#scope')).toContainText('474개');
  await page.locator('#time').evaluate((input: HTMLInputElement) => {
    input.value = '8'; input.dispatchEvent(new Event('input',{bubbles: true}));
  });
  await expect(page.locator('#off-stats')).toContainText('0.0%');
  const recovery = Number((await page.locator('#on-stats .stat').nth(1).locator('strong').innerText()).replace('%',''));
  expect(recovery).toBeGreaterThanOrEqual(80);
  await page.screenshot({path: 'test-results/particle-repair.png',fullPage: true});
  await page.locator('#scene').selectOption('crack');
  await expect(page.locator('#message')).toContainText('검증 통과');
  await expect(page.locator('#scope')).toContainText('472개');
  await page.locator('#end').click();
  await expect(page.locator('#on-stats .stat').nth(1)).toContainText('100.0%');
  await page.locator('#play').click();
  await expect.poll(async () => Number(await page.locator('#time').inputValue())).toBeGreaterThan(.1);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('재생');
  expect(errors).toEqual([]);
});

test('fits the comparison and controls on a narrow viewport', async ({page}) => {
  await page.setViewportSize({width: 390,height: 844});
  await page.goto('/experiments/fluid-navigation/');
  await expect(page.locator('#message')).toContainText('검증 통과');
  expect(await page.evaluate(() => document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(1);
  await page.locator('#scene').selectOption('uniform');
  await expect(page.locator('#scope')).toContainText('492개');
  await expect(page.locator('#on-stats')).toContainText('공동 없음');
});
