import { describe, expect, it } from 'vitest';
import { Silo2D } from '../../src/physics/silo-2d';
import { Simulation } from '../../src/lab/simulation';
import { createScenario } from '../../src/lab/scenario';
import { deviceLayout, OUTLET_STAGGER_SECONDS } from '../../src/lab/device-layout';

const conserved={produced:0,seed:0,raw:0};
describe('physical scrap and hidden batch processing',()=>{
  it('varied scraps form multiple layers while additional stock waits above the bounded batch chamber',()=>{
    const scenario=createScenario('empty'),spec=deviceLayout(scenario.board,scenario.tray).scrap;
    const bin=new Silo2D(spec);bin.syncStock(60);
    for(let i=0;i<360;i++)bin.step(1/60);
    expect(bin.bodies.length).toBe(24);expect(bin.released).toBe(0);
    expect(bin.pending).toBe(36);
    expect(new Set(bin.bodies.map(b=>b.radius)).size).toBeGreaterThan(3);
    expect(Math.max(...bin.bodies.map(b=>b.y))-Math.min(...bin.bodies.map(b=>b.y))).toBeGreaterThan(spec.radius*3);
    for(const body of bin.bodies)expect(Math.abs(body.x)+body.radius).toBeLessThan(spec.width/2);
    expect(bin.bodies.length+bin.pending+bin.released).toBe(60);
  });

  it('one platen stroke lowers intact fragments and only mints after they pass behind the cover',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      sim.addRaw(20);
      for(let i=0;i<1800 && sim.core.pressPhase!=='pressing';i++)sim.step();
      expect(sim.core.pressPhase).toBe('pressing');const quota=sim.core.compressionCount;
      const before=new Map(sim.scrap.bodies.map(b=>[b.id,{...b}]));
      expect(before.size).toBe(quota);expect(sim.scrapLoaded).toBe(0);
      const take=sim.scrap.takeCovered.bind(sim.scrap);sim.scrap.takeCovered=()=>false;
      for(let i=0;i<30;i++) {
        sim.step();
        for(const b of sim.scrap.bodies) {
          const start=before.get(b.id)!;
          expect(b.radius).toBe(start.radius);expect(b.angle).toBe(start.angle);expect(b.x).toBe(start.x);
          expect(b.y).toBeCloseTo(start.y-sim.scrap.floorDrop,9);
          expect(b.y+b.radius).toBeLessThanOrEqual(sim.pressPose.y+.001);
        }
        expect(sim.scrap.bodies.length+sim.scrap.pending+sim.scrapLoaded).toBe(sim.core.compressorBuffer);
      }
      expect(sim.core.pressPhase).toBe('pressing');expect(sim.core.stats.tokensMade).toBe(0);
      expect(sim.scrap.floorDrop).toBeGreaterThan(.5);
      expect(sim.scrap.bodies.every(b=>b.y+b.radius<sim.device.scrapCoverY)).toBe(true);
      sim.scrap.takeCovered=take;sim.step();
      expect(sim.core.stats.tokensMade).toBe(quota);expect(sim.scrap.released).toBe(quota);
      expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });

  it('finishes the loaded size when settings change and applies the smaller size to the next fill',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      sim.addRaw(30);
      for(let i=0;i<1800 && sim.core.pressPhase!=='loading';i++)sim.step();
      const count=sim.core.compressionCount;sim.core.economy.tokenBundleMax=1;
      for(let i=0;i<600 && sim.core.stats.tokensMade===0;i++)sim.step();
      expect(sim.core.stats.tokensMade).toBe(count);
      for(let i=0;i<900 && sim.core.pressPhase!=='loading';i++)sim.step();
      expect(sim.core.compressionCount).toBe(1);
      expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });

  it('releases four groups at different ticks without changing seats, duplicating IDs or values',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      sim.addRaw(30);
      for(let i=0;i<3000 && sim.batchStats.largestDump<8;i++)sim.step();
      const batchId=sim.handovers.at(-1)!.batchId,batch=sim.handovers.filter(h=>h.batchId===batchId);
      expect(batch.length).toBeGreaterThanOrEqual(8);expect(new Set(batch.map(h=>h.port)).size).toBe(4);
      // Independent backpressure can reorder completed outlets; batches must not become one instantaneous spawn.
      const times=Array.from({length:4},(_,p)=>batch.find(h=>h.port===p)!.tick);
      expect(Math.max(...times)-Math.min(...times)).toBeGreaterThanOrEqual(OUTLET_STAGGER_SECONDS*60-1);
      expect(new Set(sim.handovers.map(h=>h.id)).size).toBe(sim.handovers.length);
      for(const h of batch)expect(sim.core.tray.get(h.id)!.value).toBe(1);
      const fed=sim.core.stats.tokensFed;
      expect(sim.core.commitFeedGroup([batch[0].id])).toEqual([]);expect(sim.core.stats.tokensFed).toBe(fed);
      expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });

  it('resuming hidden settlement during a partial discharge does not replay already emitted coins',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      sim.addRaw(30);
      for(let i=0;i<3000 && !(sim.discharge.ports[0].done && !sim.discharge.ports[1].done);i++)sim.step();
      expect(sim.discharge.ports[0].done).toBe(true);
      const sent=new Set(sim.handovers.map(h=>h.id));sim.settleElapsed(2);
      const length=sim.handovers.length;
      for(let i=0;i<900;i++)sim.step();
      expect(sim.handovers.slice(length).every(h=>!sent.has(h.id))).toBe(true);
      expect(sim.core.stats.duplicateExits).toBe(0);expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.conservationError()).toEqual(conserved);
    }finally{sim.dispose();}
  });
});
