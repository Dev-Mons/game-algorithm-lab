import { expect, test } from '@playwright/test';

test('each preset selects, runs, resets and survives switching without cached state', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?agents=120&paused=true');
  for (const preset of ['B0', 'B1', 'R', 'Q', 'D', 'legacy']) {
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
  await expect(page.locator('#result-rows tr')).toHaveCount(6);
  await page.screenshot({ path: info.outputPath('algorithm-lab.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('fair sequential comparison saves and exports reproducible results', async ({ page }) => {
  await page.goto('/?agents=80&paused=true&scenario=narrow-door');
  await page.locator('#comparison-steps').fill('20');
  await page.locator('#compare-presets').click();
  await expect(page.locator('#comparison-status')).toContainText('6개 실행 완료', { timeout: 30000 });
  await expect(page.locator('#result-rows tr')).toHaveCount(6);
  const results = await page.evaluate(() => JSON.parse(localStorage.getItem('crowd-lab-results-v1')!));
  expect(new Set(results.map((r: { seed: number }) => r.seed)).size).toBe(1);
  expect(new Set(results.map((r: { spawned: number }) => r.spawned)).size).toBe(1);
  expect(results.every((r: { step: number }) => r.step === 20)).toBe(true);
  const download = page.waitForEvent('download');
  await page.locator('#export-results').click();
  expect((await download).suggestedFilename()).toBe('crowd-lab-results.json');
  await page.reload();
  await expect(page.locator('#result-rows tr')).toHaveCount(6);
});

test('ablations reject incompatible combinations and accept local substitutions', async ({ page }) => {
  await page.goto('/?agents=80&paused=true&preset=B1');
  await page.getByText('계층별 교체 / Ablation').click();
  await page.locator('#module-planner').selectOption('individual-astar');
  await page.locator('#module-congestion').check();
  await page.locator('#apply-modules').click();
  await expect(page.locator('#lab-error')).toContainText('Congestion');
  await page.locator('#module-congestion').uncheck();
  await page.locator('#module-avoidance').selectOption('sampling');
  await page.locator('#module-steering').selectOption('boids');
  await page.locator('#apply-modules').click();
  await expect(page.locator('#lab-error')).toBeHidden();
  await page.locator('#single-step').click();
  const options = await page.evaluate(() => window.crowdDebug.simulation().resolvedExperiment.options);
  expect(options.avoidance).toBe('sampling');
  expect(options.steering).toBe('boids');
});

test('scaled world preserves 10000 actual bodies and physical radii', async ({ page }) => {
  await page.goto('/?agents=10000&paused=true&preset=B1&scale=true');
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
  await page.goto('/?agents=80&paused=true&preset=B1&scenario=dynamic-blocking&step=181');
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

test('changing agent clearance rebuilds retained arrival slots', async ({ page }) => {
  await page.goto('/?agents=16&paused=true&preset=R&step=120');
  await expect(page.locator('body')).toHaveAttribute('data-step', '120');
  const before = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    return Array.from({ length: s.state.count }, (_, i) => s.goalForAgent(i));
  });
  await page.locator('#agent-gap').press('End');
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
  const after = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    return { gap: s.config.agentGap, slots: Array.from({ length: s.state.count }, (_, i) => s.goalForAgent(i)),
      unavailable: s.experimentStats.unavailableSlots };
  });
  expect(after.gap).toBe(3);
  expect(after.slots).not.toEqual(before);
  expect(after.unavailable).toBe(0);
});

test('an individual command is recorded and replays in the same preset', async ({ page }) => {
  await page.goto('/?agents=80&paused=true&preset=B0');
  await page.getByText('개별 유닛 명령', { exact: true }).first().click();
  await page.locator('#command-agent').fill('7');
  await page.locator('#command-x').fill('1000');
  await page.locator('#command-y').fill('620');
  await page.locator('#send-agent-command').click();
  expect(await page.evaluate(() => window.crowdDebug.simulation().goalForAgent(7))).toEqual({ x: 1000, y: 620 });
  await page.locator('#single-step').click();
  const first = await page.evaluate(() => window.crowdDebug.getSnapshot().hash);
  await page.locator('#comparison-steps').fill('1');
  await page.locator('#run-current').click();
  await expect(page.locator('#comparison-status')).toContainText('1개 실행 완료');
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).toBe(first);
  await page.locator('#compare-presets').click();
  await expect(page.locator('#comparison-status')).toContainText('Legacy가 지원하지 않습니다');
});
