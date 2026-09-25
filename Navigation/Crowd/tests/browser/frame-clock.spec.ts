import { test, expect } from '@playwright/test';

test('records the real app loop and keeps paused commands on fixed ticks',async({page})=>{
  await page.goto('/?agents=1000&seed=42&paused=true');
  await page.locator('#external-tool').selectOption('wind');
  const bounds=(await page.locator('#crowd-canvas').boundingBox())!;
  await page.locator('#crowd-canvas').dispatchEvent('click',{clientX:bounds.x+bounds.width*.2,clientY:bounds.y+bounds.height*.5});
  await page.locator('#run-toggle').click();
  await page.waitForFunction(()=>window.crowdDebug.simulation().stepCount>=120);
  await page.locator('#run-toggle').click();
  await expect(page.locator('#status-label')).toHaveText('일시정지');
  const result=await page.evaluate(()=>({trace:window.crowdDebug.getFrameTrace(),inputs:window.crowdDebug.simulation().external.record()}));
  const column=(name:string)=>result.trace.columns.indexOf(name as typeof result.trace.columns[number]);
  const frames=result.trace.frames.filter(f=>f[column('tickAfter')]!>f[column('tickBefore')]!);
  expect(frames.length).toBeGreaterThan(20);
  expect(frames.every(f=>f.every(Number.isFinite))).toBe(true);
  for(const frame of frames) {
    expect(frame[column('steps')]).toBe(frame[column('tickAfter')]!-frame[column('tickBefore')]!);
    expect(frame[column('steps')]).toBeLessThanOrEqual(4);
    expect(frame[column('active')]).toBe(1000);
    expect(frame[column('debtSeconds')]).toBeLessThanOrEqual(.25);
  }
  expect(result.inputs).toMatchObject([{kind:'acceleration',tick:0,endTick:60,ax:500,ay:0}]);
  await expect(page.locator('#lab-live')).toContainText('시간 손실');
  await expect(page.locator('#lab-passes')).toContainText('Navigation/LOS');
  await page.locator('#reset').click();
  expect(await page.evaluate(()=>window.crowdDebug.getFrameTrace().frames.every(f=>f[1]===0&&f[2]===0))).toBe(true);
});
