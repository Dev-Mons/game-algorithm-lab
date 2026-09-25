import { describe, expect, it } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { EXTERNAL_PROFILE, type ExternalInput } from '../../src/core/external-influences';
import type { Rect } from '../../src/core/types';
import { getScenario } from '../../src/scenarios/scenarios';

function scene(count=1, obstacles: Rect[]=[], controlled=false, dt=1/60) {
  const s = new CrowdSimulation({ ...DEFAULT_CONFIG, agentCount:count, maxAcceleration:controlled ? 210 : 0, fixedDelta:dt, agentGap:0 },
    { id:'external-test',name:'external-test',description:'',spawn:{x:100,y:100,width:300,height:400},goal:{x:1100,y:360},obstacles });
  s.external.settings.drag=controlled ? 1.5 : 0;
  for (let a=0;a<count;a++) { s.state.x[a]=200+a*6.4;s.state.y[a]=360;s.state.vx[a]=0;s.state.vy[a]=0;s.state.heading[a]=0; }
  return s;
}
function kick(s:CrowdSimulation,a:number,x:number,y=0,id='kick') {
  s.enqueueExternal({kind:'impulse',id,tick:s.stepCount,generation:s.external.generation,target:{agent:a},dvx:x,dvy:y});
}
function penetration(s:CrowdSimulation) {
  let maximum=0;
  // Independent exhaustive small-scene audit; never consumes the solver's contact list.
  for (let a=0;a<s.state.count;a++) for(let b=a+1;b<s.state.count;b++)
    maximum=Math.max(maximum,s.agentRadii[a]!+s.agentRadii[b]!-Math.hypot(s.state.x[a]!-s.state.x[b]!,s.state.y[a]!-s.state.y[b]!));
  return maximum;
}
describe('external-v1 physical movement', () => {
  it('returns a moving crowd to ordinary contacts instead of perpetually propagating knockback flags', () => {
    const s=new CrowdSimulation({...DEFAULT_CONFIG,agentCount:1000},getScenario('open-field'));
    for(let tick=0;tick<30;tick++)s.step();
    s.enqueueExternal({kind:'blast',id:'hit',tick:30,generation:1,x:235,y:360,radius:100,speed:400});
    s.step();expect(s.external.active).toBe(true);
    for(let tick=31;tick<270;tick++)s.step();
    expect(s.metrics.activeCount).toBe(1000);expect(s.external.active).toBe(false);
    for(let tick=0;tick<30;tick++)s.step();expect(s.external.affected.some(Boolean)).toBe(false);
  });
  it('preserves weak sub-walking-speed momentum when voluntary control is disabled', () => {
    const s=scene();s.config.maxAcceleration=210;s.external.settings.control=0;
    kick(s,0,10,-5);
    for(let tick=0;tick<20;tick++)s.step();
    expect(s.state.vx[0]).toBeCloseTo(10,8);expect(s.state.vy[0]).toBeCloseTo(-5,8);
    expect(s.state.x[0]).toBeCloseTo(200+10/3,8);
  });
  it('uses one step for coherent fast transport while retaining exact impulse displacement', () => {
    const s=scene(16,[{x:900,y:100,width:1,height:500}]);
    s.enqueueExternal({kind:'impulse',id:'coherent',tick:0,generation:1,target:{x:250,y:360,radius:200},dvx:500,dvy:0});
    s.step();
    expect(s.external.stats.substeps).toBe(1);
    for(let a=0;a<16;a++){expect(s.state.x[a]).toBeCloseTo(200+a*6.4+500/60,7);expect(s.state.vx[a]).toBeCloseTo(500,7);}
    expect(penetration(s)).toBeLessThan(.001);
  });
  it('keeps absolute-speed resolution when a coherent stream reaches a wall', () => {
    const s=scene(5,[{x:219,y:100,width:1,height:500}]);
    for(let a=0;a<5;a++)s.state.x[a]=180+a*6.4;
    s.enqueueExternal({kind:'impulse',id:'coherent',tick:0,generation:1,target:{x:200,y:360,radius:100},dvx:500,dvy:0});
    s.step();expect(s.external.stats.planningFallbacks).toBeGreaterThan(0);expect(s.external.stats.substeps).toBeGreaterThan(1);
    for(let tick=0;tick<10;tick++){s.step();expect(s.metrics.wallOverlapCount).toBe(0);expect(penetration(s)).toBeLessThanOrEqual(.5);}
  });
  it('does not multiply whole-crowd work for a distant non-contacting proxy', () => {
    const s=scene(16);
    s.enqueueExternal({kind:'proxy',id:'far',body:'car',tick:0,generation:1,x:800,y:100,toX:805,toY:100,radius:18});
    s.step();expect(s.external.stats.substeps).toBe(1);expect(s.external.affected.some(Boolean)).toBe(false);
  });
  it('keeps randomized approaching contacts finite and below the compression profile', () => {
    for(let seed=1;seed<=4;seed++) {
      const s=scene(24);let value=seed;
      for(let a=0;a<24;a++) {
        s.state.x[a]=400+(a%6)*15;s.state.y[a]=280+Math.floor(a/6)*15;
        s.agentRadii[a]=a%5===0?6.4:3.2;
        value=(Math.imul(value,1664525)+1013904223)>>>0;
        const angle=value/4294967296*Math.PI*2;kick(s,a,400*Math.cos(angle),400*Math.sin(angle),`hit${a}`);
      }
      s.maxAgentRadius=6.4;
      for(let tick=0;tick<30;tick++) {s.step();expect(penetration(s)).toBeLessThanOrEqual(.5);expect(s.metrics.wallOverlapCount).toBe(0);expect([...s.state.x,...s.state.vx].every(Number.isFinite)).toBe(true);}
    }
  });
  it.each([[500,0],[-500,0],[0,500]])('preserves an unclamped one-shot delta velocity (%s,%s)',(x,y) => {
    const s=scene();kick(s,0,x!,y!);s.step();
    expect(s.state.vx[0]).toBeCloseTo(x!,8);expect(s.state.vy[0]).toBeCloseTo(y!,8);
    expect(s.state.x[0]).toBeCloseTo(200+x!/60,8);expect(s.state.y[0]).toBeCloseTo(360+y!/60,8);
    s.step();expect(s.state.vx[0]).toBeCloseTo(x!,8);expect(s.state.vy[0]).toBeCloseTo(y!,8);
    expect(s.external.stats.affected).toBe(0);
  });
  it('deduplicates, rejects conflicts/nonfinite/stale input, and clears reset state', () => {
    const s=scene();const e:ExternalInput={kind:'impulse',id:'a',tick:0,generation:s.external.generation,target:{agent:0},dvx:10,dvy:0};
    expect(s.enqueueExternal(e)).toBe(true);expect(s.enqueueExternal({...e})).toBe(false);
    expect(()=>s.enqueueExternal({...e,dvx:20})).toThrow();
    expect(()=>s.enqueueExternal({...e,id:'bad',dvx:NaN})).toThrow();
    expect(()=>s.enqueueExternal({...e,id:'big',dvx:601})).toThrow();
    expect(()=>s.enqueueExternal({...e,id:'target',target:{agent:2}})).toThrow();
    s.step();expect(s.enqueueExternal(e)).toBe(false);
    s.reset();expect(()=>s.enqueueExternal(e)).toThrow(/Stale/);expect(s.external.record()).toEqual([]);expect(s.external.active).toBe(false);
  });
  it('integrates acceleration in seconds, with an exclusive end tick and cancellation', () => {
    const results:number[]=[];
    for (const dt of [1/60,1/120]) {
      const s=scene(1,[],false,dt);
      s.enqueueExternal({kind:'acceleration',id:'wind',tick:0,generation:s.external.generation,target:{agent:0},ax:120,ay:0,endTick:Math.round(.5/dt)});
      for(let i=0;i<Math.round(1/dt);i++)s.step();results.push(s.state.vx[0]!);
    }
    expect(results[0]).toBeCloseTo(60,8);expect(results[1]).toBeCloseTo(60,8);
    const s=scene();s.enqueueExternal({kind:'acceleration',id:'wind',tick:0,generation:s.external.generation,target:{agent:0},ax:60,ay:0,endTick:60});
    s.enqueueExternal({kind:'cancel',id:'stop',input:'wind',tick:5,generation:s.external.generation});
    for(let i=0;i<10;i++)s.step();expect(s.state.vx[0]).toBeCloseTo(5,8);
  });
  it('hits every agent in an area, including more than the contact candidate budget', () => {
    const s=scene(80);
    s.enqueueExternal({kind:'impulse',id:'area',tick:0,generation:s.external.generation,target:{x:450,y:360,radius:400},dvx:100,dvy:0});
    s.step();expect(s.external.stats.affected).toBe(80);
    expect([...s.state.vx].every(v=>Math.abs(v-100)<1e-7)).toBe(true);
  });
  it('uses deterministic blast center direction and linear spatial falloff', () => {
    const s=scene(3);s.state.x.set([200,250,150]);s.state.y.set([360,360,360]);
    s.enqueueExternal({kind:'blast',id:'blast',tick:0,generation:s.external.generation,x:200,y:360,radius:100,speed:300});s.step();
    expect(Math.hypot(s.state.vx[0]!,s.state.vy[0]!)).toBeCloseTo(300,7);
    expect(s.state.vx[1]).toBeCloseTo(150,7);expect(s.state.vx[2]).toBeCloseTo(-150,7);
    expect(s.external.stats.affected).toBe(3);
  });
  it('hits a wave target only once as the front expands', () => {
    const s=scene();s.state.x[0]=230;
    s.enqueueExternal({kind:'blast',id:'wave',tick:0,generation:s.external.generation,x:200,y:360,radius:100,speed:100,expansionSpeed:60});
    let hits=0;for(let i=0;i<100;i++){s.step();hits+=s.external.stats.affected;}
    expect(hits).toBe(1);expect(s.state.vx[0]).toBeCloseTo(70,6);
  });
  it.each([2,3,16])('transmits through %s touching bodies without energy amplification', count => {
    const s=scene(count);kick(s,0,500);let maximumDepth=0;
    for(let i=0;i<30;i++) {
      s.step();maximumDepth=Math.max(maximumDepth,penetration(s));
      const energy=[...s.state.vx].reduce((sum,v,a)=>sum+v*v+s.state.vy[a]!**2,0);
      expect(energy).toBeLessThanOrEqual(500**2+1e-5);
    }
    expect(s.state.x[count-1]).toBeGreaterThan(200+(count-1)*6.4+.1);
    expect(maximumDepth).toBeLessThanOrEqual(EXTERNAL_PROFILE.compressionTolerance);
  });
  it('detects crossing between endpoints and mixed radii with no side swap', () => {
    const s=scene(2);s.state.x.set([200,213]);s.agentRadii[1]=6.4;s.maxAgentRadius=6.4;
    kick(s,0,600,0,'a');kick(s,1,-600,0,'b');s.step();
    expect(s.state.x[0]).toBeLessThan(s.state.x[1]!);
    expect(penetration(s)).toBeLessThanOrEqual(.01);
  });
  it('sweeps thin walls and keeps removed wall-normal velocity removed next tick', () => {
    const s=scene(1,[{x:210,y:100,width:1,height:500}]);kick(s,0,600);s.step();
    expect(s.state.x[0]).toBeLessThanOrEqual(210-3.55+1e-6);
    expect(s.state.vx[0]).toBeCloseTo(0,8);s.step();expect(s.state.vx[0]).toBeCloseTo(0,8);expect(s.metrics.wallOverlapCount).toBe(0);
  });
  it('returns to 95% navigation speed within the declared four seconds', () => {
    const s=scene(1,[],true);s.state.x[0]=500;const goal={...s.goal};kick(s,0,-500);
    s.step();expect(s.state.vx[0]).toBeLessThan(0);
    for(let i=1;i<240;i++)s.step();
    expect(s.goal).toEqual(goal);expect(s.state.vx[0]).toBeGreaterThanOrEqual(.95*s.config.maxSpeed);
    expect(s.external.affected[0]).toBe(0);
  });
  it('pushes continuously with prescribed circular motion then removes the proxy', () => {
    const s=scene(3);s.state.x.set([200,206.4,212.8]);
    for(let tick=0;tick<60;tick++) {
      s.enqueueExternal({kind:'proxy',id:`p${tick}`,body:'vehicle',tick,generation:s.external.generation,x:180+tick,y:360,toX:181+tick,toY:360,radius:12});s.step();
      expect(penetration(s)).toBeLessThanOrEqual(.5);
      expect(s.state.x[0]).toBeGreaterThanOrEqual(181+tick+15.2-.5);
    }
    expect(s.state.x[2]).toBeGreaterThan(240);
    s.enqueueExternal({kind:'remove-proxy',id:'remove',body:'vehicle',tick:60,generation:s.external.generation});s.step();
    expect(s.external.proxies).toHaveLength(0);
    const v=s.state.vx[0]!;s.step();expect(s.state.vx[0]).toBeCloseTo(v,6);
  });
  it('keeps the static wall authoritative when a proxy crushes an agent', () => {
    const s=scene(1,[{x:215,y:100,width:1,height:500}]);let crushed=0;
    for(let tick=0;tick<35;tick++) {
      s.enqueueExternal({kind:'proxy',id:`p${tick}`,body:'vehicle',tick,generation:s.external.generation,x:180+tick,y:360,toX:181+tick,toY:360,radius:12});s.step();
      crushed+=s.external.stats.crushed;expect(s.metrics.wallOverlapCount).toBe(0);expect(s.state.x[0]).toBeLessThanOrEqual(211.45+1e-6);
    }
    expect(crushed).toBeGreaterThan(0);
  });
  it('reports query saturation and clamps combined inputs without nonfinite values', () => {
    const s=scene(90);s.state.x.fill(200);s.state.y.fill(360);kick(s,0,600,0,'a');kick(s,0,600,0,'b');s.step();
    expect(s.external.stats.speedClamps).toBeGreaterThan(0);expect(s.external.stats.saturatedQueries).toBeGreaterThan(0);
    expect(s.external.stats.substeps).toBeLessThanOrEqual(16);expect([...s.state.x,...s.state.vx].every(Number.isFinite)).toBe(true);
  });
  it('keeps the arrival sink inactive even when an input targets it', () => {
    const s=scene();s.state.x[0]=1100;kick(s,0,-500);s.step();expect(s.state.active[0]).toBe(0);expect(s.state.vx[0]).toBe(0);
  });
  it('does not transmit contact momentum through a thin static wall', () => {
    const s=scene(2,[{x:210,y:100,width:1,height:500}]);s.state.x.set([206,215]);
    kick(s,0,600);s.step();expect(s.state.vx[1]).toBeCloseTo(0,8);expect(s.external.affected[1]).toBe(0);
    expect(s.metrics.wallOverlapCount).toBe(0);
  });
  it('stores input values defensively and accepts equivalent reordered retransmissions', () => {
    const s=scene();const e:ExternalInput={kind:'impulse',id:'copy',tick:0,generation:1,target:{agent:0},dvx:100,dvy:0};
    s.enqueueExternal(e);expect(s.enqueueExternal({dvy:0,dvx:100,target:{agent:0},generation:1,tick:0,id:'copy',kind:'impulse'})).toBe(false);
    e.dvx=500;s.step();expect(s.state.vx[0]).toBe(100);
  });
  it('rejects proxy discontinuities and excessive future body count atomically', () => {
    const s=scene();const e:ExternalInput={kind:'proxy',id:'p',body:'car',tick:0,generation:1,x:180,y:360,toX:181,toY:360,radius:10};
    s.enqueueExternal(e);
    expect(()=>s.enqueueExternal({...e,id:'bad',tick:1,x:200,toX:201})).toThrow(/discontinuity/);
    expect(s.external.record()).toHaveLength(1);
    for(let i=1;i<8;i++)s.enqueueExternal({...e,id:`p${i}`,body:`car${i}`});
    expect(()=>s.enqueueExternal({...e,id:'p9',body:'car9'})).toThrow(/capacity/);
    expect(s.external.record()).toHaveLength(8);
  });
  it('stops a moving proxy without leaving prescribed velocity in its next tick', () => {
    const s=scene();s.enqueueExternal({kind:'proxy',id:'p',body:'car',tick:0,generation:1,x:180,y:360,toX:185,toY:360,radius:12});
    s.step();s.step();expect(s.external.proxies[0]!.x).toBe(185);expect(s.external.proxies[0]!.toX).toBe(185);
  });
  it('updates navigation after repeated hits and a new goal, without a position jump', () => {
    const s=scene(1,[],true);s.state.x[0]=500;kick(s,0,-300);s.step();s.setGoal(1000,500);kick(s,0,0,-300,'again');
    for(let i=0;i<240;i++) { const x=s.state.x[0]!,y=s.state.y[0]!;s.step();expect(Math.hypot(s.state.x[0]!-x,s.state.y[0]!-y)).toBeLessThanOrEqual(10.001); }
    expect(s.goal).toEqual({x:1000,y:500});expect(s.state.vx[0]).toBeGreaterThan(0);expect(s.state.vy[0]).toBeGreaterThan(0);
  });
  it('replays sorted inputs and all principal arrays exactly', () => {
    const a=scene(12,[],true),b=scene(12,[],true);
    const events:ExternalInput[]=[{kind:'blast',id:'b',tick:10,generation:1,x:220,y:360,radius:80,speed:300,expansionSpeed:100},
      {kind:'impulse',id:'a',tick:0,generation:1,target:{agent:0},dvx:-400,dvy:100}];
    for(const e of events)a.enqueueExternal(e);for(const e of [...events].reverse())b.enqueueExternal(e);
    for(let tick=0;tick<120;tick++){a.step();b.step();}
    expect(a.stateHash()).toBe(b.stateHash());
    for(const k of ['x','y','vx','vy','heading','intentX','intentY','active'] as const) expect(a.state[k]).toEqual(b.state[k]);
    expect(a.external.fingerprint()).toBe(b.external.fingerprint());
  });
});
