import { expect, test } from '@playwright/test';

// Exercise the actual preset/URL path to completion, not merely a few startup ticks.
const cases = [
  ...['B0', 'B1', 'R', 'Q', 'D'].map(preset => ({ preset, agents: 128, ticks: 3600 })),
  ...['R', 'Q'].map(preset => ({ preset, agents: 1000, ticks: 7200 })),
];
for (const { preset, agents, ticks } of cases) {
  test(`${preset} finishes winding corners with ${agents} agents in the browser`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/?scenario=winding-corners&preset=${preset}&agents=${agents}&seed=42&step=${ticks}&paused=true`);
    await expect(page.locator('body')).toHaveAttribute('data-step', String(ticks), { timeout: 110_000 });
    await expect(page.locator('#preset-select')).toHaveValue(preset);
    await expect(page.locator('#scenario-select')).toHaveValue('winding-corners');
    const result = await page.evaluate(() => {
      const s = window.crowdDebug.simulation();
      return { count: s.state.count, arrived: s.metrics.arrivedCount, walls: s.metrics.wallOverlapCount,
        active: s.metrics.activeCount, minimumX: Math.min(...s.state.x),
        unavailableSlots: s.experimentStats.unavailableSlots,
        remaining: Array.from({ length: s.state.count }, (_, i) => i).filter(i => s.state.active[i] === 1).slice(0, 32)
          .map(i => ({ agent: i, x: s.state.x[i], y: s.state.y[i], vx: s.state.vx[i], vy: s.state.vy[i],
            stalledFor: s.state.stalledFor[i], goal: s.goalForAgent(i) })),
        retainedTargets: s.resolvedExperiment.options.destination === 'slots'
          ? Array.from({ length: s.state.count }, (_, i) => s.arrivalSlotForAgent(i) !== undefined).filter(Boolean).length : 0 };
    });
    expect(result.count).toBe(agents);
    expect(result.arrived, JSON.stringify(result.remaining)).toBe(agents);
    expect(result.active).toBe(0);
    expect(result.walls).toBe(0);
    // At 128 bodies every slot is in the last chamber. A 1,000-body retained
    // formation also allocates visible slots before the last wall; its full
    // per-agent required-gate history is covered by the behavior regression.
    if (agents === 128) expect(result.minimumX).toBeGreaterThan(936);
    expect(result.unavailableSlots).toBe(0);
    if (preset === 'R' || preset === 'Q') {
      expect(result.retainedTargets).toBe(agents);
      await expect(page.locator('#destination-description')).toContainText('초록 빈 원');
    }
    expect(errors).toEqual([]);
    await page.locator('#crowd-canvas').screenshot({ path: info.outputPath(`${preset}-corners-complete.png`) });
  });
}
