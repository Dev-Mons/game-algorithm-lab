import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import os from 'node:os';
import { createScene } from '../experiments/fluid-navigation/particles/fixtures';
import { ParticleSimulation } from '../experiments/fluid-navigation/particles/simulation';
import { measureGeometry } from '../experiments/fluid-navigation/particles/metrics';
import type { ParticleScene, Sample, SceneName } from '../experiments/fluid-navigation/particles/types';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.split('=')[1];
const root = resolve('experiments/fluid-navigation');
const seeds = (arg('seeds') ?? '42').split(',').map(Number);
const names = (arg('scenes') ?? 'uniform,hole,crack').split(',') as SceneName[];
const fixtureRoot = resolve(root,'fixtures');
if (!seeds.length || seeds.some(s => !Number.isInteger(s))
  || names.some(n => !['uniform','hole','crack'].includes(n))) throw new Error('Invalid fixture selection');
await mkdir(fixtureRoot,{recursive: true});
if (process.argv.includes('--freeze')) {
  for (const seed of seeds) for (const name of names) {
    await writeFile(resolve(fixtureRoot,`${name}-${seed}.json`),JSON.stringify(createScene(name,seed),null,2)+'\n');
  }
  console.log(`Froze ${seeds.length*names.length} fixtures before candidate execution.`);
} else {
  const output = resolve(arg('output') ?? 'docs/research/fluid-navigation/particle-results');
  await mkdir(output,{recursive: true});
  const sourceFiles = ['scripts/measure-repair.ts','src/core/random.ts','package-lock.json',
    ...(await readdir(resolve(root,'particles'))).filter(f => f.endsWith('.ts')).map(f => `experiments/fluid-navigation/particles/${f}`)];
  const sources = await Promise.all(sourceFiles.map(async path => ({path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex')})));
  const records = [];
  for (const seed of seeds) for (const name of names) {
    const raw = await readFile(resolve(fixtureRoot,`${name}-${seed}.json`),'utf8');
    const fixtureHash = createHash('sha256').update(raw).digest('hex');
    const scene = JSON.parse(raw) as ParticleScene;
    for (const enabled of [false,true]) {
      const sim = new ParticleSimulation(scene,enabled,Number(arg('dt') ?? 1/60));
      const duration = Number(arg('duration') ?? scene.duration), samples: Sample[] = [];
      if (!Number.isFinite(duration) || duration <= 0 || duration > scene.duration) throw new Error('Invalid duration');
      const frames: {time: number; xy: number[]}[] = [];
      const times: number[] = [];
      const capture = () => {
        const geometry = measureGeometry(sim.state,scene.speed*sim.time);
        samples.push({...geometry,...sim.stats,time: sim.time});
      };
      const frame = () => frames.push({time: sim.time,xy: Array.from(sim.state.x).flatMap((x,i) =>
        [Number(x.toFixed(6)),Number(sim.state.y[i]!.toFixed(6))])});
      capture(); frame();
      const sampleEvery = Math.max(1,Math.round(.5/sim.dt));
      const frameEvery = Math.max(1,Math.round(.1/sim.dt));
      const stepCount = Math.round(duration/sim.dt);
      for (let step = 1; step <= stepCount; step++) {
        const start = performance.now(), ok = sim.step(); times.push(performance.now()-start);
        if (!ok || step%sampleEvery === 0 || step === stepCount) capture();
        if (!ok || step%frameEvery === 0 || step === stepCount) frame();
        if (!ok) break;
      }
      times.sort((a,b) => a-b);
      const initial = samples[0]!, final = samples.at(-1)!;
      const targetTime = name === 'hole' ? 8 : 10;
      const target = samples.find(s => s.time >= targetTime-1e-6) ?? final;
      const recovery = initial.voidArea ? 1-target.voidArea/initial.voidArea : null;
      const footprintChange = Math.max(...samples.map(s => Math.abs(s.footprintArea/initial.footprintArea-1)));
      const checks = {
        completed: !sim.failure && Math.abs(sim.time-duration) < 1e-6,
        geometry: sim.maxima.penetration <= 1e-7 && sim.maxima.sweptPenetration <= 1e-7,
        speed: sim.maxima.maxSpeed <= sim.maxSpeed+1e-7 && sim.maxima.maxObservedSpeed <= sim.maxSpeed+1e-7,
        solver: sim.maxima.primal <= 1e-7 && sim.maxima.stationarity <= 1e-7 && sim.maxima.complementarity <= 1e-7,
        density: sim.maxima.actualDensityViolation <= 1e-3 && sim.maxima.maxSlack <= .02,
        mass: sim.maxima.massError <= 1e-10 && Math.abs(final.mass-initial.mass) <= 1e-10,
        footprint: footprintChange <= .05,
        recovery: name === 'uniform' ? samples.every(s => s.voidArea === 0)
          : enabled ? sim.time >= targetTime-1e-6 && recovery! >= .8 : Math.abs(recovery!) <= .05,
      };
      const record = {scene: name,seed,repair: enabled,actualAgents: scene.disks.length,fixtureHash,
        duration: sim.time,dt: sim.dt,maxSpeed: sim.maxSpeed,cap: sim.cap,recovery,footprintChange,
        failure: sim.failure,retries: sim.retries,passed: Object.values(checks).every(Boolean),checks,maxima: sim.maxima,
        stepMs: {p50: times[Math.floor(times.length*.5)],p95: times[Math.floor(times.length*.95)],
          max: times.at(-1)},passMsPerStep: Object.fromEntries(Object.entries(sim.timings).map(([k,v]) => [k,v/Math.max(1,times.length)])),
        samples};
      const file = `${name}-${seed}-${enabled ? 'on' : 'off'}.json`;
      const saveReplay = arg('replays') !== 'none' || !record.passed;
      if (saveReplay) await writeFile(resolve(output,file),JSON.stringify({scene,record,frames})+'\n');
      records.push({...record,replay: saveReplay ? file : null});
      console.log(JSON.stringify({scene: name,seed,repair: enabled,count: scene.disks.length,
        recovery,footprintChange,failure: sim.failure,passed: record.passed,p95: record.stepMs.p95,
        iterations: sim.maxima.iterations,checks}));
    }
  }
  await writeFile(resolve(output,'summary.json'),JSON.stringify({version: 1,created: new Date().toISOString(),
    scope: 'P0–P2a actual disks, oracle support, open world, CPU reference; not full report qualification',
    node: process.version,cpu: os.cpus()[0]?.model,platform: process.platform,sources,records},null,2)+'\n');
  if (records.some(r => !r.passed)) process.exitCode = 1;
}
