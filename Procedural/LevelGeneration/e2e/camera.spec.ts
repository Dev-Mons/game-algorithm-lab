import {test,expect,type Page} from '@playwright/test';
import {Quaternion,Vector3} from 'three';
import {createDocument} from '../src/core/document';

interface Pose {position:number[];target:number[];quaternion:[number,number,number,number]}
async function pose(page:Page):Promise<Pose> {
  return JSON.parse((await page.locator('canvas').getAttribute('data-camera-pose'))!);
}
const delta=(from:number[],to:number[])=>new Vector3().fromArray(to).sub(new Vector3().fromArray(from));
async function settle(page:Page) {
  let previous:Pose|undefined;
  await expect.poll(async()=>{
    const current=await pose(page),change=previous?delta(previous.position,current.position).length():1;
    previous=current;return change;
  },{intervals:[100],timeout:10000}).toBeLessThan(.00001);
}
async function setup(page:Page,preset:'iso'|'top') {
  await page.goto('/');
  await page.locator('#file').setInputFiles({name:'camera.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(createDocument([[0,0,0]],42,'office')))});
  await page.locator(`[data-camera="${preset}"]`).click();
  await page.locator('canvas').focus();
  await settle(page);
}

test('right drag rotates and WASD follows the rotated camera without editing the document',async({page})=>{
  await setup(page,'iso');
  const canvas=page.locator('canvas'),box=(await canvas.boundingBox())!;
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.click(x,y);
  const selection=await canvas.getAttribute('data-selection-cells');
  const timings=await page.locator('#timings').textContent();
  const before=await pose(page);
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});
  await page.mouse.move(x+110,y+35,{steps:10});await page.mouse.up({button:'right'});
  await settle(page);
  const rotated=await pose(page);
  expect(delta(before.position,rotated.position).length()).toBeGreaterThan(.5);
  expect(delta(before.target,rotated.target).length()).toBeLessThan(.00001);
  for(const [key,axis] of [['w',[0,0,-1]],['s',[0,0,1]],['a',[-1,0,0]],['d',[1,0,0]]] as const){
    const start=await pose(page),direction=new Vector3(...axis).applyQuaternion(new Quaternion(...start.quaternion));
    await page.keyboard.down(key);
    await expect.poll(async()=>delta(start.position,(await pose(page)).position).length()).toBeGreaterThan(.3);
    await page.keyboard.up(key);
    const end=await pose(page),travel=delta(start.position,end.position);
    expect(travel.clone().normalize().dot(direction)).toBeGreaterThan(.999);
    expect(travel.distanceTo(delta(start.target,end.target))).toBeLessThan(.00001);
    await page.waitForTimeout(100);
    expect(delta(end.position,(await pose(page)).position).length()).toBeLessThan(.00001);
  }
  await expect(canvas).toHaveAttribute('data-selection-cells',selection!);
  await expect(page.locator('#stats strong').first()).toHaveText('1');
  await expect(page.locator('#timings')).toHaveText(timings!);
});

test('top-view forward travel follows pitch and focus loss stops held navigation keys',async({page})=>{
  await setup(page,'top');
  const canvas=page.locator('canvas'),start=await pose(page);
  await page.keyboard.down('w');
  await expect.poll(async()=>delta(start.position,(await pose(page)).position).y).toBeLessThan(-.3);
  await page.locator('#seed').focus();
  const stopped=await pose(page);
  await page.waitForTimeout(150);
  expect(delta(stopped.position,(await pose(page)).position).length()).toBeLessThan(.00001);
  await page.keyboard.up('w');
  await page.keyboard.press('a');await page.keyboard.press('d');
  await page.waitForTimeout(100);
  expect(delta(stopped.position,(await pose(page)).position).length()).toBeLessThan(.00001);
  await canvas.focus();await page.keyboard.down('d');
  await expect.poll(async()=>delta(stopped.position,(await pose(page)).position).length()).toBeGreaterThan(.3);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  const blurred=await pose(page);
  await page.waitForTimeout(150);
  expect(delta(blurred.position,(await pose(page)).position).length()).toBeLessThan(.00001);
  await page.keyboard.up('d');
  await expect(page.locator('#stats strong').first()).toHaveText('1');
});
