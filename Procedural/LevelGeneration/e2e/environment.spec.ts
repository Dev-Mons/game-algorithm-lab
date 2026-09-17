import {validateStallProof} from '../src/core/parking-stalls';
import {test,expect} from '@playwright/test';
// Explicit screenshots below cover normal cases; performance contexts avoid failure capture overhead.
test.use({screenshot:'off',trace:'off'});
import {createDocument,setBuildingRule} from '../src/core/document';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import type {Page} from '@playwright/test';
async function savedDocument(page:Page){const waiting=page.waitForEvent('download');await page.locator('#save').click();const path=await(await waiting).path();const {readFile}=await import('node:fs/promises');return JSON.parse(await readFile(path!,'utf8')) as ReturnType<typeof createDocument>;}

test('environment pipeline loads inputs and real supported structure; invalid load retains the accepted screen',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('OK');
  const scene=emptySceneInputs();scene.parkingAreas=[{id:'lot',anchor:[0,0,0],cells:box(6,1,5)}];scene.roads=box(6,1,2).map(([x,y,z])=>[x,y,z-2]);
  scene.objects=[{id:'intent',category:'facility',direction:'PY',cells:[[5,0,4]]}];
  const doc=setBuildingRule(createDocument(box(2,2,2),42,'office',undefined,undefined,scene),'0,0,0','parking');
  await page.locator('#file').setInputFiles({name:'environment.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#status')).toHaveText('OK');
  await expect(page.locator('[data-stage="preflight"]')).toHaveAttribute('data-state','ready');
  await expect(page.locator('[data-stage="parkingStalls"]')).toHaveAttribute('data-state','ready');
  const canvas=page.locator('canvas');await expect(canvas).toHaveAttribute('data-scene-assets',/parking-column/);
  await expect(canvas).toHaveAttribute('data-input-outline-count','4');
  const assets=await canvas.getAttribute('data-scene-assets');
  await page.screenshot({path:info.outputPath('environment-preview.png')});
  await page.locator('#file').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...doc,schemaVersion:4}))});
  await expect(page.locator('#error')).toContainText('UNSUPPORTED_DOCUMENT_VERSION');
  await expect(canvas).toHaveAttribute('data-scene-assets',assets!);
  await expect(page.locator('#save')).toBeEnabled();
  const downloadPromise=page.waitForEvent('download');await page.locator('#save').click();
  const saved=await downloadPromise;const path=await saved.path();
  const {readFile}=await import('node:fs/promises');expect(JSON.parse(await readFile(path!,'utf8'))).toEqual(doc);
  expect(errors).toEqual([]);
});

test('parking area drag, source selection, settings, no-op and history share one accepted transaction',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await page.locator('#edit-mode').selectOption('parking');await page.locator('[data-camera="top"]').click();
  const canvas=page.locator('canvas'),b=(await canvas.boundingBox())!,x=b.x+b.width/2,y=b.y+b.height/2;
  await page.mouse.move(x-70,y-70);await page.mouse.down();await page.mouse.move(x+70,y+70,{steps:5});await page.mouse.up();
  const first=await savedDocument(page),area=first.sceneInputs.parkingAreas[0];expect(area.cells.length).toBeGreaterThan(1);
  let counts=JSON.parse((await page.locator('#viewport').getAttribute('data-execution-counts'))!);
  expect(counts.generationCount).toBe(2);expect(counts.viewerSyncCount).toBe(2);expect(counts.historyCommitCount).toBe(1);
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'parking',id:area.id}));
  await page.locator('#plan-inspector summary').filter({hasText:'선택 · 탈락 근거'}).click();
  await expect(page.locator('#plan-inspector')).toContainText('NO_ROAD');
  await page.getByText('환경 설정',{exact:true}).click();
  await page.locator('#environment-setting').selectOption('access.maxWalkDistanceCells');await page.locator('#environment-value').fill('31');await page.locator('#environment-apply').click();
  counts=JSON.parse((await page.locator('#viewport').getAttribute('data-execution-counts'))!);expect(counts.generationCount).toBe(3);expect(counts.historyCommitCount).toBe(2);
  await page.locator('#environment-apply').click();expect(JSON.parse((await page.locator('#viewport').getAttribute('data-edit-record'))!).changed).toBe(false);
  expect(JSON.parse((await page.locator('#viewport').getAttribute('data-execution-counts'))!)).toEqual(counts);
  await page.locator('#environment-value').fill('100');await page.locator('#environment-apply').click();await expect(page.locator('#edit-note')).toContainText('INVALID_ENVIRONMENT_SETTING');
  const settings=await savedDocument(page);expect(settings.environment.access.maxWalkDistanceCells).toBe(31);expect(settings.sceneInputs.parkingAreas).toEqual(first.sceneInputs.parkingAreas);
  await canvas.focus();await page.keyboard.press('Control+z');expect((await savedDocument(page)).environment.access.maxWalkDistanceCells).toBe(24);
  await canvas.focus();await page.keyboard.press('Control+Shift+z');expect((await savedDocument(page)).environment.access.maxWalkDistanceCells).toBe(31);
  await page.screenshot({path:info.outputPath('environment-editor.png')});expect(errors).toEqual([]);
});

