import { expect, test, type Page } from '@playwright/test';

type Lab = { runner: any; view: any; liveBackends: { plinko: number; pusher: number; engineWorlds: number } };
const lab = <T>(page: Page, fn: (l: Lab) => T) => page.evaluate(`(${fn.toString()})(window.__lab)`) as Promise<T>;
async function open(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/${query}`);
  await page.waitForSelector('body[data-ready="1"]');
  await page.click('#lab-toggle');
  await page.click('#stats-toggle');
  return errors;
}
const state = (page: Page) => lab(page, l => {
  const c = l.runner.sim.core, cons = c.conservationError();
  return { main: c.ledger.main, bonus: c.ledger.bonusProduced + c.ledger.bonusSeed, bonusProduced: c.ledger.bonusProduced, completed: c.stats.completed, paid: c.stats.tokensPaid, cons, dup: c.stats.duplicateArrivals + c.stats.duplicateExits, live: { ...l.liveBackends }, plinko: l.runner.sim.plinko.id, pusher: l.runner.sim.pusher.id, renderer: (() => { const g = l.view.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() };
});

for (const [plinko, pusher] of [['custom', 'custom-stack'], ['rapier2d', 'rapier3d-stacked'], ['rapier2d', 'rapier3d-planar']]) {
  test(`빈 상태의 전체 공정: ${plinko} / ${pusher} 생산 토큰 회수`, async ({ page }) => {
    // Separate budgets per backend: the physical carrier adds real transit/backpressure time.
    test.setTimeout(180000);
    const errors = await open(page, `?preset=basic&seedTokens=0&plinko=${plinko}&pusher=${pusher}`);
    await page.selectOption('#speed', '4');
    await expect.poll(async () => (await state(page)).bonusProduced, { timeout: 165000, intervals: [1000] }).toBeGreaterThan(0);
    const s = await state(page);
    console.log(plinko, pusher, JSON.stringify(s));
    expect(s.plinko).toBe(plinko); expect(s.pusher).toBe(pusher);
    expect(s.main).toBeGreaterThan(0); expect(s.bonusProduced).toBeGreaterThan(0);
    expect(s.cons).toEqual({ produced: 0, seed: 0, raw: 0 });
    expect(s.dup).toBe(0);
    expect(await lab(page, l => l.runner.sim.core.stats.seedPlaced)).toBe(0);
    expect(await lab(page, l => l.runner.sim.core.stats.lostTokens)).toBe(0);
    expect(s.live.plinko).toBe(1); expect(s.live.pusher).toBe(1);
    await page.screenshot({ path: `test-results/flow-${plinko}-${pusher}.png` });
    expect(errors).toEqual([]);
  });
}

test('백엔드 교체 시 이전 월드가 남지 않고 같은 초기 상태로 재시작한다', async ({ page }) => {
  const errors = await open(page, '?preset=basic&paused=1');
  for (const [plinko, pusher, worlds] of [['rapier2d', 'rapier3d-stacked', 2], ['custom', 'rapier3d-planar', 1], ['rapier2d', 'custom', 1], ['custom', 'custom', 0]] as const) {
    await page.selectOption('#plinko-backend', plinko);
    await page.selectOption('#pusher-backend', pusher);
    await expect.poll(() => lab(page, l => (l.runner.busy ? null : l.runner.sim?.pusher.id))).toBe(pusher);
    const s = await state(page);
    expect(s.plinko).toBe(plinko);
    expect(s.live).toEqual({ plinko: 1, pusher: 1, engineWorlds: worlds });
    expect(await lab(page, l => ({ seeds: l.runner.sim.core.tray.size + l.runner.sim.core.feedQueue.length, t: l.runner.sim.core.time }))).toEqual({ seeds: 650, t: 0 });
  }
  expect(errors).toEqual([]);
});

test('회전 배치: 변환 일치, 화면 클릭 페그 선택, 실제 화면 확인', async ({ page }) => {
  const errors = await open(page, '?preset=structure');
  for (const placement of ['default', 'yaw', 'tilt', 'roll', 'compound']) {
    await page.click(`[data-placement="${placement}"]`);
    await page.click('#left [data-cam="plinko"]');
    await page.waitForTimeout(900);
    expect(await lab(page, l => l.view.placementError())).toBeLessThan(1e-5);
    const target = await lab(page, l => { const s = l.runner.sim, b = s.scenario.board; const p = s.layout.pegs.reduce((best: any, peg: any) => Math.hypot(peg.u-b.width/2,peg.v-b.height/2) < Math.hypot(best.u-b.width/2,best.v-b.height/2) ? peg : best); return { index: p.index, ...l.view.projectLocal(p.u, p.v) }; });
    await page.mouse.click(target.x, target.y);
    await expect(page.locator('#peg-info')).toContainText(`#${target.index} `);
    await page.screenshot({ path: `test-results/placement-${placement}.png` });
  }
  await page.click('#left [data-cam="all"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'test-results/placement-compound-all.png' });
  expect(errors).toEqual([]);
});

