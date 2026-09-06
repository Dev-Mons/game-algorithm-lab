import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runExperiment, type ExperimentId } from '../src/lab/experiments';
import { presetConfig } from '../src/physics/config';
import { measureHandling, measureRollControl } from '../src/lab/handling';
const results = [];
for (const [id, preset] of [
  ['acceleration', 'balanced'], ['braking', 'balanced'], ['braking', 'ice'],
  ['circle', 'balanced'], ['circle', 'drift'], ['slalom', 'balanced'],
  ['drop', 'balanced'], ['drop', 'bounce'], ['jump', 'balanced'], ['bumps', 'balanced'],
  ['acceleration', 'minicar'], ['braking', 'minicar'], ['slalom', 'minicar'], ['jump', 'minicar'], ['bumps', 'minicar'],
]) {
  const start = performance.now();
  const { rows: _rows, ...result } = runExperiment(id as Exclude<ExperimentId, 'manual'>, presetConfig(preset));
  results.push({ preset, ...result, elapsedMs: performance.now() - start });
}
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/measurements.json', JSON.stringify(results, null, 2));
console.table(results.filter(r => r.id === 'acceleration').map(r => ({ preset: r.preset, '90% target s': r.secondsTo90?.toFixed(2), '95% target s': r.secondsTo95?.toFixed(2) })));
const minicarAcceleration = results.find(r => r.id === 'acceleration' && r.preset === 'minicar')!;
if ((minicarAcceleration.secondsTo90 ?? Infinity) > 1.5 || (minicarAcceleration.secondsTo95 ?? Infinity) > 1.8) process.exitCode = 1;
console.table(results.map(r => ({ test: r.id, preset: r.preset, 'max km/h': r.maxSpeed.toFixed(1), 'air s': r.airborne.toFixed(2), 'brake m': r.stopDistance?.toFixed(2) ?? '—', 'penetration mm': (r.maxPenetration * 1000).toFixed(2), finite: r.finite, 'time ms': r.elapsedMs.toFixed(0) })));
if (results.some(r => !r.finite || r.maxPenetration > 0.015 || r.maxWork > 96)) process.exitCode = 1;
const handling = ['balanced', 'drift'].flatMap(preset => (['pulse', 'keyboard'] as const).map(profile => ({ preset, profile, ...measureHandling(presetConfig(preset), 1, 'flat', profile) })));
writeFileSync('artifacts/handling.json', JSON.stringify(handling, null, 2));
console.table(handling.map(h => ({ preset: h.preset, input: h.profile, 'peak slip %': (h.peakSlip * 100).toFixed(1), 'turn degrees': (h.totalYaw * 180 / Math.PI).toFixed(1), 'roll degrees': (h.peakRoll * 180 / Math.PI).toFixed(1), 'load difference N': h.peakLoadDifference.toFixed(0), 'final yaw rad/s': h.finalYawRate.toFixed(3) })));
if (handling.some(h => h.totalYaw > Math.PI / 2 || h.finalSlip > 0.02 || h.finalYawRate > 0.05 || h.maxPenetration > 0.015)) process.exitCode = 1;
const rollResults = [3, 4, 8].flatMap(friction80 => [1, 0.25].map(rollInfluence => ({ friction80, rollInfluence,
  ...measureRollControl({ ...presetConfig('minicar'), friction40: 2, friction80, friction160: friction80, rollInfluence, rollInfluence40: rollInfluence, rollInfluence80: rollInfluence, rollInfluence160: rollInfluence }),
})));
writeFileSync('artifacts/roll-control.json', JSON.stringify(rollResults, null, 2));
console.table(rollResults.map(r => ({ 'high-speed friction': r.friction80, 'roll influence': r.rollInfluence, 'max roll degrees': r.maxRollDegrees.toFixed(2), 'air s': r.airborne.toFixed(2), upright: r.minUp > 0 })));
if (rollResults.some(r => !r.finite || r.maxPenetration > 0.015 || r.maxWork > 96 || (r.rollInfluence === 0.25 && (r.minUp < 0.98 || r.airborne > 0)))) process.exitCode = 1;
