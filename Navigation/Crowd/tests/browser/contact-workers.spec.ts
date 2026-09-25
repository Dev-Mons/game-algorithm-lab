import {test,expect,type Worker} from '@playwright/test';

test('reset retires every contact worker and a new session resumes parallel computation',async({page})=>{
  const live=new Set<Worker>();
  page.on('worker',worker=>{live.add(worker);worker.once('close',()=>live.delete(worker));});
  await page.goto('/?agents=10000&scenario=rocky-pass&scale=true&paused=true');
  expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
  const hardware=await page.evaluate(()=>navigator.hardwareConcurrency);
  test.skip(hardware<4,'This host uses the synchronous native fallback.');
  const expectedWorkers=Math.min(4,Math.floor(hardware/2))-1;
  for(let cycle=0;cycle<3;cycle++) {
    await page.locator('#run-toggle').click();
    await page.waitForFunction(()=>window.crowdDebug.simulation().stepCount>=6);
    await page.evaluate(()=>{
      const sim=window.crowdDebug.simulation(),spawn=sim.scenario.spawn;
      const canvas=document.querySelector<HTMLCanvasElement>('#crowd-canvas')!,box=canvas.getBoundingClientRect();
      document.querySelector<HTMLSelectElement>('#external-tool')!.value='wind';
      canvas.dispatchEvent(new MouseEvent('click',{clientX:box.left+(spawn.x+spawn.width*.5)/sim.config.width*box.width,
        clientY:box.top+(spawn.y+spawn.height*.5)/sim.config.height*box.height,bubbles:true}));
    });
    await page.waitForFunction(()=>window.crowdDebug.simulation().external.stats.parallelPasses>0);
    await page.locator('#run-toggle').click();
    await expect.poll(()=>live.size).toBe(expectedWorkers);
    expect(await page.evaluate(()=>window.crowdDebug.simulation().external.stats.workerFailures)).toBe(0);
    await page.locator('#reset').click();
    await expect.poll(()=>live.size).toBe(0);
    expect(await page.evaluate(()=>window.crowdDebug.simulation().external.record())).toEqual([]);
    expect(await page.evaluate(()=>window.crowdDebug.simulation().stepCount)).toBe(0);
  }
});
