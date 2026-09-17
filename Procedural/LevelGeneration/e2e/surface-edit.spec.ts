import { test, expect, type Page } from "@playwright/test";
import { createDocument } from "../src/core/document";

async function load(page: Page, grid: number[][]) {
  await page.locator("#file").setInputFiles({name:"surface.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(createDocument(grid,42,"office")))});
  await page.locator('[data-camera="top"]').click();
}
async function center(page: Page) {
  const b=(await page.locator("canvas").boundingBox())!;
  return {x:b.x+b.width/2,y:b.y+b.height/2,height:b.height};
}
async function drag(page: Page, button: "left"|"right", extent=8) {
  const c=await center(page);
  await page.mouse.move(c.x-extent,c.y-extent);
  await page.mouse.down({button});
  await page.mouse.move(c.x+extent,c.y+extent,{steps:8});
  await page.mouse.up({button});
}
async function handlePosition(page: Page) {
  const canvas=page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-edit-handle',/pixelsPerCell/);
  const b=(await canvas.boundingBox())!;
  const h=JSON.parse((await canvas.getAttribute('data-edit-handle'))!) as {x:number;y:number;axisX:number;axisY:number;pixelsPerCell:number};
  return {...h,x:b.x+h.x,y:b.y+h.y};
}
async function dragHandle(page: Page, layers:number) {
  const h=await handlePosition(page);
  await page.mouse.move(h.x,h.y);
  await page.mouse.down();
  await page.mouse.move(h.x+h.axisX*h.pixelsPerCell*layers,h.y+h.axisY*h.pixelsPerCell*layers,{steps:8});
  await page.mouse.up();
}
const count=(page:Page)=>page.locator("#stats strong").first();

test("drag only selects; E/Q edit while right mouse and form typing never edit",async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await load(page,[[0,0,0]]);
  const c=await center(page);
  await drag(page,'right');
  await expect(count(page)).toHaveText('1');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
  await page.locator('[data-camera="top"]').click();
  await drag(page,'left');
  await expect(count(page)).toHaveText('1');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','1');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-direction','PY');
  const h=await handlePosition(page);
  expect(h.x).toBeCloseTo(c.x,0);
  expect(h.y).toBeCloseTo(c.y,0);
  await page.mouse.click(c.x,c.y,{button:'right'});
  await expect(count(page)).toHaveText('1');
  await page.keyboard.press('e');
  await expect(count(page)).toHaveText('2');
  for(let i=0;i<3;i++){
    await page.keyboard.press('q');await expect(count(page)).toHaveText('1');
    await page.keyboard.press('e');await expect(count(page)).toHaveText('2');
  }
  await page.locator('#seed').focus();await page.keyboard.press('q');
  await expect(count(page)).toHaveText('2');
  await page.locator('canvas').focus();await page.keyboard.press('Alt+q');
  await expect(count(page)).toHaveText('2');
  await page.screenshot({path:info.outputPath('surface-selection.png')});
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
  await expect(page.locator('canvas')).not.toHaveAttribute('data-edit-handle');
  await page.keyboard.press('e');await page.keyboard.press('q');
  await expect(count(page)).toHaveText('2');
  await page.keyboard.press('Control+z');await expect(count(page)).toHaveText('1');
  await page.keyboard.press('Control+Shift+z');await expect(count(page)).toHaveText('2');
  expect(errors).toEqual([]);
});

test("Q removes the last layer and E restores the retained empty plane",async({page})=>{
  await page.goto('/');await load(page,[[0,0,0]]);
  await drag(page,'left');await page.keyboard.press('q');
  await expect(count(page)).toHaveText('0');
  await page.keyboard.press('q');await expect(count(page)).toHaveText('0');
  await page.keyboard.press('e');await expect(count(page)).toHaveText('1');
  await page.keyboard.press('q');await page.keyboard.press('Escape');
  await drag(page,'left');await expect(count(page)).toHaveText('0');
  await page.keyboard.press('e');await expect(count(page)).toHaveText('1');
  await page.locator('#fixture').selectOption('single');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
});

