import {describe,it,expect} from 'vitest';
import {Simulation} from '../../src/lab/simulation';
import {createScenario} from '../../src/lab/scenario';
import {trayGeometry} from '../../src/physics/tray-geometry';

describe('vertical feed onto the moving plate',()=>{
  it.each(['custom-stack','rapier3d-stacked'] as const)('%s: a production coin lands on the plate, leaves its shelf, then gets pushed forward',async pusher=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher};
    const sim=await Simulation.create(s),g=trayGeometry(s.tray);
    let id=0,landed=false,leftShelf=false,pushed=false,landZ=0;
    try {
      sim.addRaw(10);
      for(let tick=0;tick<3000 && !pushed;tick++) {
        sim.step();sim.sync();
        if(!id && sim.handovers.length) {
          const h=sim.handovers[0];id=h.id;
          expect(h.z).toBeCloseTo(sim.device.feedZ,9);expect(h.vz).toBe(0);
          expect(h.z).toBeLessThan(s.tray.faceMin+s.tray.stroke-s.tray.tokenRadius);
          expect(s.tray.faceMin+s.tray.stroke-h.z).toBeCloseTo(s.tray.pusherDepth/2,8);
        }
        for(let i=0;i<sim.pusherSnap.count;i++) {
          if(sim.pusherSnap.ids[i]!==id)continue;
          const y=sim.pusherSnap.c[i],z=sim.pusherSnap.b[i];
          if(!landed && Math.abs(y-(g.plateHeight+s.tray.tokenHalfHeight))<.12
            && z<sim.pusherFace && z>sim.pusherFace-s.tray.pusherDepth) {landed=true;landZ=z;}
          if(landed && y<g.plateHeight*.5)leftShelf=true;
          if(leftShelf && z>landZ+.7)pushed=true;
        }
      }
      expect(id).toBeGreaterThan(0);expect(landed).toBe(true);expect(leftShelf).toBe(true);expect(pushed).toBe(true);
      expect(sim.core.stats.seedPlaced).toBe(0);expect(sim.core.stats.lostTokens).toBe(0);
      expect(sim.core.conservationError()).toEqual({produced:0,seed:0,raw:0});
    }finally{sim.dispose();}
  });
});
