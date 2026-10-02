// 푸셔 감각 측정(헤드리스, 장시간): 더미 높이, 푸셔 왕복당 낙하 분포(무너짐의 간헐성), 트레이 추이, 유실.
// 사용: npm run measure:feel [-- --preset=basic] [-- --seconds=150] [-- --seeds=1234,7,42] [-- --pushers=custom-stack] [-- --set=reposeSlope=1.4,coupling=0.9] [-- --inflow=high]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createScenario, type PresetId } from '../src/lab/scenario';
import { Simulation } from '../src/lab/simulation';
import type { PusherBackendId } from '../src/physics/contracts';

const args = process.argv.slice(2), arg = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const preset = (arg('preset') ?? 'basic') as PresetId, seconds = Number(arg('seconds') ?? 150), warm = 45;
const seeds = (arg('seeds') ?? '1234,7,42').split(',').map(Number);
const pushers = (arg('pushers') ?? 'custom-stack,rapier3d-stacked,custom').split(',') as PusherBackendId[];
const overrides = Object.fromEntries((arg('set') ?? '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
const highInflow = arg('inflow') === 'high';
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const rows = [];
for (const pusher of pushers) for (const seed of seeds) {
  const s = createScenario(preset, seed); s.backends = { plinko: 'rapier2d', pusher };
  Object.assign(s.pusher, overrides);
  // 고유입: 공급·처리·압축을 크게 올려 트레이가 상한에 닿는 조건(더미가 계속 커질 때의 거동)
  if (highInflow) { s.flow.supplyPerSec = 20; s.flow.plinkoReleasePerSec = 20; s.flow.compressCycleSec = 0.1; s.economy.byproductCoef = 3; }
  const sim = await Simulation.create(s);
  const cycle = Math.round(s.tray.period / s.fixedDt), h = s.tray.tokenHalfHeight;
  const per: number[] = [], trays: number[] = [];
  let last = 0, maxLayers = 0, layerSum = 0, layerN = 0;
  for (let i = 1; i <= seconds / s.fixedDt; i++) {
    sim.step(); sim.sync();
    if (i % cycle === 0) { if (i * s.fixedDt > warm) per.push(sim.core.stats.tokensPaid - last); last = sim.core.stats.tokensPaid; }
    if (i % 120 === 0 && i * s.fixedDt > warm) {
      const sn = sim.pusherSnap;
      for (let k = 0; k < sn.count; k++) { const L = (sn.c[k] - h) / (2 * h); if (L > maxLayers) maxLayers = L; layerSum += L; layerN++; }
    }
    if (i % Math.round(30 / s.fixedDt) === 0) trays.push(sim.core.tray.size);
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length, sorted = [...per].sort((a, b) => a - b);
  const cv = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length) / Math.max(1e-9, mean);
  rows.push({
    pusher, seed, cycles: per.length, fallsMean: +mean.toFixed(2), fallsCv: +cv.toFixed(2), fallsMedian: q(sorted, 0.5), fallsP90: q(sorted, 0.9), fallsMax: sorted.at(-1) ?? 0,
    emptyCycles: per.filter(x => x === 0).length, feedWaiting: sim.core.feedQueue.length, maxLayers: +maxLayers.toFixed(1), meanLayer: +(layerSum / Math.max(1, layerN)).toFixed(2), trays: trays.join('→'),
    lost: sim.core.stats.lostTokens, conserved: Object.values(sim.core.conservationError()).every(v => v === 0),
  });
  sim.dispose();
}
mkdirSync('artifacts', { recursive: true });
writeFileSync(`artifacts/feel${highInflow ? '-high' : ''}${arg('set') ? '-' + arg('set')!.replace(/[^a-z0-9.]+/gi, '_') : ''}.json`, JSON.stringify({ preset, seconds, warm, overrides, highInflow, rows }, null, 2));
console.table(rows.map(r => ({ 푸셔: r.pusher, 시드: r.seed, '왕복당 낙하 평균': r.fallsMean, 변동계수: r.fallsCv, 중앙: r.fallsMedian, p90: r.fallsP90, 최대: r.fallsMax, '0개 왕복': `${r.emptyCycles}/${r.cycles}`, '최대 층': r.maxLayers, '평균 층': r.meanLayer, '트레이(30s마다)': r.trays, '투입 대기': r.feedWaiting, 유실: r.lost, 보존: r.conserved })));
if (rows.some(r => !r.conserved)) process.exitCode = 1;
