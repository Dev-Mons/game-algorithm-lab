import {test,expect,type Page} from '@playwright/test';
import {parkingFixture} from '../src/parking-fixtures';
import {loadDocument} from '../src/core/document';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).environmentMeasure.snapshot());
async function load(page:Page,doc:ReturnType<typeof parkingFixture>,name:string){
  await page.locator('#file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#scene-name')).toHaveText(name);await expect(page.locator('#error')).toBeHidden();
}
test('a real one-cell edit preserves usable rows, history and the exact saved mask',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?measure=1');
  await load(page,parkingFixture('R12'),'parking.json');await page.locator('[data-camera="top"]').click();
  await page.locator('#edit-mode').selectOption('parking');await page.locator('#parking-area').selectOption('R12');
  const point=await page.evaluate(()=>(window as any).environmentMeasure.point([5,0,5]));
  await page.mouse.click(point.x,point.y);await page.keyboard.press('q');
  await expect(page.locator('#parking-summary')).toContainText('검증 17대');
  const edited=await snapshot(page);expect(edited.document.sceneInputs.parkingAreas[0].cells).toHaveLength(143);
  expect(edited.document.sceneInputs.parkingAreas[0].anchor).toEqual([0,0,0]);
  await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath('parking-single-hole.png')});
  const pending=page.waitForEvent('download');await page.locator('#save').click();const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];
  for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const saved=loadDocument(Buffer.concat(chunks).toString());
  expect(saved).toEqual(edited.document);
  await page.locator('canvas').focus();await page.keyboard.press('Control+z');await expect(page.locator('#parking-summary')).toContainText('검증 18대');
  await page.keyboard.press('Control+Shift+z');await expect(page.locator('#parking-summary')).toContainText('검증 17대');
  await load(page,saved,'roundtrip.json');expect((await snapshot(page)).parking).toEqual(edited.parking);
  expect(errors).toEqual([]);
});
test('mixed rows, crossings and reserved islands render, and zero capacity has an explicit label',async({page},info)=>{
  await page.goto('/?measure=1');await load(page,parkingFixture('L16'),'L16.json');await page.locator('[data-camera="top"]').click();
  const plan=(await snapshot(page)).parking[0].plans[0];
  expect(new Set(plan.stalls.map((s:any)=>s.heading%2)).size).toBe(2);
  expect(plan.islands.length).toBeGreaterThan(0);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',/parking.island/);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',/parking.crossing/);
  await page.screenshot({path:info.outputPath('parking-mixed-rows.png')});
  const noRoad=parkingFixture('L16');noRoad.sceneInputs.roads=[];await load(page,noRoad,'no-road.json');
  await expect(page.locator('#parking-summary')).toContainText('사용 가능한 구획 없음');
  expect((await snapshot(page)).parking[0].quality.acceptedStalls).toBe(0);
});
