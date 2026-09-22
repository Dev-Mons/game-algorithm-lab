import {test,expect} from '@playwright/test';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {createDocument} from '../src/core/document';
import {box} from '../src/fixtures';
import type {MeasurementSample,Timings} from '../src/measurement';

test.use({screenshot:'off',trace:'off'});
const stats=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {n:v.length,p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1)};};

test('@measure first scene execution without planner or geometry caches',async({browser})=>{
  test.setTimeout(180_000);
  const rows:unknown[]=[],viewport={width:1440,height:960};
  const buildArtifacts=Object.fromEntries(await Promise.all((await readdir('dist/assets')).filter(f=>/\.(js|css)$/.test(f)).sort().map(async f=>[f,createHash('sha256').update(await readFile(`dist/assets/${f}`)).digest('hex')])));
  const report={measuredAt:new Date().toISOString(),browser:browser.version(),cpu:os.cpus()[0]?.model,buildArtifacts,protocol:{viewport,seed:42,dimensions:[28,24,28],samples:3,camera:'iso',scope:'existing environmentMeasure.accept: parse/load, full generation, Viewer sync, UI/history publication and canonical output signatures; then two requestAnimationFrame callbacks',limitations:['n=3 cannot estimate stable p95; p95 is maximum','two rAF interval offers a render opportunity; GPU completion, compositor paint and physical display are not measured','browser navigation excluded; fresh contexts in one Chromium process, not fresh OS/process cold starts']},rows};
  for(const profile of ['shop','urban-shop'] as const){
    const input=JSON.stringify(createDocument(box(28,24,28),42,profile));
    const samples:Array<{sample:MeasurementSample;timings:Timings;acceptThroughTwoRafMs:number;renderer:string}>=[];
    for(let i=0;i<3;i++){
      const context=await browser.newContext({viewport}),page=await context.newPage();
      try{
        await page.goto('/?measure=1');await page.waitForFunction(()=>(window as any).environmentMeasure);
        const row=await page.evaluate(async text=>{
          const api=(window as any).environmentMeasure,start=performance.now();
          const sample=api.accept(text),timings=api.timings();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const acceptThroughTwoRafMs=performance.now()-start,gl=document.querySelector('canvas')!.getContext('webgl2')!,ext=gl.getExtension('WEBGL_debug_renderer_info');
          return {sample,timings,acceptThroughTwoRafMs,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
        },input);
        expect(row.sample.initializationState).toEqual({plannerCacheEntries:0,geometryCacheEntries:0,startupGenerationCount:0});
        expect(row.sample.generationCalls).toBe(1);expect(row.sample.viewerSyncCalls).toBe(1);
        await expect(page.locator('#error')).toBeHidden();samples.push(row);
      }finally{await context.close();}
    }
    const summary={acceptance:stats(samples.map(s=>s.sample.totalMs)),generation:stats(samples.map(s=>s.timings.total-s.timings.rendererSync)),viewerSync:stats(samples.map(s=>s.timings.rendererSync)),geometryBuild:stats(samples.map(s=>s.timings.rendererStages?.geometryBuild??0)),acceptThroughTwoRaf:stats(samples.map(s=>s.acceptThroughTwoRafMs))};
    rows.push({profile,summary,samples});console.log(profile,'startup',JSON.stringify(summary));
  }
  await mkdir('benchmarks',{recursive:true});await writeFile(process.env.BUILDING_STARTUP_OUTPUT??'benchmarks/building-startup.current.json',JSON.stringify(report,null,2)+'\n');
});
