import { expect, test } from '@playwright/test';
import { PRESETS } from '../../src/algorithms/lab/registry';

test('each preset selects, runs, resets and survives switching without cached state', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?agents=120&paused=true');
  await expect(page.locator('#turn-speed')).toHaveValue('360');
  await page.locator('#turn-speed').press('Home');
  expect(await page.evaluate(() => window.crowdDebug.simulation().config.turnSpeed)).toBe(0);
  await page.locator('#turn-speed').press('End');
  expect(await page.evaluate(() => window.crowdDebug.simulation().config.turnSpeed)).toBe(720);
  await expect(page.locator('#preset-select option')).toHaveText(PRESETS.map(preset => preset.name));
  await expect(page.locator('#module-controls')).toHaveCount(0);
  await expect(page.locator('#individual-controls')).toHaveCount(0);
  for (const { id: preset } of PRESETS) {
    await page.locator('#preset-select').selectOption(preset);
    await expect(page.locator('body')).toHaveAttribute('data-preset', preset);
    await expect(page.locator('body')).toHaveAttribute('data-step', '0');
    const initial = await page.evaluate(() => window.crowdDebug.getSnapshot().hash);
    await page.locator('#single-step').click();
    await expect(page.locator('body')).toHaveAttribute('data-step', '1');
    const after = await page.evaluate(() => window.crowdDebug.getSnapshot());
    expect(after.metrics.wallOverlapCount).toBe(0);
    expect(after.hash).not.toBe(initial);
    await page.locator('#save-result').click();
    await page.locator('#reset').click();
    expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).toBe(initial);
    await page.locator('#single-step').click();
    expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).toBe(after.hash);
  }
  await expect(page.locator('#result-rows tr')).toHaveCount(PRESETS.length);
  await page.screenshot({ path: info.outputPath('algorithm-lab.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('fair sequential comparison saves and exports reproducible results', async ({ page }) => {
  await page.goto('/?agents=80&paused=true&scenario=narrow-door');
  await page.locator('#comparison-steps').fill('20');
  await page.locator('#compare-presets').click();
  await expect(page.locator('#comparison-status')).toContainText(`${PRESETS.length}개 실행 완료`, { timeout: 30000 });
  await expect(page.locator('#result-rows tr')).toHaveCount(PRESETS.length);
  const results = await page.evaluate(() => JSON.parse(localStorage.getItem('crowd-lab-results-v1')!));
  expect(new Set(results.map((r: { seed: number }) => r.seed)).size).toBe(1);
  expect(new Set(results.map((r: { spawned: number }) => r.spawned)).size).toBe(1);
  expect(results.every((r: { step: number }) => r.step === 20)).toBe(true);
  const download = page.waitForEvent('download');
  await page.locator('#export-results').click();
  expect((await download).suggestedFilename()).toBe('crowd-lab-results.json');
  await page.reload();
  await expect(page.locator('#result-rows tr')).toHaveCount(PRESETS.length);
});

test('scaled world preserves 10000 actual bodies and physical radii', async ({ page }) => {
  await page.goto('/?agents=10000&paused=true&preset=legacy&scale=true');
  const dimensions = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    return { count: s.state.count, width: s.config.width, radius: s.config.agentRadius };
  });
  expect(dimensions.count).toBe(10000);
  expect(dimensions.radius).toBe(3.2);
  expect(dimensions.width).toBeGreaterThan(1200);
  await expect(page.locator('#map-edit')).toBeDisabled();
  await page.locator('#single-step').click();
  await expect(page.locator('body')).toHaveAttribute('data-step', '1');
});

test('scheduled terrain edits replay and reset from original geometry', async ({ page }) => {
  await page.goto('/?agents=80&paused=true&preset=legacy&scenario=dynamic-blocking&step=181');
  await expect(page.locator('body')).toHaveAttribute('data-step', '181');
  expect(await page.evaluate(() => window.crowdDebug.simulation().scenario.obstacles.length)).toBe(1);
  const hash = await page.evaluate(() => window.crowdDebug.getSnapshot().hash);
  await page.locator('#reset').click();
  expect(await page.evaluate(() => window.crowdDebug.simulation().scenario.obstacles.length)).toBe(0);
  await page.locator('#comparison-steps').fill('181');
  await page.locator('#run-current').click();
  await expect(page.locator('#comparison-status')).toContainText('1개 실행 완료');
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).toBe(hash);
});
