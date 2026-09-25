import {test,expect,type Page} from '@playwright/test';
import {createDocument,loadDocument,type GenerationDocument} from '../src/core/document';
import {analyzeRoads,isRoadJunction,roadPlacements} from '../src/core/roads';
import {normalizeGrid,type Vec3} from '../src/core/analysis';
import {emptySceneInputs} from '../src/core/scene-inputs';

const rect=(x:number,z:number,w:number,d:number):Vec3[]=>Array.from({length:w*d},(_,i)=>[x+i%w,0,z+Math.floor(i/w)]);
const documentFor=(roads:Vec3[])=>createDocument([],42,'office',undefined,undefined,{...emptySceneInputs(),roads});
async function load(page:Page,doc:GenerationDocument,name:string){
  await page.locator('#file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#scene-name')).toHaveText(name);await expect(page.locator('#error')).toBeHidden();
  await page.locator('[data-camera="top"]').click();await page.locator('#edit-mode').selectOption('road');
}
async function save(page:Page){
  const pending=page.waitForEvent('download');await page.locator('#save').click();
  const stream=await(await pending).createReadStream(),parts:Buffer[]=[];
  for await(const chunk of stream!)parts.push(Buffer.from(chunk));return loadDocument(Buffer.concat(parts).toString());
}
async function select(page:Page,a:Vec3,b:Vec3){
  const points=await page.evaluate(([a,b])=>[a,b].map(c=>(window as any).environmentMeasure.point(c)),[a,b]);
  await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
}

test('T approach removal becomes an L with only connected crosswalks; undo, redo and JSON restore the road',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/?measure=1');
  const doc=documentFor([...rect(-5,0,12,2),...rect(0,0,2,8)]);await load(page,doc,'T-road.json');
  const before=roadPlacements(doc.sceneInputs.roads);expect(before.filter(p=>p.asset.startsWith('stop-'))).toHaveLength(3);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',before.map(p=>p.asset).join(','));
  await page.screenshot({path:info.outputPath('T-road-top.png')});
  await page.locator('[data-camera="iso"]').click();await page.screenshot({path:info.outputPath('T-road-perspective.png')});await page.locator('[data-camera="top"]').click();
  await select(page,[2,0,0],[6,0,1]);await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','10');await page.keyboard.press('q');
  const cut=await save(page),modules=analyzeRoads(cut.sceneInputs.roads),after=roadPlacements(cut.sceneInputs.roads);
  expect(modules.filter(m=>m.shape==='corner')).toHaveLength(1);expect(modules.some(isRoadJunction)).toBe(false);
  expect(after.filter(p=>p.asset.startsWith('stop-'))).toHaveLength(2);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',after.map(p=>p.asset).join(','));
  await page.locator('canvas').focus();await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath('L-road-top.png')});
  await page.locator('[data-camera="iso"]').click();await page.screenshot({path:info.outputPath('L-road-perspective.png')});
  await page.locator('canvas').focus();await page.keyboard.press('Control+z');expect(await save(page)).toEqual(doc);
  await page.locator('canvas').focus();await page.keyboard.press('Control+Shift+z');expect(await save(page)).toEqual(cut);
  await load(page,cut,'L-restored.json');await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',after.map(p=>p.asset).join(','));expect(errors).toEqual([]);
});

test('straight cropping and a one-cell notch keep lane direction and the real exposed boundary',async({page},info)=>{
  await page.goto('/?measure=1');const doc=documentFor(rect(0,0,4,8));await load(page,doc,'straight-before.json');
  await select(page,[0,0,6],[3,0,7]);await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','8');await page.keyboard.press('q');
  const cut=await save(page);expect(cut.sceneInputs.roads).toEqual(normalizeGrid(rect(0,0,4,6)));
  const modules=analyzeRoads(cut.sceneInputs.roads);expect(modules.every(m=>m.width===4&&['end','straight'].includes(m.shape))).toBe(true);
  await expect(page.locator('canvas')).not.toHaveAttribute('data-scene-assets',/road\.(corner|tee|cross)/);
  await page.locator('canvas').focus();await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath('straight-4x6-fixed.png')});
  const notch=documentFor(rect(0,0,2,5).filter(([x,,z])=>x!==1||z!==3));await load(page,notch,'notch.json');
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',roadPlacements(notch.sceneInputs.roads).map(p=>p.asset).join(','));
  await page.screenshot({path:info.outputPath('notch-edge-fixed.png')});
});
