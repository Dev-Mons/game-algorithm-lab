import { expect, test } from '@playwright/test';

test.use({viewport:{width:1600,height:900},video:{mode:'on',size:{width:1600,height:900}}});
test('one visible press lowers an intact heap behind the cover then releases value-one groups',async({page})=>{
  test.setTimeout(85000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?preset=empty&camera=transfer&quality=high');await page.waitForSelector('body[data-ready="1"]');
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.trayMaxTokens=0;}));
  await page.evaluate(()=>{
    const births=new Map<number,number>();(window as any).__scrapDrop=0;
    const watch=()=>{const s=(window as any).__lab.runner.sim;for(const b of s.scrap.bodies){if(!births.has(b.id))births.set(b.id,b.y);(window as any).__scrapDrop=Math.max((window as any).__scrapDrop,births.get(b.id)!-b.y);}requestAnimationFrame(watch);};watch();
  });
  for(let i=0;i<5;i++)await page.click('#presentation-add');
  const read=()=>page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim;
    return {drop:(window as any).__scrapDrop,bodies:s.scrap.bodies.map((b:any)=>({...b})),accepted:s.scrap.released,cover:s.device.scrapCoverY,
      made:s.core.stats.tokensMade,fed:s.gateStats.fed,blocked:s.discharge.blocked,open:s.scrap.gateOpen,
      cons:s.core.conservationError(),loss:s.core.stats.lostTokens,duplicates:s.core.stats.duplicateExits,
      seed:s.core.stats.seedPlaced,visiblePress:!!l.view.device.piston,phase:s.core.pressPhase,handovers:s.handovers.map((h:any)=>({...h}))};
  });
  await expect.poll(async()=>(await read()).bodies.length,{timeout:22000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await read()).drop,{timeout:5000}).toBeGreaterThan(.15);
  await expect.poll(async()=>{const r=await read();return r.blocked && r.bodies.filter((b:any)=>b.y>r.cover+.1).length>=12;},{timeout:22000}).toBe(true);
  const held=await read();expect(held.open).toBe(false);expect(held.visiblePress).toBe(true);expect(held.seed).toBe(0);
  expect(new Set(held.bodies.map((b:any)=>b.radius)).size).toBeGreaterThan(3);
  await page.screenshot({path:'artifacts/scrap-heap-held.png'});
  await page.waitForTimeout(1000);expect((await read()).accepted).toBe(held.accepted);expect((await read()).made).toBe(held.made);
  await page.evaluate(()=>(window as any).__lab.runner.configure((s:any)=>{s.flow.trayMaxTokens=1500;}));
  await page.click('#lab-toggle');await page.selectOption('#speed','0.25');await page.click('#lab-toggle');
  await page.waitForFunction(()=>{const s=(window as any).__lab.runner.sim;return s.core.pressPhase==='pressing' && s.core.pressTime===0;},null,{timeout:30000});
  await page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,initial=new Map(s.scrap.bodies.map((b:any)=>[b.id,{...b}]));
    const result={samples:0,drop:0,scaleError:0,poseError:0,movedIntact:true};(window as any).__stroke=result;
    const watch=()=>{
      if(s.core.pressPhase!=='pressing')return;
      result.samples++;result.drop=Math.max(result.drop,s.scrap.floorDrop);
      s.scrap.bodies.forEach((b:any,i:number)=>{
        const a=initial.get(b.id) as any,m=l.view.device.scrapPieces.instanceMatrix.array,o=i*16;
        if(!a || Math.abs(a.y-b.y-s.scrap.floorDrop)>1e-6 || a.x!==b.x || a.radius!==b.radius || a.angle!==b.angle)result.movedIntact=false;
        for(const j of [0,4,8])result.scaleError=Math.max(result.scaleError,Math.abs(Math.hypot(m[o+j],m[o+j+1],m[o+j+2])-b.radius));
      });
      result.poseError=Math.max(result.poseError,Math.abs(l.view.device.piston.position.y-s.pressPose.y));requestAnimationFrame(watch);
    };requestAnimationFrame(watch);
  });
  await page.waitForFunction(()=>{const s=(window as any).__lab.runner.sim;return s.core.pressPhase==='pressing' && s.core.pressTime>.15 && s.core.pressTime<.24;},null,{timeout:8000});
  await page.screenshot({path:'artifacts/scrap-press-lowering.png'});
  await page.waitForFunction(()=>((window as any).__stroke?.drop??0)>.5,null,{timeout:5000});
  const stroke=await page.evaluate(()=>(window as any).__stroke);
  expect(stroke.samples).toBeGreaterThan(3);expect(stroke.movedIntact).toBe(true);expect(stroke.scaleError).toBeLessThan(1e-6);expect(stroke.poseError).toBeLessThan(1e-6);
  await page.click('#lab-toggle');await page.selectOption('#speed','1');await page.click('#lab-toggle');
  await expect.poll(async()=>(await read()).accepted,{timeout:10000}).toBeGreaterThan(held.accepted);
  await page.screenshot({path:'artifacts/scrap-heap-draining.png'});
  await expect.poll(async()=>{
    const r=await read(),groups=new Map<number,any[]>();
    for(const h of r.handovers){const g=groups.get(h.batchId)??[];g.push(h);groups.set(h.batchId,g);}
    return [...groups.values()].some(g=>g.length>=8 && new Set(g.map(h=>h.port)).size===4);
  },{timeout:15000}).toBe(true);
  const result=await read();expect(result.cons).toEqual({produced:0,seed:0,raw:0});expect(result.loss).toBe(0);expect(result.duplicates).toBe(0);
  const last=result.handovers.at(-1).batchId,group=result.handovers.filter((h:any)=>h.batchId===last);
  expect(new Set(group.map((h:any)=>h.tick)).size).toBeGreaterThan(1);
  await page.click('.workbench-tools [data-cam="all"]');await page.waitForTimeout(800);
  await page.screenshot({path:'artifacts/scrap-heap-overview.png'});
  console.log('Physical scrap',JSON.stringify({accepted:result.accepted,made:result.made,fed:result.fed,seed:result.seed,cons:result.cons}));
  expect(errors).toEqual([]);
});
