import { test, expect } from '@playwright/test';

test('external tools work while paused, preserve goals and export replay inputs', async ({page},info) => {
  await page.goto('/?agents=1000&paused=true');
  const before=await page.evaluate(()=>({...window.crowdDebug.simulation().goal}));
  await page.locator('#external-tool').selectOption('blast');
  const box=(await page.locator('#crowd-canvas').boundingBox())!;
  await page.mouse.click(box.x+box.width*.2,box.y+box.height*.5);
  expect(await page.evaluate(()=>window.crowdDebug.simulation().stepCount)).toBe(0);
  await page.getByRole('button',{name:'한 스텝'}).click();
  const result=await page.evaluate(()=> {
    const s=window.crowdDebug.simulation();return {goal:s.goal,affected:s.external.stats.affected,events:s.external.record(),walls:s.metrics.wallOverlapCount};
  });
  expect(result.goal).toEqual(before);expect(result.affected).toBeGreaterThan(0);expect(result.events).toHaveLength(1);expect(result.walls).toBe(0);
  await expect(page.locator('#external-status')).toContainText('직접 영향');
  await page.locator('#crowd-canvas').screenshot({path:info.outputPath('blast.png')});
  await page.locator('#external-tool').selectOption('vehicle');
  await page.mouse.click(box.x+box.width*.15,box.y+box.height*.5);
  await page.getByRole('button',{name:'한 스텝'}).click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().external.proxies.length)).toBe(1);
  await page.locator('#crowd-canvas').screenshot({path:info.outputPath('vehicle.png')});
  await page.locator('#save-result').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('crowd-lab-results-v1')!));
  expect(saved[0].commands.some((c:{type:string})=>c.type==='external')).toBe(true);
  await page.screenshot({path:info.outputPath('external-controls.png'),fullPage:true});
  await page.getByRole('button',{name:'초기화'}).click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().external.record().length)).toBe(0);
});

test('external input overflow pauses visibly and reset recovers the UI',async({page})=>{
  await page.goto('/?agents=100&paused=true');await page.locator('#external-tool').selectOption('blast');
  const box=(await page.locator('#crowd-canvas').boundingBox())!;
  for(let i=0;i<33;i++)await page.locator('#crowd-canvas').dispatchEvent('click',{clientX:box.x+100,clientY:box.y+100});
  await page.locator('#single-step').click();await expect(page.locator('#external-status')).toContainText('입력 처리 중지');
  await page.locator('#reset').click();await page.locator('#single-step').click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().stepCount)).toBe(1);
});
