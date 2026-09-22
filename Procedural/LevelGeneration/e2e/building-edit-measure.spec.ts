import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {createDocument,type Profile} from '../src/core/document';
import {box} from '../src/fixtures';
import type {BuildingEditSample} from '../src/measurement';

test.use({screenshot:'off',trace:'off'});
const size=28,height=24,viewport={width:1440,height:960};
const pilot=process.env.BUILDING_MEASURE_PILOT==='1';
const coldCount=pilot?1:10,warmCount=pilot?2:30,dragCycles=pilot?1:5;
const profiles:Profile[]=pilot?['shop']:['shop','urban-shop'];
const stats=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {n:v.length,p50:v[Math.ceil(v.length*.5)-1],p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1)};};
const samples=(page:Page)=>page.evaluate<BuildingEditSample[]>(()=>(window as any).environmentMeasure.buildingEdits());
async function waitRendered(page:Page,count:number){
  await page.waitForFunction(n=>{const s=(window as any).environmentMeasure.buildingEdits();return s.length===n&&s.at(-1)?.inputToRenderMs!==undefined;},count,{timeout:60_000});
}
async function selectRoof(page:Page){
  await page.locator('[data-camera="top"]').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const points=await page.evaluate(({size,height})=>[[0,height,0],[size-1,height,size-1]].map(p=>(window as any).environmentMeasure.point(p)),{size,height});
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
  await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells',String(size*size));
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-direction','PY');
  await page.locator('canvas').focus();
}
async function keyEdit(page:Page,key:'e'|'q'){
  const before=(await samples(page)).length;await page.keyboard.press(key);await waitRendered(page,before+1);
  await expect(page.locator('#error')).toBeHidden();
}
async function dragCycle(page:Page){
  const canvas=page.locator('canvas'),b=(await canvas.boundingBox())!;
  const h=JSON.parse((await canvas.getAttribute('data-edit-handle'))!) as {x:number;y:number;axisX:number;axisY:number;pixelsPerCell:number};
  const x=b.x+h.x,y=b.y+h.y,before=(await samples(page)).length;
  await page.mouse.move(x,y);await page.mouse.down();
  // One held gesture crosses three successive layers, then reverses to the original roof.
  for(const layer of [1.15,2.15,3.15,1.85,.85,-.15]){
    await page.mouse.move(x+h.axisX*h.pixelsPerCell*layer,y+h.axisY*h.pixelsPerCell*layer,{steps:4});
  }
  await page.mouse.up();await waitRendered(page,before+6);
  await expect(page.locator('#stats strong').first()).toHaveText(String(size*size*height));
}

