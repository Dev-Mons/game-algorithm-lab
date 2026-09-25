import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { AgentBuffer } from '../src/core/agent-state';
import { SpatialHash } from '../src/algorithms/spatial-hash/spatial-hash';
import { CrowdMovementSolver, type CrowdMovementInput } from '../src/core/crowd-movement-solver';
import { ExternalInfluences } from '../src/core/external-influences';

// Load the exact issue baseline's real solver, not a hand-written approximation.
const reference='scripts/.external-reference.ts';
const source=execFileSync('git',['show','db4608916a5199f20e76ee55c2b77cd9a396e90b:Navigation/Crowd/src/core/crowd-movement-solver.ts'],{encoding:'utf8'});
writeFileSync(reference,source.replaceAll("from './","from '../src/core/").replaceAll("from '../algorithms/","from '../src/algorithms/"));
try {
  const modulePath=`${process.cwd().replaceAll('\\','/')}/${reference}`;
  const {CrowdMovementSolver:Reference}=await import(/* @vite-ignore */ modulePath);
  const rows=[];
  for(const model of ['legacy','xpbd-unclamped','xpbd-eight-substeps','physical','split-velocity'] as const) {
    for(const scene of ['backwards','chain16','crossing','wall','recovery'] as const) {
      const count=scene==='chain16'?16:scene==='crossing'?2:1;
      let current=new AgentBuffer(count),next=new AgentBuffer(count);
      current.active.fill(1);current.y.fill(360);current.intentX.fill(1);
      for(let a=0;a<count;a++) current.x[a]=200+a*(scene==='crossing'?13:6.4);
      current.vx[0]=scene==='backwards'||scene==='recovery'?-500:600;
      if(scene==='recovery')current.x[0]=600;
      if(scene==='crossing')current.vx[1]=-600;
      const ext=new ExternalInfluences(count,1200,720);ext.reset();ext.settings.drag=0;ext.settings.control=0;
      if(scene==='recovery'&&model==='physical'){ext.settings.drag=1.5;ext.settings.control=.25;}
      ext.affected.fill(1);ext.finish(current);
      const physical=model==='physical'||model==='split-velocity';
      const solver=physical?new CrowdMovementSolver():new Reference();
      // Independent motor component; residual external velocity is total minus motor.
      // After every contact total is canonical, so rebasing prevents latent wall impulses.
      const motorX=new Float64Array(model==='split-velocity'?count:0),motorY=new Float64Array(model==='split-velocity'?count:0);
      const input: CrowdMovementInput={current,next,index:new SpatialHash(1200,720,6.4,count),desiredVelocityX:new Float64Array(count),desiredVelocityY:new Float64Array(count),
        solvedVelocityX:new Float64Array(count),solvedVelocityY:new Float64Array(count),recovery:new Uint8Array(count),overlapFlags:new Uint8Array(count),
        agentRadius:3.2,agentGap:0,maxSpeed:model==='legacy'||physical?86:600,maxAcceleration:scene==='recovery'?210:0,turnSpeed:model==='legacy'?360:172800,
        fixedDelta:1/60,contactCompliance:.00001,contactFriction:.08,maximumContactCorrection:1.25,wallClearance:3.55,worldWidth:1200,worldHeight:720,
        obstacles:scene==='wall'?[{x:210,y:100,width:1,height:500}]:[],external:physical?ext:undefined};
      if(scene==='recovery')input.desiredVelocityX.fill(86);
      let maximumPenetration=0,maximumEnergy=0,firstVx=0,firstX=0,swapped=false,recoveredAt:number|null=null;
      const started=performance.now();
      for(let tick=0;tick<(scene==='recovery'?240:30);tick++) {
        if(model==='split-velocity')for(let a=0;a<count;a++) {
          const rx=current.vx[a]!-motorX[a]!,ry=current.vy[a]!-motorY[a]!;
          const dx=input.desiredVelocityX[a]!-motorX[a]!,dy=input.desiredVelocityY[a]!-motorY[a]!,d=Math.hypot(dx,dy);
          const scale=d>0?Math.min(1,input.maxAcceleration*.25/60/d):0;
          motorX[a]=motorX[a]!+dx*scale;motorY[a]=motorY[a]!+dy*scale;
          const decay=scene==='recovery'?Math.exp(-1.5/60):1;
          current.vx[a]=motorX[a]!+rx*decay;current.vy[a]=motorY[a]!+ry*decay;
        }
        const steps=model==='xpbd-eight-substeps'?8:1;input.fixedDelta=1/60/steps;
        for(let sub=0;sub<steps;sub++) {input.current=current;input.next=next;solver.solve(input);const swap=current;current=next;next=swap;}
        if(tick===0){firstVx=current.vx[0]!;firstX=current.x[0]!;}
        if(scene==='recovery'&&recoveredAt===null&&current.vx[0]!>=86*.95)recoveredAt=(tick+1)/60;
        if(scene==='crossing'&&current.x[0]!>current.x[1]!)swapped=true;
        maximumEnergy=Math.max(maximumEnergy,[...current.vx].reduce((sum,v,a)=>sum+v*v+current.vy[a]!**2,0));
        for(let a=0;a<count;a++)for(let b=a+1;b<count;b++)maximumPenetration=Math.max(maximumPenetration,6.4-Math.hypot(current.x[a]!-current.x[b]!,current.y[a]!-current.y[b]!));
      }
      rows.push({model,scene,firstVx,firstX,finalVx:current.vx[0],lastBodyX:current.x[count-1],swapped,maximumPenetration,maximumEnergy,recoveredAt,extraPersistentVelocityBytes:motorX.byteLength+motorY.byteLength,elapsedMs:performance.now()-started});
    }
  }
  writeFileSync('baselines/external-model-comparison.json',JSON.stringify({baseline:'db4608916a5199f20e76ee55c2b77cd9a396e90b',note:'30 ticks (240 recovery); radius 3.2; no control/drag except recovery; elapsed is cold micro-experiment time, not a performance gate; XPBD extensions raise maximumSpeed/turnSpeed; split motor uses same physical contact solver and rebases residual after collision',rows},null,2));
  console.table(rows);
} finally { unlinkSync(reference); }
