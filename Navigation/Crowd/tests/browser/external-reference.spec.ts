import { test, expect } from '@playwright/test';

test('unscaled 5K request keeps running with the actual spawned population after a UI blast',async({page})=>{
  await page.goto('/?scenario=rocky-pass&agents=5000&paused=true');
  const spawned=await page.evaluate(()=>window.crowdDebug.simulation().state.count);
  expect(spawned).toBeLessThan(5000);
  await page.locator('#external-tool').selectOption('blast');
  const box=(await page.locator('#crowd-canvas').boundingBox())!;
  await page.mouse.click(box.x+box.width*.05,box.y+box.height*.5);
  await page.locator('#single-step').click();
  await expect(page.locator('#external-status')).not.toContainText('입력 처리 중지');
  await page.locator('#run-toggle').click();
  await page.waitForFunction(()=>window.crowdDebug.simulation().stepCount>=15);
  await page.locator('#run-toggle').click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().metrics.activeCount)).toBe(spawned);
});

test('6K rocky UI repeats blasts and resets without Worker or WebAssembly support',async({page},info)=>{
  test.setTimeout(60_000);
  await page.addInitScript(()=>{
    // The reference algorithm must run without either execution backend.
    Object.defineProperty(window,'Worker',{value:class {constructor(){throw new Error('Unexpected Worker');}}});
    Object.defineProperty(window,'WebAssembly',{value:undefined});
  });
  const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('/?scenario=rocky-pass&agents=6000&scale=true&seed=42&paused=true');
  await page.locator('#external-tool').selectOption('blast');
  const box=(await page.locator('#crowd-canvas').boundingBox())!;
  for(let hit=0;hit<3;hit++) {
    await page.mouse.click(box.x+box.width*.05,box.y+box.height*.5);
    await page.locator('#single-step').click();
    expect(await page.evaluate(()=>window.crowdDebug.simulation().external.record().length)).toBe(hit+1);
  }
  await page.locator('#run-toggle').click();
  await page.waitForFunction(()=>window.crowdDebug.simulation().stepCount>=60);
  await page.locator('#run-toggle').click();
  const state=await page.evaluate(()=>{
    const s=window.crowdDebug.simulation();return {count:s.state.count,active:s.metrics.activeCount,
      walls:s.metrics.wallOverlapCount,iterations:s.metrics.constraintIterations};
  });
  expect(state).toEqual({count:6000,active:6000,walls:0,iterations:8});
  await page.screenshot({path:info.outputPath('reference-6k-blast.png'),fullPage:true});
  await page.locator('#reset').click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().external.record())).toEqual([]);
  await page.locator('#single-step').click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().stepCount)).toBe(1);
  expect(errors).toEqual([]);
});

test('a contact failure stays visible through metric refresh and reset clears it',async({page})=>{
  await page.goto('/?agents=100&paused=true');
  await page.evaluate(()=>{
    const sim=window.crowdDebug.simulation();
    sim.step=()=>{sim.external.stats.affected=1;throw new RangeError('contact failure regression');};
  });
  await page.locator('#single-step').click();
  await expect(page.locator('#external-status')).toContainText('contact failure regression');
  // A real RAF updates metrics repeatedly while paused; the error must survive.
  await page.waitForFunction(()=>window.crowdDebug.getFrameTrace().frames.length>=50);
  await expect(page.locator('#external-status')).toContainText('contact failure regression');
  await page.locator('#run-toggle').click();
  await expect(page.locator('#run-toggle')).toContainText('실행');
  await page.locator('#reset').click();
  await page.locator('#single-step').click();
  expect(await page.evaluate(()=>window.crowdDebug.simulation().stepCount)).toBe(1);
  await expect(page.locator('#external-status')).not.toContainText('contact failure regression');
});
