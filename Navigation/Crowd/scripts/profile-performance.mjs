// Run against an existing dev server: node scripts/profile-performance.mjs [baseURL]
// Isolated browser: never changes the user's open simulation or production code.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4273';
const output = 'test-results/performance-profile';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const report = { browser: browser.version(), createdAt: new Date().toISOString(), cases: [] };
try {
  for (const [scenario, agents] of [['rocky-pass', 1000], ['open-field', 10000], ['rocky-pass', 10000]]) {
    await page.goto(`${base}/?scenario=${scenario}&agents=${agents}&scale=true&seed=42&paused=true`);
    await page.waitForFunction(() => window.crowdDebug?.ready);
    const result = await page.evaluate(async () => {
      const s = window.crowdDebug.simulation();
      const distribution = values => {
        const sorted = [...values].sort((a, b) => a - b);
        return { mean: values.reduce((a, b) => a + b, 0) / values.length,
          p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] };
      };
      for (let i = 0; i < 30; i++) s.step();
      const steps = [], passes = {};
      let maxWalls = 0;
      for (let i = 0; i < 120; i++) {
        const start = performance.now();
        s.step();
        steps.push(performance.now() - start);
        maxWalls = Math.max(maxWalls, s.metrics.wallOverlapCount);
        for (const [key, value] of Object.entries(s.experimentStats.passMs)) (passes[key] ??= []).push(value);
      }
      const { CanvasRenderer } = await import('/src/rendering/canvas-renderer.ts');
      const { DEFAULT_DEBUG_OPTIONS } = await import('/src/rendering/debug-drawing.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 720;
      const renderer = new CanvasRenderer(canvas, () => s, { ...DEFAULT_DEBUG_OPTIONS });
      const render = [];
      for (let i = 0; i < 70; i++) {
        const start = performance.now(); renderer.render(1);
        if (i >= 10) render.push(performance.now() - start);
      }
      return { scenario: s.scenario.id, agents: s.state.count, obstacles: s.scenario.obstacles.length,
        world: [s.config.width, s.config.height], grid: [s.navigator.columns, s.navigator.rows],
        step: distribution(steps), passes: Object.fromEntries(Object.entries(passes).map(([k,v]) => [k,distribution(v)])),
        renderCpu: distribution(render), active: s.metrics.activeCount, maxWalls, hash: s.stateHash() };
    });
    report.cases.push(result);
    console.log(JSON.stringify(result));
  }
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  await page.evaluate(() => { for (let i = 0; i < 60; i++) window.crowdDebug.simulation().step(); });
  const { profile } = await session.send('Profiler.stop');
  writeFileSync(`${output}/rocky-10k.cpuprofile`, JSON.stringify(profile));
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const counts = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodes.get(profile.samples[i]);
    const frame = node.callFrame;
    const key = `${frame.functionName || '(anonymous)'} @ ${frame.url.split('?')[0]}:${frame.lineNumber + 1}`;
    counts.set(key, (counts.get(key) ?? 0) + profile.timeDeltas[i]);
  }
  report.cpuSelfTime = [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20)
    .map(([functionName, microseconds]) => ({ functionName, milliseconds: microseconds / 1000 }));
  // Actual app frames include step + render + recorder + UI (headless Chromium).
  await page.evaluate(async () => {
    const { CanvasRenderer } = await import('/src/rendering/canvas-renderer.ts');
    const original = CanvasRenderer.prototype.render;
    window.profileFrames = [];
    let previous = 0;
    CanvasRenderer.prototype.render = function(alpha) {
      const now = performance.now();
      const result = original.call(this, alpha);
      if (previous) window.profileFrames.push({ interval: now - previous, render: performance.now() - now });
      previous = now;
      return result;
    };
  });
  await page.locator('#run-toggle').click();
  await page.waitForFunction(() => window.profileFrames.length >= 90, { }, { timeout: 60000 });
  await page.locator('#run-toggle').click();
  report.live = await page.evaluate(() => {
    const frames = window.profileFrames.slice(10, 90);
    return { samples: frames.length, fps: 1000 / (frames.reduce((a, b) => a + b.interval, 0) / frames.length),
      renderMeanMs: frames.reduce((a,b) => a + b.render, 0) / frames.length,
      step: window.crowdDebug.simulation().stepCount, active: window.crowdDebug.simulation().metrics.activeCount };
  });
  writeFileSync(`${output}/summary.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cpuSelfTime: report.cpuSelfTime, live: report.live }));
} finally {
  await browser.close();
}
