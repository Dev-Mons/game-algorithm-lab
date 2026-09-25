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


test('parallel pair construction preserves a skewed complete query and reports global overflow',async({page})=>{
  const source=await page.request.get('/src/core/contact-kernel.ts');
  test.skip(!source.headers()['content-type']?.includes('javascript'),'Isolated kernel contract requires the Vite development module endpoint.');
  await page.goto('/?agents=1&paused=true');
  test.skip(await page.evaluate(()=>navigator.hardwareConcurrency)<4,'This host uses scalar contact.');
  const result=await page.evaluate(async()=>{
    // Import the development modules for an isolated broad-phase contract test.
    const {ContactKernel}=await import('/src/core/contact-kernel.ts');
    const {SpatialHash}=await import('/src/algorithms/spatial-hash/spatial-hash.ts');
    const actual=ContactKernel.create(()=>0,()=>{},true)!,expected=ContactKernel.create(()=>0,()=>{},false)!;
    const count=5000,grid=new SpatialHash(100,100,12,count);
    try {
      const started=performance.now();
      while(!actual.workerThreads){if(performance.now()-started>5000)throw new Error('Workers unavailable');await new Promise(r=>setTimeout(r,10));}
      const rows=[];
      for(const capacity of [32,4096]) {
        for(const kernel of [actual,expected]) {
          kernel.ensure(count,capacity,grid.cellStart.length);
          const a=kernel.arrays;a.x.fill(50);a.y.fill(50);a.radii.fill(2);a.active.fill(0);a.active.fill(1,0,70);
          grid.rebuild(a.x,a.y,a.active);a.cellStart.set(grid.cellStart);a.cellIndices.set(grid.agentIndices);
        }
        actual.beginFrame();
        let a:number;
        try {a=actual.buildPairs(count,capacity,grid.columns,grid.rows,12,2,.4,1);}
        finally {actual.endFrame();}
        const b=expected.buildPairs(count,capacity,grid.columns,grid.rows,12,2,.4,1);
        if(a!==b)throw new Error('Capacity outcome differs');
        if(a>=0) {
          for(let i=0;i<a;i++)if(actual.arrays.a[i]!==expected.arrays.a[i]||actual.arrays.b[i]!==expected.arrays.b[i])throw new Error('Pair order differs');
          for(const key of ['pairCandidates','pairFallbacks','pairCells','pairMaximum','pairOwnershipSkips'] as const)if(actual[key]!==expected[key])throw new Error(`Counter differs: ${key}`);
        }
        rows.push({count:a,parallel:actual.lastParallel});
      }
      return rows;
    }finally{actual.dispose();expected.dispose();}
  });
  expect(result).toEqual([{count:-1,parallel:true},{count:2415,parallel:true}]);
});
