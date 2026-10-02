// 브라우저(렌더링 포함) 순차 비교 측정. 창을 띄우지 않는 헤드리스 Chromium에서 UI의 '측정 실행' → 'A/B 저장' 흐름을 그대로 구동한다.
// 사용: npm run measure:browser [-- --presets=basic,stress] [-- --quick]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { overview, type BenchResult } from '../src/lab/bench';

const args = process.argv.slice(2);
const presets = args.find(a => a.startsWith('--presets='))?.slice(10).split(',') ?? ['basic', 'stress'];
const quick = args.includes('--quick');
const combos = args.find(a => a.startsWith('--combos='))?.slice(9).split(',').map(c => c.split('+'))
  ?? [['custom', 'custom-stack'], ['rapier2d', 'custom-stack'], ['rapier2d', 'rapier3d-stacked'], ['custom', 'custom'], ['rapier2d', 'rapier3d-planar']];

const server = await createServer({ server: { port: 4193, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--ignore-gpu-blocklist', '--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
const results: BenchResult[] = [];
let gpu = '';
try {
  for (const preset of presets) {
    for (const [plinko, pusher] of combos) {
      await page.goto(`http://127.0.0.1:4193/?preset=${preset}&plinko=${plinko}&pusher=${pusher}`);
      await page.waitForSelector('body[data-ready="1"]');
      gpu ||= await page.evaluate(() => { const g = (window as any).__lab.view.renderer.getContext(); const e = g.getExtension('WEBGL_debug_renderer_info'); return `${e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'} · crossOriginIsolated=${crossOriginIsolated}`; });
      if (quick) await page.evaluate(() => { const s = (window as any).__lab.runner.scenario; s.measure = { warmupSec: 5, measureSec: 4, repeats: 1 }; });
      const before = await page.evaluate(() => (window as any).__lab.runner.results.length);
      await page.click('#bench-run');
      await page.waitForFunction(n => (window as any).__lab.runner.results.length > n, before, { timeout: 600000, polling: 1000 });
      await page.click(results.length % 2 === 0 ? '#save-a' : '#save-b');
      const r = await page.evaluate(() => { const l = (window as any).__lab; return l.runner.results[l.runner.results.length - 1]; }) as BenchResult;
      results.push(r);
      console.log(`완료 ${preset} ${plinko}+${pusher}`);
    }
    await page.screenshot({ path: `artifacts/browser-bench-${preset}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
mkdirSync('artifacts', { recursive: true });
writeFileSync(args.some(a => a.startsWith('--combos=')) ? `artifacts/browser-measurements-${args.find(a => a.startsWith('--combos='))!.slice(9)}.json` : 'artifacts/browser-measurements.json', JSON.stringify({ gpu, quick, results, errors }, null, 2));
const f = (v: number | null, d = 3) => (v === null ? '측정 불가' : v.toFixed(d));
console.log(gpu);
console.log(results[0]?.env);
console.table(results.map(r => {
  const o = overview(r);
  return {
    preset: r.scenario.preset, backends: `${r.backends.plinko}+${r.backends.pusher}`, 조건: r.condition,
    '원석/토큰': `${f(o.items, 0)}/${f(o.tokens, 0)}`, 'plinko 중앙/p95': `${f(o.plinkoMedian)}/${f(o.plinkoP95)}`, 'pusher 중앙/p95': `${f(o.pusherMedian)}/${f(o.pusherP95)}`,
    '어댑터(플링코/푸셔)': `${f(o.plinkoAdapterMedian)}/${f(o.pusherAdapterMedian)}`, '전달 중앙/p95': `${f(o.transferMedian)}/${f(o.transferP95)}`, '프레임 CPU 중앙/p95': `${f(o.frameMedian, 2)}/${f(o.frameP95, 2)}`, '간격 중앙': f(o.intervalMedian, 1),
    '활성/휴면': `${f(o.active, 0)}/${f(o.sleeping, 0)}`, 'init': `${f(o.initPlinko, 1)}/${f(o.initPusher, 1)}`, 'JS힙ΔMB': f(o.heap, 1), '버린ms': f(o.droppedMs, 0),
  };
}));
if (errors.length) { console.error(errors); process.exitCode = 1; }
