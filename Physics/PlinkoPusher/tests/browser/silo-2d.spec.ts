import { expect, test } from '@playwright/test';

test.use({viewport:{width:1600,height:900},video:{mode:'on',size:{width:1600,height:900}}});
test('single-layer silo falls, holds, drains from the bottom and feeds the wider board',async({page})=>{
  test.setTimeout(70000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?preset=empty&camera=all&quality=high');await page.waitForSelector('body[data-ready="1"]');
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.plinkoMaxActive=0;}));
  for(let i=0;i<3;i++)await page.click('#stock-add');
  const read=()=>page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,stock=l.view.device.supply.stock;
    return {bodies:s.silo.bodies.map((b:any)=>({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy})),pending:s.silo.pending,raw:s.core.rawQueue,released:s.core.stats.released,completed:s.core.stats.completed,scale:s.frame.scale,cons:s.core.conservationError(),z:s.device.silo.z,depths:Array.from({length:stock.count},(_,i)=>stock.instanceMatrix.array[i*16+14])};
  });
  await expect.poll(async()=>(await read()).bodies.length).toBeGreaterThan(0);
  const first=(await read()).bodies[0];await page.waitForTimeout(900);
  expect((await read()).bodies.find((b:any)=>b.id===first.id)!.y).toBeLessThan(first.y-.2);
  await page.screenshot({path:'artifacts/silo-2d-falling.png'});
  await expect.poll(async()=>(await read()).bodies.length,{timeout:15000}).toBeGreaterThan(150);
  await page.waitForTimeout(5000);
  const held=await read();expect(held.raw).toBe(300);expect(held.released).toBe(0);expect(held.scale).toBeCloseTo(.8,8);
  expect(held.bodies.length+held.pending).toBe(held.raw);
  for(const z of held.depths)expect(z).toBeCloseTo(held.z,5);
  await page.screenshot({path:'artifacts/silo-2d-held.png'});
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.plinkoMaxActive=40;}));
  await expect.poll(async()=>(await read()).released,{timeout:5000}).toBeGreaterThan(2);
  await page.waitForTimeout(1500);
  const moved=await read(),ys=new Map(held.bodies.map((b:any)=>[b.id,b.y]));
  expect(moved.bodies.some((b:any)=>ys.has(b.id)&&b.y<(ys.get(b.id) as number)-.04)).toBe(true);
  expect(moved.raw).toBeLessThan(300);expect(moved.cons).toEqual({produced:0,seed:0,raw:0});
  await page.click('#lab-toggle');await page.click('#left [data-cam="side"]');await page.click('#lab-toggle');
  await page.waitForTimeout(800);await page.screenshot({path:'artifacts/silo-2d-side.png'});
  await expect.poll(async()=>(await read()).completed,{timeout:20000}).toBeGreaterThan(0);
  await page.click('.workbench-tools [data-cam="all"]');await page.waitForTimeout(800);
  await page.screenshot({path:'artifacts/silo-2d-overview.png'});
  console.log('Silo 2D',JSON.stringify({raw:(await read()).raw,released:(await read()).released,completed:(await read()).completed,cons:(await read()).cons}));
  expect(errors).toEqual([]);
});
