import { expect, test } from '@playwright/test';

test('rocky-pass converging front remains filled with pressure enabled', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scenario=rocky-pass&agents=10000&radius=1.5&largePercent=5&largeScale=2&paused=true');
  const result = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    let walls = 0;
    for (let tick = 0; tick < 120; tick++) { s.step(); walls = Math.max(walls, s.metrics.wallOverlapCount); }
    const front = (top: number, bottom: number) => {
      const xs = [...s.state.x].filter((x, a) => s.state.active[a] && s.state.y[a]! >= top && s.state.y[a]! < bottom && x < 432).sort((a, b) => a - b);
      return xs[Math.floor(xs.length * 0.95)]!;
    };
    return { count: s.state.count, walls, pressure: s.crowdFlow.pressure.some(p => p > 0),
      gap: Math.max(front(318, 342), front(378, 402)) - front(348, 372) };
  });
  expect(result.count).toBe(3989);
  expect(result.pressure).toBe(true);
  expect(result.walls).toBe(0);
  expect(result.gap).toBeLessThan(6);
  await page.locator('label:has(#debug-flow)').click();
  await page.locator('#crowd-canvas').screenshot({ path: info.outputPath('pressure-front.png') });
  expect(errors).toEqual([]);
});
