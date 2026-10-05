import { expect, test } from '@playwright/test';

test.use({ viewport:{width:1600,height:900},video:{mode:'on',size:{width:1600,height:900}} });
test('wide silo: real stock, hidden transport, full-width mouths and unobstructed 16:9 view',async({page})=>{
  test.setTimeout(100000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?preset=empty&camera=all&quality=high');await page.waitForSelector('body[data-ready="1"]');
  const read=()=>page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,supply=l.view.device.supply;
    return {stock:s.core.rawQueue,transit:s.core.rawTransit.size,onBoard:s.core.items.size,shown:supply.stock.count,moving:supply.moving.count,released:s.core.stats.released,fed:s.core.stats.tokensFed,cons:s.core.conservationError(),seed:s.core.stats.seedPlaced};
  });
  expect((await read()).shown).toBe(0);
  for(let i=0;i<7;i++)await page.click('#stock-add');
  await expect.poll(async()=>(await read()).transit).toBeGreaterThan(0);
  expect((await read()).shown).toBeGreaterThan(0);
  expect((await read()).shown).toBeLessThanOrEqual((await read()).stock);
  await page.screenshot({path:'artifacts/wide-stock.png'});
  // Observe the actual bodies emerging at both outer mouths, rather than inferring supply from hopper decoration.
  await page.evaluate(()=>{
    (window as any).__mouths=new Set<number>();
    const watch=()=>{const l=(window as any).__lab,s=l.runner.sim,p=s.plinkoSnap;for(let i=0;i<p.count;i++)if(p.b[i]<0)(window as any).__mouths.add(Math.round(p.a[i]*10)/10);requestAnimationFrame(watch);};watch();
  });
  await expect.poll(async()=>(await read()).onBoard,{timeout:15000}).toBeGreaterThan(0);
  await page.waitForFunction(()=>{const a=[...(window as any).__mouths] as number[];const width=(window as any).__lab.runner.sim.scenario.board.width;return a.some(u=>u<width*.1)&&a.some(u=>u>width*.9);},null,{timeout:18000});
  await expect.poll(async()=>(await read()).fed,{timeout:35000}).toBeGreaterThan(0);
  await page.screenshot({path:'artifacts/wide-overview.png'});
  await page.click('#lab-toggle');await page.selectOption('#speed','0.25');await page.click('#left [data-cam="plinko"]');await page.click('#lab-toggle');
  await page.waitForTimeout(1000);await page.screenshot({path:'artifacts/wide-distributor.png'});
  const before=await read();await expect.poll(async()=>(await read()).released,{timeout:10000}).toBeGreaterThan(before.released);
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.plinkoMaxActive=0;}));
  const held=(await read()).released;await page.waitForTimeout(1000);expect((await read()).released).toBe(held);
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.plinkoMaxActive=40;}));
  await page.click('#lab-toggle');await page.selectOption('#speed','1');await page.click('#left [data-cam="rear"]');await page.click('#lab-toggle');
  await page.waitForTimeout(800);await page.screenshot({path:'artifacts/wide-rear.png'});
  await page.click('.workbench-tools [data-cam="all"]');await page.waitForTimeout(800);
  const result=await read();expect(result.seed).toBe(0);expect(result.cons).toEqual({produced:0,seed:0,raw:0});expect(errors).toEqual([]);
  console.log('Wide supply',JSON.stringify(result));
  await page.goto('/?preset=basic&camera=all&quality=high');await page.waitForSelector('body[data-ready="1"]');
  for(let i=0;i<7;i++)await page.click('#stock-add');
  await expect.poll(async()=>(await read()).fed,{timeout:35000}).toBeGreaterThan(0);
  await page.waitForFunction(()=>{const s=(window as any).__lab.runner.sim;return s.scrap.bodies.filter((b:any)=>b.y>s.device.scrapCoverY+.1).length>=8;},null,{timeout:15000});
  await page.click('#presentation-pause');
  await page.screenshot({path:'artifacts/wide-final.png'});
  expect(errors).toEqual([]);
});
