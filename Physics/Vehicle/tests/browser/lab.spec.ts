import { test, expect, type Page } from '@playwright/test';
interface Snapshot { step: number; speed: number; position: { x: number; y: number; z: number }; grounded: number; orientation: object; velocity: object; momentum: object }
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { __vehicleLab: { snapshot(): Snapshot } }).__vehicleLab.snapshot());
test('A and D steer the rendered front wheels left and right from behind the car', async ({ page }) => {
  for (const [key, side] of [['a', -1], ['d', 1]] as const) {
    await page.goto('/?paused=true&course=flat');
    await page.locator('#scene canvas').focus(); await page.keyboard.down(key);
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '한 스텝', exact: true }).click();
    await page.keyboard.up(key);
    const poses = () => page.evaluate(() => (window as unknown as { __vehicleLab: { wheelPoses: { angle: number; screenSteer: number }[] } }).__vehicleLab.wheelPoses);
    await expect.poll(async () => (await poses())[0].screenSteer * side).toBeGreaterThan(0.001);
    for (const wheel of (await poses()).slice(0, 2)) { expect(wheel.angle * side).toBeLessThan(-0.1); expect(wheel.screenSteer * side).toBeGreaterThan(0.001); }
    for (const wheel of (await poses()).slice(2)) expect(wheel.angle).toBe(0);
    await page.locator('.stage').screenshot({ path: `artifacts/steering-${key}.png` });
  }
});
test('renders the 3D lab and offers precise pause, step, and reset', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?paused=true');
  await expect(page.getByRole('heading', { name: 'Vehicle Physics 실험실' })).toBeVisible();
  await expect(page.locator('#scene canvas')).toBeVisible();
  expect((await snapshot(page)).step).toBe(0);
  await page.getByRole('button', { name: '한 스텝', exact: true }).click();
  expect((await snapshot(page)).step).toBe(1);
  await page.getByRole('button', { name: '↺ 초기화', exact: true }).click();
  expect((await snapshot(page)).step).toBe(0);
  await page.screenshot({ path: 'artifacts/vehicle-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('drives from keyboard and brakes before precise stepping', async ({ page }) => {
  await page.goto('/?paused=true&course=flat');
  await page.getByRole('button', { name: '▶ 계속하기', exact: true }).click();
  await page.locator('#scene canvas').focus(); await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed).toBeGreaterThan(2);
  await page.keyboard.up('w'); await page.keyboard.down('Space');
  await expect.poll(async () => (await snapshot(page)).speed).toBeLessThan(0.2);
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Ⅱ 일시정지', exact: true }).click();
  const paused = await snapshot(page);
  await page.getByRole('button', { name: '한 스텝', exact: true }).click();
  expect((await snapshot(page)).step).toBe(paused.step + 1);
});
test('selects the minicar preset and quickly accelerates with W', async ({ page }) => {
  await page.goto('/?paused=true&course=flat');
  await page.getByRole('button', { name: '미니카', exact: true }).click();
  await expect(page.locator('#drive')).toHaveValue('awd');
  await expect(page.locator('#topSpeed-value')).toContainText('72 km/h');
  await page.getByRole('button', { name: '▶ 계속하기', exact: true }).click();
  await page.locator('#scene canvas').focus(); await page.keyboard.down('w');
  await expect.poll(async () => (await snapshot(page)).speed, { timeout: 6000 }).toBeGreaterThan(18);
  await page.keyboard.up('w');
  await page.getByRole('button', { name: 'Ⅱ 일시정지', exact: true }).click();
  await page.screenshot({ path: 'artifacts/minicar-desktop.png', fullPage: true });
});
test('applies configuration and validates imported settings', async ({ page }) => {
  await page.goto('/?paused=true');
  await page.getByRole('button', { name: '드리프트', exact: true }).click();
  await expect(page.locator('#drive')).toHaveValue('rwd');
  await expect(page.locator('#rearGrip')).toHaveValue('0.25');
  await page.locator('#spring').fill('35000');
  await expect(page.locator('#dirty')).toHaveText('적용됨');
  expect(await page.evaluate(() => (window as unknown as { __vehicleLab: { config: { spring: number } } }).__vehicleLab.config.spring)).toBe(35000);
  await page.locator('#config-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"mass":0}') });
  await expect(page.locator('#toast')).toContainText('mass');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '적용값 저장 ↓' }).click();
  expect((await download).suggestedFilename()).toBe('vehicle-setup.json');
});
test('runs suspension test, exports telemetry, and replays the same result', async ({ page }) => {
  await page.goto('/?paused=true');
  await page.locator('#experiment').selectOption('drop');
  await page.getByRole('button', { name: '시험 시작 →' }).click();
  await expect(page.locator('#result')).toContainText('시험 완료', { timeout: 18000 });
  const original = await snapshot(page); expect(original.grounded).toBe(4); expect(original.step).toBe(720);
  await page.getByRole('button', { name: '현재 결과를 비교 기준으로 +' }).click();
  await expect(page.locator('#baseline-label')).toContainText('서스펜션 낙하');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV 내보내기 ↗' }).click();
  expect((await download).suggestedFilename()).toBe('vehicle-drop.csv');
  await page.getByRole('button', { name: '입력 재생', exact: true }).click();
  await expect(page.locator('#result')).toContainText('입력 재생 완료', { timeout: 18000 });
  expect(await snapshot(page)).toEqual(original);
  await page.getByRole('button', { name: '차체 높이', exact: true }).click();
  await expect(page.locator('#chart-unit')).toContainText('BODY HEIGHT');
});
test('shows outward body roll and uneven spring loads during cornering', async ({ page }) => {
  await page.goto('/?paused=true');
  await page.locator('#experiment').selectOption('circle');
  await page.getByRole('button', { name: '시험 시작 →' }).click();
  await expect.poll(async () => Math.abs(parseFloat((await page.locator('#roll').textContent())!)), { timeout: 10000 }).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Ⅱ 일시정지', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#load-FL').textContent()) - Number(await page.locator('#load-FR').textContent())).toBeGreaterThan(500);
  await page.locator('.stage').screenshot({ path: 'artifacts/cornering-roll.png' });
});
test('switches courses, views and debug layers without browser errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?paused=true');
  for (const course of ['ramp', 'bumps', 'flat', 'playground']) {
    await page.locator('#course').selectOption(course);
    await page.getByRole('button', { name: '한 스텝', exact: true }).click();
  }
  await page.getByLabel('카메라', { exact: true }).selectOption('top');
  await page.getByLabel('힘 벡터', { exact: true }).uncheck();
  await page.getByLabel('주행 궤적', { exact: true }).uncheck();
  expect(errors).toEqual([]);
});
test('fits a narrow viewport with accessible settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/?paused=true');
  await expect(page.locator('#scene canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '바운시', exact: true }).click();
  await expect(page.locator('#damping')).toHaveValue('850');
  await page.screenshot({ path: 'artifacts/vehicle-mobile.png', fullPage: true });
});
