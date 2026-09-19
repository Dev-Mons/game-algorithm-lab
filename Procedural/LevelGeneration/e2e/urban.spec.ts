import {test,expect} from '@playwright/test';
import {createDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {box} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';
import {URBAN_FIXTURES} from '../src/urban-fixtures';
import {emptySceneInputs} from '../src/core/scene-inputs';
import type {Vec3} from '../src/core/analysis';
test.beforeEach(async({page})=>{await page.goto('/');await page.locator('.layers summary').click();await page.locator('#layer-edges').uncheck();await page.locator('#environment-inputs').uncheck();await page.locator('#environment-plans').uncheck();await page.locator('.layers summary').click();});

test('priority 1 urban programs render real complete faces for both styles',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const style of ['urban-shop','urban-office'] as const){
    const doc=createDocument(box(10,12,5),17,style);
    await page.locator('#file').setInputFiles({name:'urban.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
    await page.screenshot({path:info.outputPath(`${style}.png`)});
  }
  expect(errors).toEqual([]);
});
test('priority 2 multi tower and annex local upper floors render with exact face ownership',async({page},info)=>{
  for(const name of ['towers','annex','setback'] as const){
    const doc=createDocument(URBAN_FIXTURES[name],17,'urban-shop');
    await page.locator('#file').setInputFiles({name:`${name}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
    await page.screenshot({path:info.outputPath(`${name}.png`)});
  }
});
test('priority 3 multi floor frames render and a local deletion keeps a complete facade',async({page},info)=>{
  const doc=createDocument(box(12,10,5),17,'urban-office');
  for(const [name,grid] of [['frame',doc.grid],['frame-cut',doc.grid.filter(c=>c.join(',')!=='4,5,4')]] as const){
    const d=createDocument(grid,17,'urban-office',undefined,doc.buildings);
    await page.locator('#file').setInputFiles({name:`${name}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});
    await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(d));
    await page.screenshot({path:info.outputPath(`${name}.png`)});
  }
});
test('priority 4 typed facilities and column display render, and building intent controls survive undo',async({page},info)=>{
  const scene=emptySceneInputs();scene.objects=[
    {id:'balconies',category:'facility',facilityKind:'balcony',direction:'PZ',cells:box(4,3,1).map(([x,y])=>[x+1,y+2,4])},
    {id:'stairs',category:'facility',facilityKind:'fire-escape',direction:'PZ',cells:box(1,6,1).map(([,y])=>[6,y+1,4]),facadeRequest:'solid'},
    {id:'elevator',category:'facility',facilityKind:'elevator',direction:'PZ',cells:box(1,7,1).map(([,y])=>[8,y+1,4]),facadeRequest:'solid'},
  ];
  const doc=createDocument(box(10,10,4),17,'urban-shop',undefined,undefined,scene),result=generateDocument(doc);
  await page.locator('#file').setInputFiles({name:'facilities.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,result);
  for(const kind of ['balcony','fire-escape','elevator'])await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',new RegExp(`wall-facility.${kind}`));
  await page.screenshot({path:info.outputPath('wall-facilities.png')});
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'building',id:'0,0,0'}));
  await page.locator('#design-family').selectOption('bay-4');await expect(page.locator('#status')).toHaveText('OK');await expect(page.locator('canvas')).toHaveAttribute('data-vertical-bands',/bay-4/);
  await page.locator('canvas').click({position:{x:10,y:10}});await page.keyboard.press('Control+z');await expect(page.locator('#status')).toHaveText('OK');
  const cells=[...box(7,1,5),...box(7,1,5).map(([x,,z])=>[x,5,z] as Vec3),...[1,2,3,4].flatMap(y=>[[1,y,1],[5,y,1],[1,y,3],[5,y,3]] as Vec3[])];
  const columns=createDocument(cells,17,'urban-office'),r=generateDocument(columns);
  expect(r.environment!.columns![0].faces.length).toBeGreaterThan(0);
  await page.locator('#file').setInputFiles({name:'columns.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(columns))});
  await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,r);await page.screenshot({path:info.outputPath('columns.png')});
});

test('full-width rooftop columns cover their supporting blocks',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const cells=[...box(8,3,6),...[3,4,5].flatMap(y=>[[1,y,4],[5,y,4]] as Vec3[])];
  const doc=createDocument(cells,17,'urban-shop'),result=generateDocument(doc);
  expect(result.environment!.columns![0].runs.filter(r=>r.accepted)).toHaveLength(2);
  for(const x of [1,5])expect(result.surfaces.some(s=>s.faceId===`${x},2,4|PY`)).toBe(false);
  await page.locator('#file').setInputFiles({name:'solid-columns.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,result);
  await page.locator('[data-camera="iso"]').click();
  await page.locator('canvas').screenshot({path:info.outputPath('solid-columns.png')});
  expect(errors).toEqual([]);
});
