import { expect, test } from '@playwright/test';

test.use({ video: { mode: 'on', size: { width: 1440, height: 900 } } });

test('empty production: slow inline pressing, backpressure, side/rear views and recovery', async ({ page }) => {
  test.setTimeout(100000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?preset=empty&camera=all');
  await page.waitForSelector('body[data-ready="1"]');
  const read = () => page.evaluate(() => {
    const s = (window as any).__lab.runner.sim;
    return { time: s.core.time, made: s.core.stats.tokensMade, fed: s.gateStats.fed, blocked: s.discharge.blocked, seed: s.core.stats.seedPlaced, completed: s.core.stats.completed, cons: s.core.conservationError(), loss: s.core.stats.lostTokens, duplicates: s.core.stats.duplicateExits + s.core.stats.duplicateArrivals, largestDump: s.batchStats.largestDump, phase: s.core.pressPhase, pressCount: s.core.compressionCount, normalY: s.frame.normal.y };
  });
  expect((await read()).normalY).toBeCloseTo(0.5, 8);
  await page.screenshot({ path: 'artifacts/inline-empty.png' });
  await page.click('#presentation-add');
  await page.click('#presentation-add');
  await page.click('#lab-toggle'); await page.selectOption('#speed', '0.25'); await page.click('#lab-toggle');
  await page.click('.workbench-tools [data-cam="transfer"]');
  await page.evaluate(() => {
    const seen: string[] = []; (window as any).__pressSeen = seen;
    const watch = () => { const p = (window as any).__lab.runner.sim.core.pressPhase; if (!seen.includes(p)) seen.push(p); requestAnimationFrame(watch); }; watch();
  });
  await page.waitForFunction(() => (window as any).__lab.runner.sim.core.pressPhase === 'loading', null, { timeout: 30000 });
  await page.screenshot({ path: 'artifacts/inline-loading.png' });
  await page.waitForFunction(() => { const c = (window as any).__lab.runner.sim.core; return c.pressPhase === 'pressing' && c.pressTime > 0.22; }, null, { timeout: 10000 });
  await page.screenshot({ path: 'artifacts/inline-stamping.png' });
  await page.waitForFunction(() => (window as any).__pressSeen.includes('releasing'), null, { timeout: 10000 });
  expect(await page.evaluate(() => (window as any).__pressSeen)).toEqual(expect.arrayContaining(['loading', 'pressing', 'retracting', 'ready', 'releasing']));
  await page.click('#lab-toggle'); await page.selectOption('#speed', '1'); await page.click('#lab-toggle');
  await expect.poll(async () => (await read()).fed, { timeout: 25000 }).toBeGreaterThan(0);
  expect((await read()).seed).toBe(0);
  await page.waitForFunction(() => { const s = (window as any).__lab.runner.sim; return s.batchStats.largestDump >= 6 && s.core.time - s.discharge.releaseAt < 0.2; }, null, { timeout: 20000 });
  await page.waitForTimeout(300); // capture the batch in free fall, below the opened floor
  await page.click('#presentation-pause');
  expect((await read()).largestDump).toBeGreaterThanOrEqual(6);
  const batch = await page.evaluate(() => {
    const s = (window as any).__lab.runner.sim, tick = s.handovers.at(-1).tick;
    return s.handovers.filter((h: any) => h.tick === tick).map((h: any) => s.core.tray.get(h.id)?.value);
  });
  expect(batch.length).toBeGreaterThanOrEqual(6); expect(batch.every((v: number) => v === 1)).toBe(true);
  await page.screenshot({ path: 'artifacts/inline-bulk-drop.png' });
  await page.click('#presentation-pause');
  // A closed tray-capacity gate holds the pressed output and prevents the next stamp.
  await page.evaluate(() => (window as any).__lab.runner.configure((s: any) => { s.flow.trayMaxTokens = 0; }));
  await expect.poll(async () => (await read()).blocked, { timeout: 15000 }).toBe(true);
  await page.screenshot({ path: 'artifacts/inline-held-feed.png' });
  const fed = (await read()).fed;
  await page.waitForTimeout(1800);
  expect((await read()).fed).toBe(fed);
  await page.click('#lab-toggle'); await page.click('#left [data-cam="side"]'); await page.click('#lab-toggle');
  await page.waitForTimeout(800); await page.screenshot({ path: 'artifacts/inline-side.png' });
  await page.click('#lab-toggle'); await page.click('#left [data-cam="rear"]'); await page.click('#lab-toggle');
  await page.waitForTimeout(800); await page.screenshot({ path: 'artifacts/inline-rear.png' });
  await page.evaluate(() => (window as any).__lab.runner.configure((s: any) => { s.flow.trayMaxTokens = 1500; }));
  await expect.poll(async () => (await read()).fed).toBeGreaterThan(fed);
  const result = await read();
  expect(result.completed).toBeGreaterThan(0); expect(result.loss).toBe(0); expect(result.duplicates).toBe(0);
  expect(result.cons).toEqual({ produced: 0, seed: 0, raw: 0 });
  console.log('Empty inline press', JSON.stringify(result));
  await page.goto('/?preset=basic&camera=all&quality=high');
  await page.waitForSelector('body[data-ready="1"]');
  await expect.poll(async () => (await read()).fed, { timeout: 20000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2800);
  await page.screenshot({ path: 'artifacts/inline-overview.png' });
  expect(errors).toEqual([]);
});
