import { expect, test } from '@playwright/test';

for (const agents of [1000, 10000]) {
  const scenario = 'open-field';
  test(`grid transport visual replay: ${scenario}, ${agents} agents`, async ({page}, testInfo) => {
    const large = agents === 10000;
    await page.goto(`/?scenario=${scenario}&agents=${large ? 10000 : 1000}`
      + `${large ? '&radius=1.5&gap=0.05' : ''}&seed=42&step=240&paused=true`);
    // 240 fixed ticks take at least four seconds at 60 Hz. This is a replay/UI
    // check, not an FPS gate; parallel browser tests can exceed the 5s default.
    await expect(page.locator('body')).toHaveAttribute('data-step','240',{timeout:15_000});
    if (large) await expect(page.locator('#agent-radius')).toHaveValue('1.5');
    await page.locator('#crowd-canvas').screenshot({path:testInfo.outputPath(`${scenario}-240.png`)});
    const samples = await page.evaluate(() => {
      const s = window.crowdDebug.simulation();
      const result = [];
      for (let i=0;i<120;i++) {
        s.step();
        result.push({walls:s.metrics.wallOverlapCount, candidates:s.metrics.candidateChecks,
          constraints:s.metrics.contactConstraints, iterations:s.metrics.constraintIterations, count:s.state.count});
      }
      return result;
    });
    for (const sample of samples) {
      expect(sample.walls).toBe(0);
      expect(sample.candidates).toBeLessThanOrEqual(sample.count*24);
      expect(sample.constraints).toBeLessThanOrEqual(sample.count*8*sample.iterations);
    }
    await expect(page.locator('body')).toHaveAttribute('data-step','360');
    await page.locator('#crowd-canvas').screenshot({path:testInfo.outputPath(`${scenario}-360.png`)});
  });
}

test('page opens with the default 1000-agent scenario', async ({ page }) => {
  await page.goto('/?paused=true');
  await expect(page).toHaveTitle(/Crowd Navigation Lab/);
  await expect(page.locator('body')).toHaveAttribute('data-agents', '1000');
  await expect(page.getByText('Open Field', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#crowd-canvas')).toBeVisible();
  await expect(page.locator('#debug-desired')).toBeVisible();
  await expect(page.locator('#debug-recovery')).toBeChecked();
  await expect(page.locator('#metric-dynamic-rebuild')).toHaveText('고정 · 1개');
  await expect(page.locator('#dynamic-density-weight')).toHaveCount(0);
});

test('the baseline and experiment scenarios are available; removed URLs fall back to flat', async ({ page }) => {
  await page.goto('/?scenario=obstacle-field&paused=true&agents=120');
  await expect(page.locator('#scenario-select option')).toHaveCount(10);
  await expect(page.locator('#scenario-select')).toHaveValue('open-field');
  const result = await page.evaluate(() => ({
    id: window.crowdDebug.simulation().scenario.id,
    obstacles: window.crowdDebug.simulation().scenario.obstacles,
    flowCount: window.crowdDebug.simulation().flowCount,
  }));
  expect(result).toEqual({ id: 'open-field', obstacles: [], flowCount: 1 });
  await expect(page.locator('#pipeline-select')).toHaveCount(0);
});

test('run, pause, single step, and reset controls work', async ({ page }) => {
  await page.goto('/?paused=true&agents=120&seed=9');
  await expect(page.locator('body')).toHaveAttribute('data-step', '0');
  await page.locator('#run-toggle').click();
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
  await page.goto('/?scenario=open-field&agents=1000&seed=42&step=600&paused=true');
  await expect(page.locator('body')).toHaveAttribute('data-step', '600', { timeout: 30_000 });
  const first = await page.evaluate(() => window.crowdDebug.getSnapshot());
  expect(first.metrics.overlapPairs).toBeLessThanOrEqual(16);
  expect(first.metrics.wallOverlapCount).toBe(0);
  expect(first.metrics.maxContactCorrection).toBeLessThanOrEqual(1.25 + 1e-9);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-step', '600', { timeout: 30_000 });
  const second = await page.evaluate(() => window.crowdDebug.getSnapshot());
  expect(second.hash).toBe(first.hash);
  await page.screenshot({ path: testInfo.outputPath('movement-v2-open-field.png'), fullPage: true });
});

test('movement turn speed changes the actual path', async ({ page }) => {
  const positions = [];
  for (const speed of [60, 720]) {
    await page.goto('/?scenario=open-field&agents=1&paused=true');
    const control = page.locator('#turn-speed');
    if (speed === 60) {
      await control.press('Home');
      await control.press('ArrowRight');
      await control.press('ArrowRight');
    } else await control.press('End');
    positions.push(await page.evaluate(() => {
      const s = window.crowdDebug.simulation();
      s.config.maxAcceleration = 1000;
      s.state.x[0] = 500; s.state.y[0] = 300;
      s.state.vx[0] = 86; s.state.vy[0] = 0; s.state.heading[0] = 0;
      s.setGoal(500, 660);
      for (let tick = 0; tick < 45; tick++) s.step();
      return { x: s.state.x[0]!, y: s.state.y[0]!, turnSpeed: s.config.turnSpeed };
    }));
  }
  expect(positions[0]!.turnSpeed).toBe(60);
  expect(positions[1]!.turnSpeed).toBe(720);
  expect(positions[0]!.x - positions[1]!.x).toBeGreaterThan(15);
  expect(positions[1]!.y - positions[0]!.y).toBeGreaterThan(10);
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

for (const [id, name, flows] of [
  ['winding-corners', '연속 코너', 1],
  ['funnel-bypass', '깔때기와 우회로', 1],
  ['four-way-merge', '네 생성 지점 합류', 4],
  ['rocky-pass', '바위 협곡', 1],
] as const) {
  test(`concept scenario selection and replay: ${id}`, async ({ page }, testInfo) => {
    await page.goto('/?paused=true');
    await page.locator('#scenario-select').selectOption(id);
    await expect(page.locator('#scenario-badge')).toHaveText(name);
    const initial = await page.evaluate(() => ({
      id: window.crowdDebug.simulation().scenario.id,
      count: window.crowdDebug.simulation().state.count,
      flows: window.crowdDebug.simulation().flowCount,
    }));
    expect(initial).toEqual({ id, count: 1000, flows });
    await page.locator('#crowd-canvas').screenshot({ path: testInfo.outputPath(`${id}-initial.png`) });
    await page.goto(`/?scenario=${id}&agents=1000&seed=42&step=600&paused=true`);
    await expect(page.locator('body')).toHaveAttribute('data-step', '600', { timeout: 20_000 });
    const snapshot = await page.evaluate(() => window.crowdDebug.getSnapshot());
    expect(snapshot.metrics.wallOverlapCount).toBe(0);
    expect(snapshot.metrics.dynamicRebuildCount).toBe(0);
    expect(snapshot.metrics.dynamicRebuildIntervalSteps).toBe(0);
    await expect(page.locator('#metric-dynamic-rebuild')).toHaveText('고정 · 1개');
    expect(await page.evaluate(() => window.crowdDebug.simulation().navigator.dynamicRebuildCount)).toBe(0);
    await page.locator('#crowd-canvas').screenshot({ path: testInfo.outputPath(`${id}-600.png`) });
  });
}
