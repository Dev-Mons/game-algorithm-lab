import {expect,test} from '@playwright/test';
test.use({viewport:{width:1600,height:900},video:{mode:'on',size:{width:1600,height:900}}});
test('concealed transfer releases vertically onto the moving plate and the plate pushes the production coin',async({page})=>{
  test.setTimeout(65000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?preset=empty&camera=all&quality=high');await page.waitForSelector('body[data-ready="1"]');
  await page.waitForTimeout(400);await page.screenshot({path:'artifacts/left-layout-empty.png'});
  const metrics=await page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,f=s.frame,c=l.view.camera;
    const points=[[0,0],[s.scenario.board.width,0],[0,s.scenario.board.height],[s.scenario.board.width,s.scenario.board.height]].map(([u,v])=>c.position.clone().set(
      f.origin.x+(f.uAxis.x*u+f.vAxis.x*v)*f.scale,f.origin.y+(f.uAxis.y*u+f.vAxis.y*v)*f.scale,f.origin.z+(f.uAxis.z*u+f.vAxis.z*v)*f.scale).project(c));
    return {width:(Math.max(...points.map((p:any)=>p.x))-Math.min(...points.map((p:any)=>p.x)))/2,
      height:(Math.max(...points.map((p:any)=>p.y))-Math.min(...points.map((p:any)=>p.y)))/2,
      left:s.device.scrap.x+s.device.pressHalfWidth,edge:-s.scenario.tray.width/2};
  });
  expect(metrics.left).toBeLessThan(metrics.edge);expect(metrics.width).toBeGreaterThan(.42);expect(metrics.height).toBeGreaterThan(.18);
  for(let i=0;i<5;i++)await page.click('#presentation-add');
  await page.waitForFunction(()=>{const s=(window as any).__lab.runner.sim;return s.core.chute.length>0;},null,{timeout:20000});
  expect(await page.evaluate(()=>(window as any).__lab.view.device.chunks.count)).toBe(0);
  await page.screenshot({path:'artifacts/concealed-process.png'});
  await page.waitForFunction(()=>{const s=(window as any).__lab.runner.sim;return s.core.pressPhase==='ready' && s.discharge.progress>.22 && s.discharge.progress<.6;},null,{timeout:20000});
  await page.click('#presentation-pause');
  const transfer=await page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim;
    return {visible:l.view.device.pressBlank.count,seed:s.core.stats.seedPlaced};
  });
  expect(transfer.visible).toBe(0);expect(transfer.seed).toBe(0);
  await page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,e={id:0,landed:false,leftShelf:false,pushed:false,landZ:0,vz:NaN};(window as any).__plateFeed=e;
    const watch=()=>{
      if(!e.id && s.handovers.length){e.id=s.handovers[0].id;e.vz=s.handovers[0].vz;}
      for(let i=0;i<s.pusherSnap.count;i++)if(s.pusherSnap.ids[i]===e.id){
        const y=s.pusherSnap.c[i],z=s.pusherSnap.b[i];
        if(!e.landed && Math.abs(y-(.9+s.scenario.tray.tokenHalfHeight))<.12 && z<s.pusherFace && z>s.pusherFace-s.scenario.tray.pusherDepth){e.landed=true;e.landZ=z;}
        if(e.landed && y<.45)e.leftShelf=true;
        if(e.leftShelf && z>e.landZ+.7)e.pushed=true;
      }
      if(!e.pushed)requestAnimationFrame(watch);
    };requestAnimationFrame(watch);
  });
  await page.click('.workbench-tools [data-cam="pusher"]');
  await page.click('#presentation-pause');
  await page.waitForFunction(()=>(window as any).__lab.runner.sim.outletDisplay().length>0,null,{timeout:15000});
  await page.click('#presentation-pause');
  const exit=await page.evaluate(()=>{
    const l=(window as any).__lab,s=l.runner.sim,items=s.outletDisplay(),a=l.view.device.pressBlank.instanceMatrix.array;let error=0;
    items.forEach((v:any,i:number)=>{const p=s.diePosition(v.slot);error=Math.max(error,Math.hypot(a[i*16+12]-p.x,a[i*16+13]-p.y,a[i*16+14]-p.z));});return {error,count:items.length};
  });
  expect(exit.count).toBeGreaterThan(0);expect(exit.error).toBeLessThan(1e-5);
  await page.screenshot({path:'artifacts/plate-feed-release.png'});await page.click('#presentation-pause');
  await page.waitForFunction(()=>(window as any).__plateFeed.landed,null,{timeout:15000});
  await page.click('#presentation-pause');await page.screenshot({path:'artifacts/plate-feed-landed.png'});await page.click('#presentation-pause');
  await page.waitForFunction(()=>(window as any).__plateFeed.pushed,null,{timeout:20000});
  const evidence=await page.evaluate(()=>(window as any).__plateFeed);expect(evidence.vz).toBe(0);expect(evidence.landed).toBe(true);expect(evidence.leftShelf).toBe(true);
  await page.screenshot({path:'artifacts/plate-feed-pushed.png'});
  const result=await page.evaluate(()=>{const s=(window as any).__lab.runner.sim;return {made:s.core.stats.tokensMade,fed:s.gateStats.fed,cons:s.core.conservationError(),lost:s.core.stats.lostTokens};});
  expect(result.cons).toEqual({produced:0,seed:0,raw:0});expect(result.lost).toBe(0);expect(errors).toEqual([]);
  console.log('Plate feed',JSON.stringify({metrics,evidence,...result}));
});
