import { describe, expect, it } from 'vitest';
import { GameCore } from '../../src/core/game-core';
import { buildBoardLayout } from '../../src/core/layout';
import { rawFeedLanes, RAW_ENTRY_V, RAW_EXIT_SPEED } from '../../src/core/raw-feed';
import { localToWorld, localDirectionToWorld } from '../../src/core/frame';
import { createScenario } from '../../src/lab/scenario';
import { Simulation } from '../../src/lab/simulation';
import { rawFeedRoute, rawFeedPosition } from '../../src/lab/device-layout';

const conserved={produced:0,seed:0,raw:0};
describe('silo and full-width distributor',()=>{
  it('reserves each unit once, counts in-transit capacity, and pays nothing during transport',()=>{
    const s=createScenario('empty');s.flow.plinkoMaxActive=2;s.flow.plinkoReleasePerSec=6;
    const c=new GameCore(s.economy,s.flow,buildBoardLayout(s.board,s.pegs),s.seed);c.addRaw(10);
    const orders: Parameters<GameCore['takeReleases']>[1]=[];
    for(let i=0;i<120;i++){c.beginTick(1/60);c.takeReleases(1/60,orders,()=>5);}
    expect(c.rawQueue).toBe(8);expect(c.rawTransit.size).toBe(2);expect(c.items.size).toBe(0);expect(orders).toHaveLength(0);
    expect(c.total).toBe(0);expect(c.conservationError()).toEqual(conserved);
    for(let i=0;i<240;i++){c.beginTick(1/60);c.takeReleases(1/60,orders,()=>5);}
    expect(orders).toHaveLength(2);expect(new Set(orders.map(o=>o.id)).size).toBe(2);expect(c.rawQueue).toBe(8);
    expect(c.rawTransit.size).toBe(0);expect(c.items.size).toBe(2);expect(c.total).toBe(0);expect(c.conservationError()).toEqual(conserved);
  });
  it('every metering mouth including both ends hands off the same position and velocity to physics',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s), lanes=rawFeedLanes(s.board), seen=new Set<number>();
    try {
      const spawn=sim.plinko.spawn.bind(sim.plinko);
      sim.plinko.spawn=body=>{
        expect(lanes).toContain(body.u);seen.add(body.u);
        expect(body.v).toBe(RAW_ENTRY_V);expect(body.vu).toBe(0);expect(body.vv).toBe(RAW_EXIT_SPEED);
        const route=rawFeedRoute(s.board,sim.frame,sim.device,body.u), end=rawFeedPosition(route,route.seconds);
        const start=localToWorld(sim.frame,body.u,body.v,.3), before=rawFeedPosition(route,route.seconds-.001), velocity=localDirectionToWorld(sim.frame,body.vu,body.vv);
        for(const key of ['x','y','z'] as const){expect(start[key]).toBeCloseTo(end[key],8);expect((end[key]-before[key])/.001).toBeCloseTo(velocity[key],6);}
        expect(sim.core.rawTransit.has(body.id)).toBe(false);expect(sim.core.items.has(body.id)).toBe(true);
        spawn(body);
      };
      sim.addRaw(lanes.length*2);
      for(let i=0;i<1800 && seen.size<lanes.length;i++)sim.step();
      expect(seen.size).toBe(lanes.length);expect(Math.min(...seen)).toBeLessThan(s.board.width*.1);expect(Math.max(...seen)).toBeGreaterThan(s.board.width*.9);
      expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });
  it('hidden-tab settlement preserves the unfinished feed leg instead of bursting duplicate bodies on resume',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try{
      sim.addRaw(1);for(let i=0;i<600 && sim.core.rawTransit.size===0;i++)sim.step();
      const a=[...sim.core.rawTransit.values()][0];expect(a).toBeDefined();
      expect(a.source).toEqual({x:sim.device.silo.x+sim.silo.lastExit!.x,y:sim.silo.lastExit!.y,z:sim.device.silo.z});
      const route=rawFeedRoute(s.board,sim.frame,sim.device,a.order.u,a.source);
      expect(rawFeedPosition(route,0)).toEqual(a.source);
      const remaining=a.arriveAt-sim.core.time,id=a.order.id;
      sim.settleElapsed(90);
      expect(sim.core.rawTransit.get(id)!.arriveAt-sim.core.time).toBeCloseTo(remaining,8);
      expect(sim.core.stats.completed).toBe(0);expect(sim.core.conservationError()).toEqual(conserved);
      sim.step();expect(sim.core.items.size).toBe(0);
      for(let i=0;i<remaining*60+1;i++)sim.step();
      expect(sim.core.items.has(id)).toBe(true);expect(sim.core.stats.released).toBe(1);expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });
});
