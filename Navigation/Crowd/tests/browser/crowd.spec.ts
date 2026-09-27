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
      let minimumSpeed = Infinity;
      for (let tick = 0; tick < 45; tick++) {
        s.step();
        minimumSpeed = Math.min(minimumSpeed, Math.hypot(s.state.vx[0]!, s.state.vy[0]!));
      }
      return { x: s.state.x[0]!, y: s.state.y[0]!, turnSpeed: s.config.turnSpeed, minimumSpeed };
    }));
  }
  expect(positions[0]!.turnSpeed).toBe(60);
  expect(positions[1]!.turnSpeed).toBe(720);
  expect(positions[0]!.minimumSpeed).toBeGreaterThan(80);
  expect(positions[0]!.x - positions[1]!.x).toBeGreaterThan(15);
  expect(positions[1]!.y - positions[0]!.y).toBeGreaterThan(10);
});

test('slow forward rotation stays with travel near a wall', async ({ page }) => {
  await page.goto('/?scenario=open-field&agents=1&paused=true');
  await page.locator('#turn-speed').press('Home');
  await page.locator('#turn-speed').press('ArrowRight');
  const result = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    s.config.maxAcceleration = 20;
    s.state.x[0] = 500; s.state.y[0] = 300;
    // This tiny off-forward error used to switch the motor into drift recovery.
    s.state.vx[0] = 86; s.state.vy[0] = 0.000001; s.state.heading[0] = 0;
    s.updateObstacles([{ x: 460, y: 270, width: 10, height: 60 }]);
    s.setGoal(500, 660);
    let maximumTurn = 0, maximumMisalignment = 0, minimumSpeed = Infinity;
    const difference = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    for (let tick = 0; tick < 45; tick++) {
      const heading = s.state.heading[0]!, x = s.state.x[0]!, y = s.state.y[0]!;
      s.step();
      maximumTurn = Math.max(maximumTurn, difference(heading, s.state.heading[0]!));
      const travel = Math.atan2(s.state.y[0]! - y, s.state.x[0]! - x);
      maximumMisalignment = Math.max(maximumMisalignment, difference(s.state.heading[0]!, travel));
      minimumSpeed = Math.min(minimumSpeed, Math.hypot(s.state.vx[0]!, s.state.vy[0]!));
    }
    return { turnSpeed: s.config.turnSpeed, fixedDelta: s.config.fixedDelta, heading: s.state.heading[0]!,
      maximumTurn, maximumMisalignment, minimumSpeed };
  });
  expect(result.turnSpeed).toBe(30);
  expect(result.maximumTurn).toBeLessThanOrEqual(30 * Math.PI / 180 * result.fixedDelta + 1e-8);
  expect(result.maximumMisalignment).toBeLessThan(1e-8);
  expect(result.heading).toBeCloseTo(30 * Math.PI / 180 * result.fixedDelta * 45, 8);
  expect(result.minimumSpeed).toBeGreaterThan(80);
});

test('dense crowd momentum does not slow the forward turn toward navigation', async ({ page }) => {
  await page.goto('/?scenario=open-field&agents=961&paused=true');
  const control = page.locator('#turn-speed');
  await control.press('Home');
  for (let i = 0; i < 12; i++) await control.press('ArrowRight');
  const result = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    for (let i = 0; i < s.state.count; i++) {
      s.state.x[i] = 500 + (i % 31 - 15) * 6.8;
      s.state.y[i] = 300 + (Math.floor(i / 31) - 15) * 6.8;
      s.state.vx[i] = 86; s.state.vy[i] = 0; s.state.heading[i] = 0;
    }
    s.setGoal(500, 660);
    let maximumDifference = 0, contactSteps = 0;
    for (let tick = 0; tick < 15; tick++) {
      s.step();
      const route = Math.atan2(s.state.intentY[480]!, s.state.intentX[480]!);
      const corrected = Math.atan2(s.debugLayers.desiredVelocityY[480]!, s.debugLayers.desiredVelocityX[480]!);
      maximumDifference = Math.max(maximumDifference, Math.abs(route - corrected));
      if (s.metrics.contactCorrectedAgents > 0) contactSteps++;
    }
    return { heading: s.state.heading[480]!, turnSpeed: s.config.turnSpeed, maximumDifference, contactSteps };
  });
  expect(result.turnSpeed).toBe(360);
  expect(result.maximumDifference).toBeGreaterThan(20 * Math.PI / 180);
  expect(result.contactSteps).toBeGreaterThan(0);
  expect(result.heading).toBeCloseTo(Math.PI / 2, 8);
});

test('wall contact immediately aligns forward and the next movement with the flow', async ({ page }) => {
  await page.goto('/?scenario=open-field&agents=1&paused=true');
  await page.locator('#turn-speed').press('Home');
  const result = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    s.state.x[0] = 500; s.state.y[0] = 300;
    s.state.heading[0] = 0.4;
    s.state.vx[0] = 86 * Math.cos(0.4); s.state.vy[0] = 86 * Math.sin(0.4);
    s.updateObstacles([{ x: 504, y: 200, width: 10, height: 350 }]);
    s.setGoal(500, 660);
    s.step();
    const hit = { heading: s.state.heading[0]!,
      route: Math.atan2(s.state.intentY[0]!, s.state.intentX[0]!),
      velocity: Math.atan2(s.state.vy[0]!, s.state.vx[0]!),
      x: s.state.x[0]!, y: s.state.y[0]! };
    s.step();
    return { hit, turnSpeed: s.config.turnSpeed, y: s.state.y[0]!,
      clearance: s.config.agentRadius + s.config.wallMargin, walls: s.metrics.wallOverlapCount };
  });
  expect(result.turnSpeed).toBe(0);
  expect(result.hit.heading).toBeGreaterThan(1);
  expect(result.hit.heading).toBeCloseTo(result.hit.route, 8);
  expect(result.hit.velocity).toBeCloseTo(result.hit.route, 8);
  expect(result.hit.x).toBeLessThanOrEqual(504 - result.clearance + 1e-8);
  expect(result.y).toBeGreaterThan(result.hit.y);
  expect(result.walls).toBe(0);
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