test('spatial execution updates actual access paths and reservations after a road edit',async({page},info)=>{
  await page.goto('/');
  const scene=emptySceneInputs();scene.roads=Array.from({length:6},(_,z)=>[6,0,z]);
  scene.objects=[{id:'probe',category:'facility',direction:'PY',cells:[[0,0,2]]}];
  const doc=setBuildingRule(createDocument([[3,0,1],[3,0,2],[3,0,3]],42,'office',undefined,undefined,scene),'3,0,1','parking');
  const load=async(d:typeof doc)=>page.locator('#file').setInputFiles({name:'spatial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});
  await load(doc);await expect(page.locator('[data-stage="spatial"]')).toHaveAttribute('data-state','ready');
  const paths=JSON.parse((await page.locator('canvas').getAttribute('data-access-paths'))!);
  expect(paths[0].path.length).toBeGreaterThan(5);
  await page.screenshot({path:info.outputPath('spatial-detour.png')});
  const removed=structuredClone(doc);removed.sceneInputs.roads=[];await load(removed);
  await expect(page.locator('canvas')).toHaveAttribute('data-access-paths','[]');
  await expect(page.locator('[data-stage="spatial"]')).toHaveAttribute('data-state','ready');
});

test('vertical stage displays H1/H2/H12 bands and connected geometry',async({page},info)=>{
  await page.goto('/');
  for(const height of [1,2,12]){
    const doc=createDocument(box(6,height,3),42,'shop');
    await page.locator('#file').setInputFiles({name:`height-${height}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#scene-name')).toHaveText(`height-${height}.json`);
    await expect(page.locator('[data-stage="vertical"]')).toHaveAttribute('data-state','ready');
    await expect(page.locator('[data-stage="facade"]')).toHaveAttribute('data-state','ready');
    const plans=JSON.parse((await page.locator('canvas').getAttribute('data-vertical-bands'))!);
    expect(plans[0].bands.map((b:any)=>b.yMaxExclusive-b.yMin)).toEqual(height===1?[1]:height===2?[1,1]:[3,8,1]);
  }
  await page.screenshot({path:info.outputPath('vertical-preview-h12.png')});
});

test('common entrance plan produces real facade portals and removes them after road removal',async({page},info)=>{
  await page.goto('/');const scene=emptySceneInputs();scene.roads=box(18,1,2).map(([x,y,z])=>[x,y,z+6]);
  const doc=createDocument(box(18,8,4),42,'shop',undefined,undefined,scene);
  await page.locator('#file').setInputFiles({name:'entrances.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('[data-stage="entrances"]')).toHaveAttribute('data-state','ready');
  const plans=JSON.parse((await page.locator('canvas').getAttribute('data-entrances'))!);expect(plans[0].entrances.length).toBeGreaterThanOrEqual(2);
  await page.locator('.layers > summary').click();
  await page.locator('#environment-inputs').uncheck();await page.locator('#environment-plans').uncheck();
  await page.screenshot({path:info.outputPath('contextual-portals.png')});
  const noRoad=structuredClone(doc);noRoad.sceneInputs.roads=[];
  await page.locator('#file').setInputFiles({name:'without-roads.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(noRoad))});
  await expect(page.locator('#scene-name')).toHaveText('without-roads.json');
  expect(JSON.parse((await page.locator('canvas').getAttribute('data-entrances'))!)[0].entrances).toEqual([]);
});

test('parking circulation and proven stalls display gates, aisle, walk and protected budgets',async({page},info)=>{
  await page.goto('/');const scene=emptySceneInputs();scene.parkingAreas=[{id:'R12',anchor:[0,0,0],cells:box(12,1,12)}];scene.roads=box(12,1,4).map(([x,y,z])=>[x,y,z-4]);
  const doc=createDocument([],42,'office',undefined,undefined,scene);
  await page.locator('#file').setInputFiles({name:'R12.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('[data-stage="parkingCirculation"]')).toHaveAttribute('data-state','ready');
  const plan=JSON.parse((await page.locator('canvas').getAttribute('data-parking-circulation'))!)[0];expect(plan.gateCount).toBeGreaterThan(0);expect(plan.aisleCells).toBeGreaterThan(0);expect(plan.walkCells).toBeGreaterThan(0);expect(plan.budget.stallLimit).toBeGreaterThan(0);
  await expect(page.locator('[data-stage="parkingStalls"]')).toHaveAttribute('data-state','ready');
  const quality=JSON.parse((await page.locator('canvas').getAttribute('data-parking-quality'))!)[0];expect(quality.acceptedStalls).toBeGreaterThanOrEqual(8);expect(quality.aisleRatio).toBeLessThanOrEqual(.6);expect(quality.untestedStalls).toBe(0);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',/parking.line/);
  await page.locator('.layers > summary').click();await page.locator('#environment-inputs').uncheck();await page.locator('#environment-plans').uncheck();
  await page.screenshot({path:info.outputPath('parking-stalls-r12.png')});
});


test('contextual fixtures render authored clusters and refresh after a road change',async({page},info)=>{
  await page.goto('/');const scene=emptySceneInputs();scene.roads=box(16,1,1).map(([x,y])=>[x,y,-1]);
  scene.objects=[{id:'intent',category:'facility',direction:'PY',cells:box(16,1,1)}];
  const doc=createDocument([],42,'office',undefined,undefined,scene);
  await page.locator('#file').setInputFiles({name:'fixtures.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('[data-stage="fixtures"]')).toHaveAttribute('data-state','ready');
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',/fixture.(bin|hydrant)/);
  await page.locator('.layers > summary').click();await page.locator('#environment-inputs').uncheck();await page.locator('#environment-plans').uncheck();
  await page.screenshot({path:info.outputPath('contextual-fixtures.png')});
  doc.sceneInputs.roads=[];await page.locator('#file').setInputFiles({name:'no-road.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('canvas')).not.toHaveAttribute('data-scene-assets',/fixture.(bin|hydrant)/);
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'object',id:'intent'}));
  await page.locator('#plan-inspector summary').filter({hasText:'선택 · 탈락 근거'}).click();
  await expect(page.locator('#plan-inspector')).toContainText('NO_PUBLIC_ACCESS');
});

import {environmentPerformanceFixtures} from '../src/performance-fixtures';
import {canonicalJSON} from '../src/core/canonical';
import {inputSignature} from '../src/environment-editor';
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import type {MeasurementSample} from '../src/measurement';
const quantiles=(samples:MeasurementSample[])=>{const a=samples.map(s=>s.totalMs).sort((a,b)=>a-b);return {first:samples[0].totalMs,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
test.describe('performance protocol',()=>{
 test('@measure environment application-cold, warm-repeat and independent first edits',async({browser})=>{
 test.setTimeout(900000);const fixtures=environmentPerformanceFixtures(),scope=process.env.LEVEL_MEASURE_CASE??'all',rows:any[]=[];if(scope!=='all'&&!Object.hasOwn(fixtures,scope))throw new Error('Unknown measurement case');
 const artifacts=await Promise.all((await readdir('dist/assets')).filter(f=>f.endsWith('.js')||f.endsWith('.css')).sort().map(async f=>[f,createHash('sha256').update(await readFile(`dist/assets/${f}`)).digest('hex')]));
 const report:any={scope,buildMode:'production',buildSHA:createHash('sha256').update(JSON.stringify(artifacts)).digest('hex'),buildArtifacts:Object.fromEntries(artifacts),protocol:{coldSamples:20,warmup:10,warmSamples:50,editSamples:20,percentile:'ceil(n*p)-1',scope:'acceptance or confirmed edit command through validation, generation, Viewer sync, history and accepted publication; excludes navigation, drag travel, GPU and paint'},sourceBaseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedDiffSignature:inputSignature(execFileSync('git',['diff','--','.'],{encoding:'utf8',maxBuffer:100*1024*1024,stdio:['ignore','pipe','ignore']})),browserVersion:browser.version(),machineDescription:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,platform:os.platform(),release:os.release(),architecture:os.arch()},inputs:Object.fromEntries(Object.entries(fixtures).map(([name,doc])=>[name,{document:doc,signature:inputSignature(canonicalJSON(doc))}])),rows};
 await mkdir('benchmarks',{recursive:true});const persist=()=>writeFile(scope==='all'?'benchmarks/environment-performance.json':`benchmarks/environment-performance.${scope}.json`,JSON.stringify(report,null,2)+'\n');
 const open=async()=>{const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();await page.goto('http://127.0.0.1:5178/?measure=1');await page.waitForFunction(()=>(window as any).environmentMeasure);return {context,page};};
 const accept=(page:Page,doc:ReturnType<typeof createDocument>)=>page.evaluate(text=>(window as any).environmentMeasure.accept(text),JSON.stringify(doc)) as Promise<MeasurementSample>;
 const quality=(sample:MeasurementSample,name:string,positive:boolean)=>{for(const q of sample.parkingQuality as any[]){expect(q.untestedStalls).toBe(0);if(positive){expect(q.acceptedStalls).toBeGreaterThan(0);if(name==='R30'){expect(q.acceptedStalls).toBeGreaterThanOrEqual(40);expect(q.aisleRatio).toBeLessThanOrEqual(.6);}}else expect(q.acceptedStalls).toBe(0);}};
 for(const [name,doc] of Object.entries(fixtures)){
  if(scope!=='all'&&scope!==name)continue;
  const samples:MeasurementSample[]=[];for(let i=0;i<20;i++){const {context,page}=await open();try{const s=await accept(page,doc);expect(s.initializationState).toEqual({plannerCacheEntries:0,geometryCacheEntries:0,startupGenerationCount:0});expect(s.generationCalls).toBe(1);expect(s.viewerSyncCalls).toBe(1);quality(s,name,true);samples.push(s);}finally{await context.close();}}
  const threshold=['boundary','dense'].includes(name)?500:200,summary=quantiles(samples);rows.push({name,runKind:'application-cold',operation:'none',thresholdMs:threshold,passed:summary.p95<=threshold,summary,rawSamples:samples});await persist();console.log(name,'cold',summary);expect.soft(summary.p95,`${name} application-cold`).toBeLessThanOrEqual(threshold);
  const {context,page}=await open(),warm:MeasurementSample[]=[];try{await accept(page,doc);for(let i=0;i<60;i++){const s=await page.evaluate(()=>(window as any).environmentMeasure.repeat());if(i>=10){quality(s,name,true);warm.push(s);}}}finally{await context.close();}
  const warmThreshold=['boundary','dense'].includes(name)?250:100,warmSummary=quantiles(warm);rows.push({name,runKind:'warm-repeat',operation:'none',thresholdMs:warmThreshold,passed:warmSummary.p95<=warmThreshold,summary:warmSummary,rawSamples:warm});await persist();console.log(name,'warm',warmSummary);expect.soft(warmSummary.p95,`${name} warm-repeat`).toBeLessThanOrEqual(warmThreshold);
 }
 for(const name of ['R30','boundary'] as const)for(const operation of ['road-add','road-remove','area-remove'] as const){
  if(scope!=='all'&&scope!==name)continue;
  const doc=fixtures[name],samples:MeasurementSample[]=[];for(let i=0;i<20;i++){
   const {context,page}=await open();try{const before=structuredClone(doc);if(operation==='road-add')before.sceneInputs.roads=[];const setup=await accept(page,before);quality(setup,name,operation!=='road-add');
    await page.locator('#edit-mode').selectOption(operation==='area-remove'?'parking':'road');if(operation==='area-remove')await page.locator('#parking-area').selectOption(doc.sceneInputs.parkingAreas[0].id);
    await page.locator('[data-camera="top"]').click();
    const cells=operation==='area-remove'?[[name==='R30'?24:26,0,0],[name==='R30'?29:31,0,name==='R30'?19:27]]:[[0,0,-4],[name==='R30'?29:31,0,-1]];
    const points=await page.evaluate(cells=>cells.map(c=>(window as any).environmentMeasure.point(c)),cells);
    const button=operation==='road-add'?'left':'right';await page.mouse.move(points[0].x,points[0].y);await page.mouse.down({button});await page.mouse.move(points[1].x,points[1].y,{steps:3});await page.mouse.up({button});
    const after=await page.evaluate(()=>(window as any).environmentMeasure.snapshot()),s=after.sample as MeasurementSample;
    expect(after.edit.outcome).toBe('accepted');expect(after.edit.changed).toBe(true);expect(s.operation).toBe(operation);expect(s.inputBeforeSignature).not.toBe(s.inputAfterSignature);expect(s.outputSignature).not.toBe(setup.outputSignature);expect(s.generationCalls).toBe(1);expect(s.viewerSyncCalls).toBe(1);expect(s.historyCommitCalls).toBe(1);
    expect(after.generationCount).toBe(2);expect(after.document.sceneInputs.parkingAreas[0].anchor).toEqual(doc.sceneInputs.parkingAreas[0].anchor);
    if(operation==='area-remove'){expect(after.delta.parkingIds).toEqual([doc.sceneInputs.parkingAreas[0].id]);expect(after.document.sceneInputs.parkingAreas[0].cells.length).toBe(doc.sceneInputs.parkingAreas[0].cells.length-(name==='R30'?120:168));expect(after.document.sceneInputs.roads).toEqual(doc.sceneInputs.roads);quality(s,'edited',true);}
    else {expect(after.delta.roadCells.length).toBe(doc.sceneInputs.roads.length);expect(after.document.sceneInputs.parkingAreas).toEqual(doc.sceneInputs.parkingAreas);quality(s,name,operation==='road-add');if(operation==='road-add')expect(after.document.sceneInputs.roads).toEqual(doc.sceneInputs.roads);else {expect(after.document.sceneInputs.roads).toEqual([]);expect(await page.locator('canvas').getAttribute('data-parking-circulation')).toContain('NO_ROAD_GATE');}}
    const remaining=new Set(after.document.sceneInputs.parkingAreas.flatMap((a:any)=>a.cells.map((c:any)=>c.join(','))));
    for(const area of after.parking??[])for(const plan of area.plans){const base=new Set<string>([...after.document.sceneInputs.roads,...plan.circulation.aisleCells,...plan.circulation.gates.flatMap((g:any)=>[...g.openingCells,...g.connectorCells])].map((c:any)=>c.join(',')));expect(plan.stalls.every((stall:any)=>stall.cells.every((c:any)=>remaining.has(c.join(',')))&&validateStallProof(stall,base)>0)).toBe(true);}
    expect((after.parkingPlacements??[]).filter((p:any)=>p.asset==='parking.paving'&&!remaining.has(`${Math.floor(p.center[0])},0,${Math.floor(p.center[2])}`))).toEqual([]);
    samples.push({...s,setup} as MeasurementSample);
   }finally{await context.close();}
  }
  const threshold=name==='R30'?150:300,summary=quantiles(samples);rows.push({name,runKind:operation==='area-remove'?'first-area-edit':'first-road-edit',operation,thresholdMs:threshold,passed:summary.p95<=threshold,summary,rawSamples:samples});await persist();console.log(name,operation,summary);expect.soft(summary.p95,`${name} ${operation}`).toBeLessThanOrEqual(threshold);
 }
});

});
