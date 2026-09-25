import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createDocument,loadDocument,replaceGrid,type GenerationDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

async function load(page:Page,doc:GenerationDocument,name='relations.json'){
  await page.locator('#file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#scene-name')).toHaveText(name);await expect(page.locator('#error')).toBeHidden();
}
async function save(page:Page){
  const pending=page.waitForEvent('download');await page.locator('#save').click();
  const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));return loadDocument(Buffer.concat(chunks).toString());
}
async function inspect(page:Page,id:string){
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'object',id}));
  await page.locator('#plan-inspector summary').filter({hasText:'지지 · 경계 · 도로 관계'}).click();
}
const executionCounts=(page:Page)=>page.evaluate(()=>{
  const {generationCount,viewerSyncCount,historyCommitCount}=(window as any).environmentMeasure.snapshot();
  return {generationCount,viewerSyncCount,historyCommitCount};
});

test('relation Inspector and real object deletion keep absolute slots through history and JSON',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?measure=1');
  const scene=emptySceneInputs();scene.objects=[{id:'roof-lights',category:'lighting',direction:'PY',cells:[[1,1,1],[1,1,2],[2,1,1],[2,1,2]]}];
  const doc=createDocument(box(4,1,4),42,'office',undefined,undefined,scene);await load(page,doc);
  await inspect(page,'roof-lights');await expect(page.locator('#plan-inspector')).toContainText('EXPOSED_SURFACE_SUPPORT');
  await expect(page.locator('#plan-inspector')).toContainText('supportOwner');
  await page.screenshot({path:info.outputPath('roof-support-inspector.png')});
  await page.locator('[data-camera="top"]').click();await page.locator('#edit-mode').selectOption('object');await page.locator('#object-category').selectOption('lighting');
  const point=await page.evaluate(()=>(window as any).environmentMeasure.point([1,1,1]));await page.mouse.click(point.x,point.y);await page.keyboard.press('q');
  await expect(page.locator('#edit-note')).toContainText('제거 완료');
  const cut=await save(page);expect(cut.sceneInputs.objects.flatMap(o=>o.cells)).toHaveLength(3);
  const result=generateDocument(cut),before=generateDocument(doc);
  const bodies=(r:typeof result)=>r.environment!.fixtures!.placements.map(p=>({asset:p.asset,center:p.center,heading:p.yawQuarterTurns}));
  expect(bodies(result)).toEqual(bodies(before).filter(p=>Math.floor(p.center[0])!==1||Math.floor(p.center[2])!==1));
  await expectCompleteFaces(page,result);
  await page.locator('canvas').focus();await page.keyboard.press('Control+z');expect(await save(page)).toEqual(doc);
  await page.locator('canvas').focus();await page.keyboard.press('Control+Shift+z');expect(await save(page)).toEqual(cut);
  await load(page,cut,'restored.json');const accepted=await page.locator('canvas').getAttribute('data-scene-assets');
  const counts=await executionCounts(page);
  await page.locator('#file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});
  await expect(page.locator('#error')).toBeVisible();await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',accepted!);expect(await save(page)).toEqual(cut);
  await load(page,cut,'verified.json');await expect(page.locator('#status')).toHaveText('OK');
  expect(await executionCounts(page)).toEqual(counts);
  await page.locator('[data-camera="iso"]').click();await page.screenshot({path:info.outputPath('roof-light-corner-deleted.png')});
  expect(errors).toEqual([]);
});

test('covered terrace and lost support explain retained intent with the actual scene visible',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  const grid=[...box(6,1,5),...box(2,6,5).map(([x,y,z])=>[x,y+1,z]),...box(4,1,2).map(([x,,z])=>[x+2,4,z+3])];
  const scene=emptySceneInputs();scene.objects=[{id:'covered-utility',category:'facility',direction:'PY',cells:[[4,1,4]]},{id:'sky-plant',category:'vegetation',direction:'PY',cells:[[4,1,1]]}];
  const doc=createDocument(grid,42,'urban-shop',undefined,undefined,scene);await load(page,doc);await inspect(page,'covered-utility');
  await expect(page.locator('#plan-inspector')).toContainText('covered-terrace');await expect(page.locator('#plan-inspector')).toContainText('coveredBy');
  await expectCompleteFaces(page,generateDocument(doc));await page.screenshot({path:info.outputPath('covered-terrace-relations.png')});
  const lost=replaceGrid(doc,doc.grid.filter(c=>c.join(',')!=='4,0,1'));await load(page,lost,'support-lost.json');await inspect(page,'sky-plant');
  await expect(page.locator('#plan-inspector')).toContainText('NO_SUPPORTED_SURFACE');expect((await save(page)).sceneInputs.objects).toEqual(doc.sceneInputs.objects);
  await page.screenshot({path:info.outputPath('retained-unsupported-plant.png')});expect(errors).toEqual([]);
});

test('span32 real volume edits record complete regeneration cost and preserve face ownership',async({page},info)=>{
  test.setTimeout(120_000);await page.goto('/?measure=1');
  const doc=createDocument(box(32,6,8).filter(([x,,z])=>x<8||z<4),42,'urban-shop');await load(page,doc,'span32.json');
  await page.locator('[data-camera="top"]').click();
  const point=await page.evaluate(()=>(window as any).environmentMeasure.point([3,5,3]));await page.mouse.click(point.x,point.y);
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','1');
  await page.keyboard.press('e');await expect(page.locator('#error')).toBeHidden();
  await page.waitForFunction(()=>(window as any).environmentMeasure.buildingEdits().at(-1)?.inputToRenderMs!==undefined);
  await page.keyboard.press('q');await page.waitForFunction(()=>(window as any).environmentMeasure.buildingEdits().length===2&&(window as any).environmentMeasure.buildingEdits().at(-1)?.inputToRenderMs!==undefined);
  expect(await save(page)).toEqual(doc);await expectCompleteFaces(page,generateDocument(doc));
  const samples=await page.evaluate(()=>(window as any).environmentMeasure.buildingEdits());
  await writeFile(info.outputPath('span32-edit-cost.json'),JSON.stringify({browser:page.context().browser()!.version(),scope:'native E/Q through CPU render submission; 1 add + 1 remove; no performance threshold or tail estimate',samples},null,2));
  await page.locator('[data-camera="iso"]').click();await page.screenshot({path:info.outputPath('span32-restored.png')});
});