test("multi-cell selection persists through edits; camera and cancelled selections never commit",async({page},info)=>{
  await page.goto('/');await load(page,Array.from({length:9},(_,i)=>[i%3,0,Math.floor(i/3)]));
  const c=await center(page);
  await drag(page,'left',c.height*.15);
  await expect(count(page)).toHaveText('9');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','9');
  await page.keyboard.press('e');await expect(count(page)).toHaveText('18');
  await page.keyboard.press('q');await expect(count(page)).toHaveText('9');
  await page.keyboard.press('e');
  await page.mouse.move(c.x,c.y);await page.mouse.down({button:'right'});
  await page.mouse.move(c.x+100,c.y+70,{steps:12});await page.mouse.up({button:'right'});
  await page.mouse.wheel(0,100);await expect(count(page)).toHaveText('18');
  await page.screenshot({path:info.outputPath('area-on-roof.png')});
  await page.keyboard.press('Escape');await page.locator('[data-camera="top"]').click();
  await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(c.x+30,c.y+30);
  await page.keyboard.press('e');await expect(count(page)).toHaveText('18');
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
  await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(10,10);await page.mouse.up();
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
  await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(c.x+20,c.y+20);
  await page.locator('canvas').dispatchEvent('pointercancel');await page.mouse.up();
  await expect(count(page)).toHaveText('18');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','0');
});

test("pyramid raises empty ground live, reverses to remove, and release adds no extra layer",async({page},info)=>{
  await page.goto('/');await load(page,[]);
  await drag(page,'left');await expect(count(page)).toHaveText('0');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','4');
  const h=await handlePosition(page);expect(h.axisY).toBe(-1);
  await page.mouse.move(h.x,h.y);await page.mouse.down();
  await page.mouse.move(h.x,h.y-h.pixelsPerCell*.4);await expect(count(page)).toHaveText('0');
  await page.mouse.move(h.x,h.y-h.pixelsPerCell*2.2,{steps:8});await expect(count(page)).toHaveText('8');
  await page.mouse.move(h.x,h.y-h.pixelsPerCell*.8,{steps:6});await expect(count(page)).toHaveText('4');
  await page.mouse.up();await expect(count(page)).toHaveText('4');
  await dragHandle(page,-1.2);await expect(count(page)).toHaveText('0');
  await dragHandle(page,1.2);await expect(count(page)).toHaveText('4');
  await page.locator('[data-camera="iso"]').click();
  await page.screenshot({path:info.outputPath('pyramid-ground.png')});
});

test("pyramid extrudes a whole roof along its normal in an oblique view",async({page},info)=>{
  await page.goto('/');await load(page,Array.from({length:9},(_,i)=>[i%3,0,Math.floor(i/3)]));
  const c=await center(page);await drag(page,'left',c.height*.15);
  await page.locator('[data-camera="iso"]').click();
  await dragHandle(page,1.2);await expect(count(page)).toHaveText('18');
  await dragHandle(page,-1.2);await expect(count(page)).toHaveText('9');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','9');
  await page.screenshot({path:info.outputPath('pyramid-roof.png')});
});

test("side-face pyramid and keys follow the normal on a narrow viewport",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');await load(page,[[0,0,0]]);
  await page.locator('[data-camera="iso"]').click();
  const c=await center(page);
  await page.mouse.move(c.x+10,c.y+10);await page.mouse.down();
  await page.mouse.move(c.x+18,c.y+18,{steps:5});await page.mouse.up();
  await expect(count(page)).toHaveText('1');
  await expect(page.locator('canvas')).toHaveAttribute('data-selection-direction',/P[ZX]/);
  await dragHandle(page,1.2);await expect(count(page)).toHaveText('2');
  await page.keyboard.press('q');await expect(count(page)).toHaveText('1');
  await page.keyboard.press('e');await expect(count(page)).toHaveText('2');
  const beforeZoom=await handlePosition(page);
  await page.mouse.move(beforeZoom.x,beforeZoom.y);
  await page.mouse.wheel(0,1800);
  await expect.poll(async()=>Math.abs((await handlePosition(page)).axisX)).toBeGreaterThan(.2);
  await dragHandle(page,1.2);await expect(count(page)).toHaveText('3');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
