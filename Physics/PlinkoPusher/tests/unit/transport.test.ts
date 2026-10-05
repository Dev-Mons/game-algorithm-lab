import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/lab/simulation';
import { createScenario } from '../../src/lab/scenario';
import { byproductPoint, cargoOffset, coinTransferPoint, coinExitVelocity, COIN_TRANSFER_SECONDS, DIE_OPEN_FRACTION, PROCESSOR_EXIT_V, POCKET_COUNT, POCKET_WALL_HALF, outletCenter, RAW_ENTRY_V } from '../../src/lab/device-layout';
import { PLACEMENTS, type PlacementId } from '../../src/core/frame';
import { BodySnapshot, type TokenSpawn } from '../../src/physics/contracts';

const advance = (sim: Simulation, seconds: number) => { for (let i = 0; i < seconds * 60; i++) sim.step(); sim.sync(); };

describe('connected material transport', () => {
  it.each(['custom', 'rapier2d'] as const)('%s: the same raw body falls from inside the hopper through the open board inlet', async plinko => {
    const s = createScenario('empty'); s.backends = { plinko, pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      sim.addRaw(1);
      for (let i=0;i<1200 && sim.core.items.size===0;i++) sim.step();
      sim.sync();
      expect(sim.plinkoSnap.count).toBe(1);
      const id = sim.plinkoSnap.ids[0];
      expect(sim.plinkoSnap.b[0]).toBeGreaterThan(RAW_ENTRY_V);
      expect(sim.plinkoSnap.b[0]).toBeLessThan(0);
      advance(sim, 0.5);
      expect(sim.plinkoSnap.ids[0]).toBe(id);
      expect(sim.plinkoSnap.b[0]).toBeGreaterThan(0);
      expect(sim.core.stats.lostItems).toBe(0);
    } finally { sim.dispose(); }
  });

  it('loads, stamps, retracts, then releases value-one coins directly from the die pose', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'rapier2d', pusher: 'rapier3d-stacked' };
    const sim = await Simulation.create(s);
    try {
      const spawns: TokenSpawn[] = [], spawn = sim.pusher.spawn.bind(sim.pusher), phases = new Set<string>();
      sim.pusher.spawn = t => {
        expect(sim.core.pressPhase).toBe('ready');
        expect(sim.discharge.progress).toBe(1);
        const index = sim.feedSlots.get(t.id)!;
        const displayed = sim.diePosition(index);
        expect(t.x).toBeCloseTo(displayed.x, 8); expect(t.y).toBeCloseTo(displayed.y, 8);
        expect(t.z).toBeCloseTo(displayed.z - sim.device.trayZ0, 8); expect(t.vy).toBeCloseTo(coinExitVelocity(sim.device).y,8); expect(t.vz).toBeCloseTo(coinExitVelocity(sim.device).z,8);
        const previous=coinTransferPoint(sim.device,index,1-.001/COIN_TRANSFER_SECONDS);
        expect((displayed.y-previous.y)/.001).toBeCloseTo(t.vy!,6); expect((displayed.z-previous.z)/.001).toBeCloseTo(t.vz!,6);
        spawns.push({ ...t }); spawn(t);
      };
      sim.addRaw(20);
      for (let i = 0; i < 60 * 35; i++) { sim.step(); phases.add(sim.core.pressPhase); }
      expect([...phases]).toEqual(expect.arrayContaining(['loading', 'pressing', 'retracting', 'ready', 'releasing']));
      expect(spawns.length).toBeGreaterThan(12); expect(sim.batchStats.largestDump).toBeGreaterThanOrEqual(6);
      expect(sim.core.stats.seedPlaced).toBe(0); expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  }, 30000);

  it('a tall real pile holds coins in the fixed die and blocks the next stamp until clear', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      const x = cargoOffset(sim.device, 0).x;
      for (const [i, token] of sim.core.placeSeed(26).entries()) sim.pusher.spawn({ id: token.id, x, y: 0.9 + s.tray.tokenHalfHeight + i * 2 * s.tray.tokenHalfHeight, z: sim.device.feedZ, radius: s.tray.tokenRadius, halfHeight: s.tray.tokenHalfHeight });
      const step = sim.pusher.step.bind(sim.pusher); sim.pusher.step = () => {};
      sim.addRaw(24); advance(sim, 35);
      expect(sim.discharge.blocked).toBe(true); expect(sim.core.pressPhase).toBe('ready');
      const held = sim.diePosition(0), made = sim.core.stats.tokensMade;
      advance(sim, 1); expect(sim.diePosition(0)).toEqual(held); expect(sim.core.stats.tokensMade).toBe(made);
      expect(sim.gateStats.fed).toBeGreaterThan(0);
      expect(sim.handovers.every(h=>h.port!==0)).toBe(true);expect(sim.discharge.ports[0].blocked).toBe(true);
      expect(sim.core.compressorBuffer).toBeGreaterThan(0);
      expect(sim.core.ledger.main).toBeGreaterThan(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
      for (const id of [...sim.core.tray.keys()]) { sim.pusher.remove(id); sim.core.onTokenLost(id); }
      sim.pusher.step = step; advance(sim, 5);
      expect(sim.handovers.some(h=>h.port===0)).toBe(true);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  });

  it('hidden settlement resets the discharge guide and normal pressing resumes', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      sim.addRaw(20);
      for (let i = 0; i < 1800 && sim.discharge.progress === 0; i++) sim.step();
      expect(sim.discharge.progress).toBeGreaterThan(0);
      const fed = sim.gateStats.fed;
      sim.settleElapsed(90); expect(sim.discharge.progress).toBe(0);
      sim.addRaw(20); advance(sim, 35);
      expect(sim.gateStats.fed).toBeGreaterThan(fed);
      expect(sim.core.stats.duplicateExits).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  });

  it('all board placements keep the receiving manifold above the left-running scrap conveyor', async () => {
    const s = createScenario('empty'); s.backends = { plinko: 'custom', pusher: 'custom-stack' };
    const sim = await Simulation.create(s);
    try {
      for (const id of Object.keys(PLACEMENTS) as PlacementId[]) {
        sim.setPlacement(id);
        for (const col of [0, sim.device.cargoColumns - 1]) {
          const offset = cargoOffset(sim.device, col).x;
          const top = byproductPoint(s.board, sim.frame, sim.device, 0, offset);
          const bottom = byproductPoint(s.board, sim.frame, sim.device, 1, offset);
          expect(top.y).toBeGreaterThan(bottom.y + 0.2);
          expect(bottom.y).toBeGreaterThan(sim.device.scrapBelt.y + 0.2);
          expect(Math.abs(offset) + s.tray.tokenRadius).toBeLessThan(sim.device.passageWidth / 2);
        }
      }
    } finally { sim.dispose(); }
  });
  it.each(['custom-stack', 'rapier3d-stacked', 'rapier3d-planar', 'custom'] as const)('%s: normal production from empty reaches a paid exit without recovery or seed tokens', async pusher => {
    const s = createScenario('basic'); s.initialTokens = 0; s.backends = { plinko: 'rapier2d', pusher };
    const sim = await Simulation.create(s);
    try {
      for (let i = 0; i < 600 * 60 && sim.core.ledger.bonusProduced === 0; i++) sim.step();
      expect(sim.core.ledger.bonusProduced).toBeGreaterThan(0);
      expect(sim.core.stats.seedPlaced).toBe(0); expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.stats.duplicateArrivals + sim.core.stats.duplicateExits).toBe(0);
      expect(sim.core.conservationError()).toEqual({ produced: 0, seed: 0, raw: 0 });
    } finally { sim.dispose(); }
  }, 30000);

  it.each(['custom','rapier2d'] as const)('%s: receiving partitions stop lateral crossing until the body exits the pocket bottom',async plinko=>{
    const s=createScenario('empty');s.backends={plinko,pusher:'custom-stack'};
    const sim=await Simulation.create(s),snap=new BodySnapshot(8),wall=s.board.width/POCKET_COUNT;
    try {
      sim.plinko.spawn({id:101,u:wall-s.board.itemRadius-.09,v:s.board.height+1.1,vu:4,vv:1,radius:s.board.itemRadius});
      let exited=false;
      for(let i=0;i<120 && !exited;i++) {
        sim.plinko.step(1/60);sim.plinko.snapshot(snap);
        // Engine contacts may briefly overlap by a fraction of the radius; crossing into the next lane is forbidden.
        if(snap.count)expect(snap.a[0]+s.board.itemRadius).toBeLessThanOrEqual(wall-POCKET_WALL_HALF+s.board.itemRadius/6);
        const events: Parameters<typeof sim.plinko.drainEvents>[0]=[];sim.plinko.drainEvents(events);
        for(const event of events)if(event.type==='arrive') {exited=true;expect(event.v).toBeGreaterThanOrEqual(s.board.height+PROCESSOR_EXIT_V);expect(event.u).toBeLessThan(wall);}
      }
      expect(exited).toBe(true);
    }finally{sim.dispose();}
  });
  it('all 24 coins clear their four outlet walls and a blocked midway batch resumes from the held pose',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      expect(coinTransferPoint(sim.device,0,DIE_OPEN_FRACTION)).toEqual(coinTransferPoint(sim.device,0,0));
      for(let i=0;i<24;i++) {
        const x=coinTransferPoint(sim.device,i,1).x;
        const closest=Math.min(...Array.from({length:4},(_,gate)=>Math.abs(x-outletCenter(sim.device,gate))));
        expect(closest+s.tray.tokenRadius).toBeLessThan(sim.device.outletWidth/2);
      }
      sim.addRaw(20);
      for(let i=0;i<2400 && sim.discharge.progress<.5;i++)sim.step();
      expect(sim.discharge.progress).toBeGreaterThan(.4);
      const pose=sim.diePosition(0),fed=sim.gateStats.fed,made=sim.core.stats.tokensMade;
      s.flow.trayMaxTokens=0;advance(sim,2);
      expect(sim.diePosition(0)).toEqual(pose);expect(sim.gateStats.fed).toBe(fed);expect(sim.core.stats.tokensMade).toBe(made);
      s.flow.trayMaxTokens=1500;advance(sim,COIN_TRANSFER_SECONDS+s.tray.period);
      expect(sim.gateStats.fed).toBeGreaterThan(fed);expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.conservationError()).toEqual({produced:0,seed:0,raw:0});
    }finally{sim.dispose();}
  });

});
