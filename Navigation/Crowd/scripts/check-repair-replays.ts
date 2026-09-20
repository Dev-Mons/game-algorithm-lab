import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { measureGeometry } from '../experiments/fluid-navigation/particles/metrics';
import { stateFromScene } from '../experiments/fluid-navigation/particles/types';
import type { ParticleScene } from '../experiments/fluid-navigation/particles/types';

const root = resolve('docs/research/fluid-navigation/particle-results');
const records = [];
for (const sceneName of ['hole','crack']) for (const mode of ['off','on']) {
  const file = `${sceneName}-42-${mode}.json`;
  const replay = JSON.parse(await readFile(resolve(root,file),'utf8')) as {
    scene: ParticleScene; frames: {time: number; xy: number[]}[];
  };
  const target = sceneName === 'hole' ? 8 : 10;
  const frames = [replay.frames[0]!,replay.frames.find(f => Math.abs(f.time-target) < 1e-6)!];
  if (!frames[1]) throw new Error(`Missing target frame in ${file}`);
  const measurements = [.25,.125].map(h => frames.map(frame => {
    const state = stateFromScene(replay.scene);
    if (frame.xy.length !== state.x.length*2) throw new Error(`Truncated replay: ${file}`);
    state.x.set(frame.xy.filter((_,i) => i%2 === 0)); state.y.set(frame.xy.filter((_,i) => i%2 === 1));
    return measureGeometry(state,replay.scene.speed*frame.time,h);
  }));
  const recoveries = measurements.map(m => 1-m[1]!.voidArea/m[0]!.voidArea);
  const difference = Math.abs(recoveries[1]!-recoveries[0]!);
  const passed = difference <= .05 && (mode === 'on' ? recoveries[1]! >= .8 : Math.abs(recoveries[1]!) <= .05);
  records.push({file,target,coarseRecovery: recoveries[0],fineRecovery: recoveries[1],difference,passed,
    coarse: measurements[0],fine: measurements[1]});
}
await writeFile(resolve(root,'geometry-audit.json'),JSON.stringify({
  note: 'Independent raster-resolution check of recorded world coordinates. Replay coordinates round to 1e-6 d; runtime geometry uses Float64.',
  records},null,2)+'\n');
console.log(JSON.stringify(records.map(({file,coarseRecovery,fineRecovery,difference,passed}) =>
  ({file,coarseRecovery,fineRecovery,difference,passed})),null,2));
if (records.some(r => !r.passed)) process.exitCode = 1;
