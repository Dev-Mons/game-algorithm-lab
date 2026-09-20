import { expect, test } from '@playwright/test';
import { mapFromScenario, MAP_STORAGE_KEY } from '../../src/editor/map-document';
import { FUNNEL_V2 } from '../fixtures/funnel-v2';

test('a saved 깔때기V2 clears displaced large bodies at radius 3 and 10%', async ({ page }, testInfo) => {
  await page.addInitScript(({ key, map }) => {
    localStorage.setItem(key, JSON.stringify([{ id: 'custom-funnel-v2-regression', map }]));
  }, { key: MAP_STORAGE_KEY, map: mapFromScenario(FUNNEL_V2) });
  await page.goto('/?scenario=custom-funnel-v2-regression&radius=3&largePercent=10&largeScale=2&step=1200&paused=true');
  await expect(page.locator('body')).toHaveAttribute('data-step', '1200', { timeout: 30_000 });
  await expect(page.locator('#scenario-select')).toHaveValue('custom-funnel-v2-regression');
  await expect(page.locator('#agent-radius')).toHaveValue('3');
  await expect(page.locator('#large-agent-percent')).toHaveValue('10');
  await page.locator('#crowd-canvas').screenshot({ path: testInfo.outputPath('funnel-v2-corners.png') });
  const result = await page.evaluate(() => {
    const simulation = window.crowdDebug.simulation();
    let walls = 0;
    for (let step = 0; step < 2400; step++) {
      simulation.step();
      walls = Math.max(walls, simulation.metrics.wallOverlapCount);
    }
    let farthest = 0;
    for (let agent = 0; agent < simulation.state.count; agent++) {
      farthest = Math.max(farthest, Math.hypot(simulation.state.x[agent]! - simulation.goal.x,
        simulation.state.y[agent]! - simulation.goal.y));
    }
    return { walls, farthest, goalRadius: simulation.config.goalRadius };
  });
  expect(result.walls).toBe(0);
  expect(result.farthest).toBeLessThan(result.goalRadius + 1);
});
