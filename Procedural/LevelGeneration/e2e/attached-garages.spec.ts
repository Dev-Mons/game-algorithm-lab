import {openMenu} from './hud';
import {test,expect,type Page} from '@playwright/test';
import {createDocument,exportDocument} from '../src/core/document';
import {box} from '../src/fixtures';

test('parking paint attaches a garage to a house, with source selection, deletion, history and JSON restore',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?measure=1');
  const doc=createDocument(box(2,2,3),42,'residential-cream');
  const load=async(text:string)=>{
    await page.locator('#file').setInputFiles({name:'attached-garage.json',mimeType:'application/json',buffer:Buffer.from(text)});
    await expect(page.locator('#status')).toHaveText('OK');
  };
  await load(exportDocument(doc));
  await page.locator('[data-tool="parking"]').click();
  const selectMask=async()=>{
    await page.locator('[data-camera="top"]').click();
    const point=async(cell:number[])=>page.evaluate(c=>(window as any).environmentMeasure.point(c),cell);
    const a=await point([2,0,1]),b=await point([3,0,2]);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
  };
  await selectMask();await page.keyboard.press('e');
  const canvas=page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-attached-garages',/"bayCount":2/);
  await expect(page.locator('[data-stage="garages"]')).toHaveAttribute('data-state','ready');
  await expect(page.locator('#parking-summary')).toContainText('집에 붙인 차고');
  const garage=JSON.parse((await canvas.getAttribute('data-attached-garages'))!)[0];
  await openMenu(page,'inspect');await page.locator('#source-select').selectOption(JSON.stringify({kind:'parking',id:garage.areaId}));
  await page.locator('#plan-inspector summary').filter({hasText:'분석 · 계획'}).click();
  await expect(page.locator('#plan-inspector')).toContainText('attachedGarages');
  await page.locator('[data-camera="iso"]').click();
  await page.screenshot({path:info.outputPath('painted-attached-garage.png')});
  const assets=await canvas.getAttribute('data-scene-assets');
  await canvas.focus();await page.keyboard.press('Control+z');
  await expect(canvas).toHaveAttribute('data-attached-garages','[]');
  await page.keyboard.press('Control+Shift+z');
  await expect(canvas).toHaveAttribute('data-scene-assets',assets!);
  const saved=await saveDocument(page);
  expect(saved.grid).toEqual(doc.grid);expect(saved.sceneInputs.parkingAreas[0].cells).toHaveLength(4);
  await load(JSON.stringify(saved));
  await expect(canvas).toHaveAttribute('data-scene-assets',assets!);
  await page.locator('[data-tool="parking"]').click();
  await page.locator('#parking-area').selectOption(garage.areaId);
  await selectMask();await page.keyboard.press('q');
  await expect(canvas).toHaveAttribute('data-attached-garages','[]');
  expect((await saveDocument(page)).grid).toEqual(doc.grid);
  expect(errors).toEqual([]);
});

async function saveDocument(page:Page){
  const waiting=page.waitForEvent('download');await page.locator('#save').click();
  const path=await(await waiting).path(),{readFile}=await import('node:fs/promises');
  return JSON.parse(await readFile(path!,'utf8')) as ReturnType<typeof createDocument>;
}