test('화면 밖 처리 전환은 가치를 보존하고 복귀 후 이어서 동작한다', async ({ page }) => {
  const errors = await open(page, '?preset=basic');
  await page.selectOption('#speed', '4');
  await page.waitForTimeout(4000);
  await page.check('#offscreen');
  await expect(page.locator('#offscreen-overlay')).toBeVisible();
  const frozen = await lab(page, l => ({ items: l.runner.sim.core.items.size, tray: l.runner.sim.core.tray.size }));
  await page.waitForTimeout(3000);
  const mid = await state(page);
  expect(mid.cons).toEqual({ produced: 0, seed: 0, raw: 0 });
  expect(await lab(page, l => ({ items: l.runner.sim.core.items.size, tray: l.runner.sim.core.tray.size }))).toEqual(frozen);
  await page.uncheck('#offscreen');
  await expect(page.locator('#offscreen-overlay')).toBeHidden();
  await page.waitForTimeout(3000);
  const after = await state(page);
  expect(after.completed).toBeGreaterThan(mid.completed);
  expect(after.cons).toEqual({ produced: 0, seed: 0, raw: 0 });
  expect(after.dup).toBe(0);
  expect(errors).toEqual([]);
});

test('숨김 탭 복귀 시 경과 시간을 한 번만 정산한다', async ({ page }) => {
  const errors = await open(page, '?preset=basic');
  await page.waitForTimeout(1500);
  const setHidden = (hidden: boolean) => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await setHidden(true);
  const before = await lab(page, l => ({ t: l.runner.sim.core.time, tick: l.runner.sim.tick, done: l.runner.sim.core.stats.completed }));
  await page.waitForTimeout(3000);
  expect(await lab(page, l => l.runner.sim.tick)).toBe(before.tick); // 숨김 중 물리 진행 없음
  await setHidden(false);
  const after = await lab(page, l => ({ t: l.runner.sim.core.time, tick: l.runner.sim.tick, cons: l.runner.sim.core.conservationError(), off: l.runner.sim.core.offscreen }));
  expect(after.t - before.t).toBeGreaterThan(2.5);
  expect(after.t - before.t).toBeLessThan(3.8);
  expect(after.off).toBe(false);
  expect(after.cons).toEqual({ produced: 0, seed: 0, raw: 0 });
  await expect(page.locator('#toast')).toContainText('정산');
  expect(errors).toEqual([]);
});

test('품질 변경은 새 메시 설정에 즉시 반영되고 이전 인스턴스 자원을 해제한다', async ({ page }) => {
  const errors = await open(page, '?preset=empty&plinko=custom&pusher=custom-stack&quality=low&paused=1');
  const segments = () => lab(page, l => {
    const tokens = l.view.scene.getObjectsByProperty('isInstancedMesh', true).find((m: any) => m.instanceMatrix.count === l.runner.scenario.flow.trayMaxTokens + 64);
    return tokens.geometry.parameters.radialSegments;
  });
  expect(await segments()).toBe(10);
  await lab(page, l => {
    (window as any).__disposedInstances = 0;
    (window as any).__instanceCount = l.view.scene.getObjectsByProperty('isInstancedMesh', true).length;
    l.view.scene.traverse((object: any) => {
      if (object.isInstancedMesh) object.addEventListener('dispose', () => (window as any).__disposedInstances++);
    });
  });
  await page.selectOption('#quality', 'high');
  await expect.poll(segments).toBe(16);
  expect(await page.evaluate(() => (window as any).__disposedInstances)).toBe(await page.evaluate(() => (window as any).__instanceCount));
  await page.selectOption('#quality', 'low');
  await expect.poll(segments).toBe(10);
  expect(errors).toEqual([]);
});

test('측정 결과는 개별 페그 설정을 보존하고 데모 투입을 섞지 않는다', async ({ page }) => {
  const errors = await open(page, '?preset=empty&plinko=custom&pusher=custom-stack&paused=1');
  await lab(page, l => {
    l.runner.editPeg(0, 'splitter', 4);
    l.runner.configure((s: any) => { s.measure = { warmupSec: 0, measureSec: 0.1, repeats: 2 }; });
    l.runner.demo = { on: true, t: 8, cam: 0 };
    const done = l.runner.onBenchDone;
    l.runner.onBenchDone = (result: any) => {
      (window as any).__benchSupplied = l.runner.sim.core.stats.supplied;
      done(result);
    };
  });
  await page.click('#bench-run');
  await expect.poll(() => lab(page, l => l.runner.results.length)).toBe(1);
  const result = await lab(page, l => ({ result: l.runner.results[0], supplied: (window as any).__benchSupplied }));
  expect(result.supplied).toBe(0);
  expect(result.result.input.pegOverrides).toEqual([{ index: 0, kind: 'splitter', level: 4 }]);
  expect(result.result.repeats.map((r: any) => r.plinkoStep.n)).toEqual([6, 6]);
  await page.click('#save-a');
  await expect(page.locator('#bench-body')).toContainText('A');
  expect(errors).toEqual([]);
});
