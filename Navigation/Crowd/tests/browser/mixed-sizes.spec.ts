import { expect, test } from '@playwright/test';

test('size controls rebuild scattered bodies, preserve pause, and replay on reset', async ({ page }, testInfo) => {
  await page.goto('/?paused=true&agents=1000');
  const percent = page.locator('#large-agent-percent');
  await percent.focus();
  await percent.press('Home');
  for (let i = 0; i < 5; i++) await percent.press('ArrowRight');
  await expect(percent).toHaveValue('5');
  await expect(page.locator('#agent-size-summary')).toContainText('큰 객체 50명');
  await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const initial = await page.evaluate(() => window.crowdDebug.getSnapshot().hash);
  await page.getByRole('button', { name: '한 스텝' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-step', '1');
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).not.toBe(initial);
  await page.getByRole('button', { name: '초기화' }).click();
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot().hash)).toBe(initial);
  await page.locator('#large-agent-scale').focus();
  await page.locator('#large-agent-scale').press('End');
  expect(await page.evaluate(() => window.crowdDebug.simulation().maxAgentRadius)).toBe(12.8);
  await page.locator('#scenario-select').selectOption('four-way-merge');
  expect(await page.evaluate(() => {
    const simulation = window.crowdDebug.simulation();
    const flows = new Set<number>();
    for (let a = 0; a < simulation.state.count; a++) {
      if (simulation.agentRadii[a]! > simulation.config.agentRadius) flows.add(simulation.agentFlow[a]!);
    }
    return flows.size;
  })).toBe(4);
  await page.screenshot({ path: testInfo.outputPath('mixed-size-controls.png'), fullPage: true });
});

for (const agents of [1000, 3000, 6000]) {
  test(`renders both physical sizes for ${agents} agents`, async ({ page }, testInfo) => {
    await page.goto(`/?paused=true&agents=${agents}&radius=1.5&gap=0.05&largePercent=5&largeScale=3&step=120`);
    await expect(page.locator('body')).toHaveAttribute('data-step', '120');
    const result = await page.evaluate(() => {
      const simulation = window.crowdDebug.simulation();
      const canvas = document.querySelector<HTMLCanvasElement>('#crowd-canvas')!;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let yellow = 0;
      let blue = 0;
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        if (pixels[pixel]! > 230 && pixels[pixel + 1]! > 150 && pixels[pixel + 2]! < 80) yellow++;
        // Vector and sprite paths blend edge pixels with the dark background.
        if (pixels[pixel]! > 35 && pixels[pixel]! < 130 && pixels[pixel + 1]! > 80
          && pixels[pixel + 1]! < 190 && pixels[pixel + 2]! > 180) blue++;
      }
      return { yellow, blue, count: simulation.state.count, large: simulation.largeAgentCount,
        walls: simulation.metrics.wallOverlapCount, errors: simulation.unspawnedCount };
    });
    expect(result.count).toBe(agents);
    expect(result.large).toBe(agents * .05);
    expect(result.yellow).toBeGreaterThan(result.large * 12);
    expect(result.blue).toBeGreaterThan(agents);
    expect(result.walls).toBe(0);
    expect(result.errors).toBe(0);
    await page.locator('#crowd-canvas').screenshot({ path: testInfo.outputPath(`mixed-sizes-${agents}.png`) });
  });
}
