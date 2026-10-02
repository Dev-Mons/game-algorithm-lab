// 헤드리스 물리 비교 측정(렌더링 제외). 사용: npm run measure [-- --quick] [-- --presets=basic,stress]
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { benchMeta, BenchRecorder, overview, type BenchResult } from '../src/lab/bench';
import { createScenario, type PresetId, type Scenario } from '../src/lab/scenario';
import { Simulation } from '../src/lab/simulation';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const presets = (args.find(a => a.startsWith('--presets='))?.slice(10).split(',') ?? ['basic', 'growth', 'stress']) as PresetId[];
const only = args.find(a => a.startsWith('--combos='))?.slice(9).split(',').map(c => { const [plinko, pusher] = c.split('+'); return { plinko, pusher } as Scenario['backends']; });
const combos: Array<Scenario['backends']> = only ?? [
  { plinko: 'custom', pusher: 'custom-stack' },
  { plinko: 'rapier2d', pusher: 'custom-stack' },
  { plinko: 'rapier2d', pusher: 'rapier3d-stacked' },
  { plinko: 'custom', pusher: 'custom' },
  { plinko: 'rapier2d', pusher: 'rapier3d-planar' },
];
const env = `node ${process.version} · ${platform()} ${release()} · ${cpus()[0]?.model ?? '?'} ×${cpus().length}`;

const results: BenchResult[] = [];
for (const preset of presets) {
  for (const backends of combos) {
    let result: BenchResult | null = null;
    const base = createScenario(preset);
    const repeats = quick ? 1 : base.measure.repeats;
    for (let r = 0; r < repeats; r++) {
      const scenario = { ...createScenario(preset), backends };
      const sim = await Simulation.create(scenario);
      const warm = Math.round((quick ? 2 : scenario.measure.warmupSec) / scenario.fixedDt);
      const span = Math.round((quick ? 4 : scenario.measure.measureSec) / scenario.fixedDt);
      for (let i = 0; i < warm; i++) { sim.step(); sim.sync(); }
      const rec = new BenchRecorder(sim);
      for (let i = 0; i < span; i++) { sim.step(); rec.afterTick(); rec.afterSync(sim.sync()); }
      const cons = sim.core.conservationError();
      if (cons.produced || cons.seed || cons.raw) { console.error('가치 보존 오류', preset, backends, cons); process.exitCode = 1; }
      result ??= { ...benchMeta(sim, env, 'node headless'), repeats: [] };
      result.repeats.push(rec.finish());
      sim.dispose();
    }
    results.push(result!);
  }
}

mkdirSync('artifacts', { recursive: true });
writeFileSync(only ? `artifacts/measurements-${only.map(c => `${c.plinko}+${c.pusher}`).join(',')}.json` : 'artifacts/measurements.json', JSON.stringify({ env, quick, results }, null, 2));
const f = (v: number | null, d = 3) => (v === null ? '측정 불가' : v.toFixed(d));
console.log(env);
console.table(results.map(r => {
  const o = overview(r);
  return {
    preset: r.scenario.preset, plinko: r.backends.plinko, pusher: r.backends.pusher, 조건: r.condition,
    '원석 평균/최대': `${f(o.items, 0)}/${f(o.itemsMax, 0)}`, '토큰 평균': f(o.tokens, 0),
    'plinko ms 중앙/p95': `${f(o.plinkoMedian)}/${f(o.plinkoP95)}`, 'pusher ms 중앙/p95': `${f(o.pusherMedian)}/${f(o.pusherP95)}`,
    '어댑터 ms(플링코/푸셔)': `${f(o.plinkoAdapterMedian)}/${f(o.pusherAdapterMedian)}`, '전달 ms 중앙': f(o.transferMedian), '활성/휴면': `${f(o.active, 0)}/${f(o.sleeping, 0)}`,
    'init ms': `${f(o.initPlinko, 1)}/${f(o.initPusher, 1)}`, '최대 겹침%': f(o.maxOverlapPct, 1), '20%+겹침쌍': f(o.overlappedPairs, 1),
    '튀어오름': f(o.high, 0), '유실': f(o.lostTokens, 0), '끼임보정': f(o.unstuck, 0), '완료': f(o.completed, 0), '회수 토큰': f(o.tokensPaid, 0),
  };
}));
