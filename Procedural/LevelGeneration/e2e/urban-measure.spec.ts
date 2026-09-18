import {test,expect} from '@playwright/test';
import {writeFile,mkdir,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {createDocument} from '../src/core/document';
import {box} from '../src/fixtures';
import type {MeasurementSample} from '../src/measurement';
test.use({screenshot:'off',trace:'off'});

test('@measure urban and legacy 32³ application cost including Viewer and history',async({browser})=>{
  test.setTimeout(900000);
  const rows:unknown[]=[],artifacts=await Promise.all((await readdir('dist/assets')).filter(f=>/\.(js|css)$/.test(f)).sort().map(async f=>[f,createHash('sha256').update(await readFile(`dist/assets/${f}`)).digest('hex')]));
  const report={measuredAt:new Date().toISOString(),browser:browser.version(),cpu:os.cpus()[0]?.model,buildArtifacts:Object.fromEntries(artifacts),protocol:{coldSamples:20,warmup:10,warmSamples:50,scope:'document acceptance, validation, generation, Viewer sync, history; excludes browser navigation, GPU completion and paint',referenceLimitsMs:{cold:500,warm:250}},rows};
  await mkdir('benchmarks',{recursive:true});const persist=()=>writeFile('benchmarks/urban-browser-performance.json',JSON.stringify(report,null,2)+'\n');
  const open=async()=>{const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();await page.goto('/?measure=1');await page.waitForFunction(()=>(window as any).environmentMeasure);return {context,page};};
  for(const profile of ['office','urban-office'] as const){
    const doc=JSON.stringify(createDocument(box(32,32,32),17,profile)),cold:MeasurementSample[]=[],warm:MeasurementSample[]=[];
    for(let i=0;i<20;i++){const {context,page}=await open();try{const s:MeasurementSample=await page.evaluate(text=>(window as any).environmentMeasure.accept(text),doc);expect(s.initializationState).toEqual({plannerCacheEntries:0,geometryCacheEntries:0,startupGenerationCount:0});expect(s.generationCalls).toBe(1);expect(s.viewerSyncCalls).toBe(1);cold.push(s);}finally{await context.close();}}
    const {context,page}=await open();try{await page.evaluate(text=>(window as any).environmentMeasure.accept(text),doc);for(let i=0;i<60;i++){const s:MeasurementSample=await page.evaluate(()=>(window as any).environmentMeasure.repeat());if(i>=10)warm.push(s);}}finally{await context.close();}
    for(const [kind,samples,limit] of [['cold',cold,500],['warm',warm,250]] as const){const sorted=samples.map(s=>s.totalMs).sort((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];rows.push({profile,kind,limitMs:limit,passed:p95<=limit,p50:sorted[Math.ceil(sorted.length*.5)-1],p95,max:sorted.at(-1),samples});console.log(profile,kind,p95);}
    await persist();
  }
});
