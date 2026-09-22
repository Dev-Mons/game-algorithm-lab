import {test,expect,type Page} from '@playwright/test';
import {createDocument,loadDocument} from '../src/core/document';
import {box} from '../src/fixtures';
import {editObjects} from '../src/scene-editor';

async function downloadDocument(page:Page){
  const pending=page.waitForEvent('download');await page.locator('#save').click();
  const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
  return loadDocument(Buffer.concat(chunks).toString());
}
test('adding a separate building keeps the floor anchored to the same world coordinates',async({page})=>{
  await page.goto('/?measure=1');
  await page.locator('#file').setInputFiles({name:'origin.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(createDocument([[0,0,0]],42,'shop')))});
  await page.locator('[data-camera="top"]').click();
  const canvas=page.locator('canvas');
  const groundWorld=async()=>{
    const ground=JSON.parse((await canvas.getAttribute('data-ground-position'))!),origin=JSON.parse((await canvas.getAttribute('data-display-origin'))!);
    return ground.map((n:number,i:number)=>n-origin[i]);
  };
  const before=await groundWorld();
  const point=await page.evaluate(()=>(window as any).environmentMeasure.point([2,0,0]));
  await page.mouse.click(point.x,point.y);await page.keyboard.press('e');
  await expect(page.locator('#edit-note')).toContainText('추가');
  const saved=await downloadDocument(page);
  expect(saved.grid).toEqual([[0,0,0],[2,0,0]]);
  expect(await groundWorld()).toEqual(before);
  const afterPoint=await page.evaluate(()=>(window as any).environmentMeasure.point([2,0,0]));
  expect(afterPoint.x).toBeCloseTo(point.x,1);expect(afterPoint.y).toBeCloseTo(point.y,1);
});

test('selected building shows only outer edges and role tile UI persists with undo, redo and reset',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  const doc=createDocument(box(4,7,3),42,'shop');
  await page.locator('#file').setInputFiles({name:'tiles.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'building',id:'0,0,0'}));
  await expect(page.locator('canvas')).toHaveAttribute('data-building-outline-segments',String(4*(4+7+3)));
  await page.locator('#facade-tiles summary').click();
  await page.locator('#tile-base').selectOption('D');
  await page.locator('#tile-body').selectOption('B');
  await page.locator('#tile-corner').selectOption('C');
  await expect(page.locator('#error')).toBeHidden();
  const saved=await downloadDocument(page);
  expect(saved.buildings[0].theme?.tileSettings).toEqual({base:'D',body:'B',corner:'C'});
  await page.locator('canvas').focus();await page.keyboard.press('Control+z');
  await expect(page.locator('#tile-corner')).toHaveValue('');
  await page.keyboard.press('Control+Shift+z');await expect(page.locator('#tile-corner')).toHaveValue('C');
  await page.locator('#facade-tiles').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('facade-tile-settings.png')});
  await page.locator('#tile-reset').click();
  for(const role of ['base','body','corner','crown'])await expect(page.locator(`#tile-${role}`)).toHaveValue('');
  await page.locator('#edit-mode').selectOption('object');
  await page.locator('#object-category').selectOption('facility');
  await expect(page.locator('#facility-kind')).toHaveCount(0);
  await expect(page.locator('#object-tools')).toContainText('발코니');
  expect(errors).toEqual([]);
});

test('automatic wall facilities render a full 2x2 area and change type when extended to ground',async({page},info)=>{
  await page.goto('/');
  const base=createDocument(box(5,6,3),42,'shop');
  let doc=editObjects(base,{direction:'PX',cells:[[4,3,0],[4,3,1]]},'facility','add').document;
  for(const [kind,expected] of [['balcony',2],['fire-escape',4],['elevator',8]] as const){
    if(kind==='fire-escape')doc=editObjects(doc,{direction:'PX',cells:[[4,2,0],[4,2,1]]},'facility','add').document;
    if(kind==='elevator')doc=editObjects(doc,{direction:'PX',cells:[[4,0,0],[4,0,1],[4,1,0],[4,1,1]]},'facility','add').document;
    await page.locator('#file').setInputFiles({name:'auto-facility.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#error')).toBeHidden();
    const assets=(await page.locator('canvas').getAttribute('data-scene-assets'))!.split(',');
    expect(assets.filter(a=>a.startsWith(`wall-facility.${kind}.`))).toHaveLength(expected);
    await page.screenshot({path:info.outputPath(`${kind}.png`)});
  }
});
