import { expect, test } from '@playwright/test';

test('page opens with the default 1000-agent scenario', async ({ page }) => {
  await page.goto('/?paused=true');
  await expect(page).toHaveTitle(/Crowd Navigation Lab/);
  await expect(page.locator('body')).toHaveAttribute('data-agents', '1000');
  await expect(page.getByText('Open Field', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#crowd-canvas')).toBeVisible();
  await expect(page.locator('#debug-desired')).toBeVisible();
  await expect(page.locator('#debug-recovery')).toBeChecked();
});

test('multi-flow scenarios expose independent goals without a pipeline switch', async ({ page }) => {
  await page.goto('/?paused=true&agents=120');
  await page.locator('#scenario-select').selectOption('crossing-500-500');
  const result = await page.evaluate(() => ({
    flowCount: window.crowdDebug.simulation().flowCount,
    goals: window.crowdDebug.simulation().goals.map((goal) => ({ ...goal })),
  }));
  expect(result.flowCount).toBe(2);
  expect(result.goals[0]).not.toEqual(result.goals[1]);
  await expect(page.locator('#pipeline-select')).toHaveCount(0);
});

test('run, pause, single step, and reset controls work', async ({ page }) => {
  await page.goto('/?paused=true&agents=120&seed=9');
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
  await page.getByRole('button', { name: '실행' }).click();
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-step')))
    .toBeGreaterThan(2);
  await page.getByRole('button', { name: '일시정지' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
  const pausedAt = Number(await page.locator('body').getAttribute('data-step'));
  await page.getByRole('button', { name: '한 스텝' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-step', String(pausedAt + 1));
  await page.getByRole('button', { name: '초기화' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
});

test('a requested fixed step is deterministic and physically bounded', async ({ page }, testInfo) => {
  await page.goto('/?scenario=obstacle-field&agents=1000&seed=42&step=600&paused=true');
  await expect(page.locator('body')).toHaveAttribute('data-step', '600', { timeout: 30_000 });
  const first = await page.evaluate(() => window.crowdDebug.getSnapshot());
  expect(first.metrics.overlapPairs).toBeLessThanOrEqual(16);
  expect(first.metrics.wallOverlapCount).toBe(0);
  expect(first.metrics.maxContactCorrection).toBeLessThanOrEqual(1.25 + 1e-9);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-step', '600', { timeout: 30_000 });
  const second = await page.evaluate(() => window.crowdDebug.getSnapshot());
  expect(second.hash).toBe(first.hash);
  await page.screenshot({ path: testInfo.outputPath('movement-v2-obstacle-field.png'), fullPage: true });
});

test('reversing the goal changes intent immediately and moves on the next step', async ({ page }) => {
  await page.goto('/?scenario=open-field&agents=200&paused=true');
  const result = await page.evaluate(() => {
    const simulation = window.crowdDebug.simulation();
    for (let step = 0; step < 120; step += 1) simulation.step();
    simulation.setGoal(10, 360);
    let redirected = 0;
    let minimumCommandProjection = Number.POSITIVE_INFINITY;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      if (simulation.state.intentX[agent]! < -0.25) redirected += 1;
      minimumCommandProjection = Math.min(
        minimumCommandProjection,
        simulation.state.vx[agent]! * simulation.state.intentX[agent]!
          + simulation.state.vy[agent]! * simulation.state.intentY[agent]!,
      );
    }
    simulation.step();
    let progress = 0;
    let active = 0;
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      if (simulation.state.active[agent] !== 1) continue;
      active += 1;
      progress += simulation.state.vx[agent]! * simulation.state.intentX[agent]!
        + simulation.state.vy[agent]! * simulation.state.intentY[agent]!;
    }
    return { redirected, minimumCommandProjection, averageProgress: progress / active };
  });
  expect(result.redirected).toBeGreaterThan(180);
  expect(result.minimumCommandProjection).toBeGreaterThanOrEqual(-1e-9);
  expect(result.averageProgress).toBeGreaterThan(0);
});

test('a pathological 1000-agent overlap remains bounded and keeps moving', async ({ page }) => {
  await page.goto('/?scenario=open-field&agents=1000&paused=true');
  const result = await page.evaluate(() => {
    const simulation = window.crowdDebug.simulation();
    for (let agent = 0; agent < simulation.state.count; agent += 1) {
      simulation.state.x[agent] = 200;
      simulation.state.y[agent] = 360;
      simulation.state.vx[agent] = 40;
      simulation.state.vy[agent] = 0;
      simulation.state.active[agent] = 1;
    }
    const startedAt = performance.now();
    simulation.step();
    return {
      milliseconds: performance.now() - startedAt,
      candidateChecks: simulation.metrics.candidateChecks,
      recoveredAgents: simulation.metrics.recoveredAgents,
      contactCorrectedAgents: simulation.metrics.contactCorrectedAgents,
      contactConstraints: simulation.metrics.contactConstraints,
      maximumContactWork: simulation.metrics.activeCount
        * simulation.metrics.maxContacts
        * simulation.metrics.constraintIterations,
      maxContactCorrection: simulation.metrics.maxContactCorrection,
      correctionLimit: simulation.config.maximumContactCorrection,
      averageSpeed: simulation.metrics.averageSpeed,
    };
  });
  expect(result.milliseconds).toBeLessThan(250);
  expect(result.candidateChecks).toBeLessThan(1000 * 96 * 26);
  expect(result.recoveredAgents).toBe(0);
  expect(result.contactCorrectedAgents).toBeGreaterThan(800);
  expect(result.contactConstraints).toBeLessThanOrEqual(result.maximumContactWork);
  expect(result.maxContactCorrection).toBeLessThanOrEqual(result.correctionLimit + 1e-9);
  expect(result.averageSpeed).toBeGreaterThan(1);
  await expect(page.locator('#crowd-canvas')).toBeVisible();
});