test('@measure real wide tall building E/Q and continuous pyramid edits',async({browser})=>{
  test.setTimeout(1_800_000);
  const rows:unknown[]=[],assets=await readdir('dist/assets');
  const buildArtifacts=Object.fromEntries(await Promise.all(assets.filter(f=>/\.(js|css)$/.test(f)).sort().map(async f=>[f,createHash('sha256').update(await readFile(`dist/assets/${f}`)).digest('hex')])));
  const renderers=new Set<string>();
  const report={measuredAt:new Date().toISOString(),browser:browser.version(),cpu:os.cpus()[0]?.model,logicalCPUs:os.cpus().length,platform:os.platform(),renderers:[] as string[],buildArtifacts,protocol:{viewport,seed:42,dimensions:[size,height,size],selectedRoofCells:size*size,coldCountPerOperation:coldCount,warmupKeyEdits:4,warmCount,dragCycles,input:'native Playwright E/Q and held pyramid pointer gesture',scope:'native event timestamp through accepted UI state and first following WebGL render submission; no GPU completion or physical paint measurement',coldMeaning:'first volume edit after fresh browser context and initial accepted scene; initial scene caches already exist',warmMeaning:'alternating E/Q returns to prior inputs; drag visits +1/+2/+3 and back',limitations:['first edit n=10 per operation: p95 is maximum; not a stable tail estimate','headless Chromium on this host; software/hardware renderer recorded per context','render submissions may combine consecutive drag edits; supersededBeforeRender marks intermediate accepted states']},rows};
  await mkdir('benchmarks',{recursive:true});
  const filename=process.env.BUILDING_MEASURE_OUTPUT??'benchmarks/building-edit.current.json';
  const persist=()=>{report.renderers=[...renderers];return writeFile(filename,JSON.stringify(report,null,2)+'\n');};
  const addRow=(profile:Profile,kind:string,list:BuildingEditSample[])=>{
    const stageNames=new Set(list.flatMap(s=>Object.keys(s.generation?.stages??{}))),stepNames=new Set(list.flatMap(s=>Object.keys(s.steps))),rendererNames=new Set(list.flatMap(s=>Object.keys(s.generation?.rendererStages??{})));
    const row={profile,kind,summary:{inputToSync:stats(list.map(s=>s.synchronousMs)),inputQueue:stats(list.map(s=>s.inputQueueMs)),handlerToSync:stats(list.map(s=>s.synchronousMs-s.inputQueueMs)),inputToRender:stats(list.map(s=>s.inputToRenderMs!)),generation:stats(list.map(s=>s.generation!.total-s.generation!.rendererSync)),generationOther:stats(list.map(s=>s.generation!.total-s.generation!.rendererSync-Object.values(s.generation!.stages).reduce((a,b)=>a+b,0))),viewerSync:stats(list.map(s=>s.generation!.rendererSync)),renderSubmission:stats(list.map(s=>s.renderSubmissionMs!)),steps:Object.fromEntries([...stepNames].map(n=>[n,stats(list.map(s=>s.steps[n]??0))])),stages:Object.fromEntries([...stageNames].map(n=>[n,stats(list.map(s=>s.generation?.stages[n]??0))])),rendererStages:Object.fromEntries([...rendererNames].map(n=>[n,stats(list.map(s=>s.generation?.rendererStages?.[n]??0))]))},samples:list};rows.push(row);console.log(profile,kind,JSON.stringify(row.summary));
  };
  for(const profile of profiles){
    const document=JSON.stringify(createDocument(box(size,height,size),42,profile));
    const open=async()=>{const context=await browser.newContext({viewport}),page=await context.newPage();await page.goto('/?measure=1');await page.waitForFunction(()=>(window as any).environmentMeasure);await page.evaluate(text=>(window as any).environmentMeasure.accept(text),document);renderers.add(await page.evaluate(()=>{const gl=globalThis.document.querySelector('canvas')!.getContext('webgl2')!,ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}));await selectRoof(page);return {context,page};};
    for(const [kind,key] of [['first-add','e'],['first-remove','q']] as const){
      const cold:BuildingEditSample[]=[];
      for(let i=0;i<coldCount;i++){const {context,page}=await open();try{await keyEdit(page,key);cold.push((await samples(page))[0]);}finally{await context.close();}}
      addRow(profile,kind,cold);await persist();
    }
    const {context,page}=await open();try{
      const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      for(let i=0;i<4;i++)await keyEdit(page,i%2?'q':'e');
      await page.evaluate(()=>(window as any).environmentMeasure.resetBuildingEdits());
      for(let i=0;i<warmCount;i++)await keyEdit(page,i%2?'q':'e');
      addRow(profile,'warm-keys',await samples(page));await persist();
      if(pilot){
        const profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
        for(const key of ['e','q','e','q'] as const)await keyEdit(page,key);
        const result=await profiler.send('Profiler.stop');await writeFile(`benchmarks/building-edit.${profile}.cpuprofile`,JSON.stringify(result.profile));await profiler.detach();
      }
      await page.evaluate(()=>(window as any).environmentMeasure.resetBuildingEdits());
      for(let i=0;i<dragCycles;i++)await dragCycle(page);
      addRow(profile,'continuous-drag',await samples(page));expect(errors).toEqual([]);await persist();
    }finally{await context.close();}
  }
});
