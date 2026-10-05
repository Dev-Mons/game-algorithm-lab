import {describe,it,expect} from 'vitest';
import {Simulation} from '../../src/lab/simulation';
import {createScenario} from '../../src/lab/scenario';
import {coinTransferPoint,deviceLayout,scrapTransferPoint,PROCESS_FRACTION,SCRAP_BELT_SECONDS} from '../../src/lab/device-layout';

describe('left press and compact horizontal process line',()=>{
  it('keeps the press outside the playfield and all 24 coin routes supported above the tray guards',()=>{
    const s=createScenario('empty'),d=deviceLayout(s.board,s.tray);
    expect(d.scrap.x+d.pressHalfWidth).toBeLessThan(-s.tray.width/2);
    expect(d.pressIn.y-d.coinRail.y).toBeLessThan(1.5);
    for(let i=0;i<24;i++) {
      const a=coinTransferPoint(d,i,0),end=coinTransferPoint(d,i,1);
      expect(Math.abs(a.x-d.scrap.x)+s.tray.tokenRadius).toBeLessThan(d.pressHalfWidth);
      expect(Math.abs(end.x)+s.tray.tokenRadius).toBeLessThan(s.tray.width/2);
      let before=a;
      for(let step=1;step<=1000;step++) {
        const p=coinTransferPoint(d,i,step/1000);
        expect(Math.hypot(p.x-before.x,p.y-before.y,p.z-before.z)).toBeLessThan(.07);
        expect(p.y+s.tray.tokenHalfHeight).toBeLessThan(d.scrapBelt.y-.15);
        expect(p.y).toBeGreaterThanOrEqual(d.outletY);
        before=p;
      }
    }
    for(const u of [.02,.5,.98])for(let step=0;step<=60;step++) {
      const p=scrapTransferPoint(d,u,0,step/100);
      expect(p.x).toBeGreaterThanOrEqual(d.scrapBelt.left);
      expect(p.x).toBeLessThanOrEqual(d.scrapBelt.right);
      expect(p.y).toBeCloseTo(d.scrapBelt.y+.2);
      expect(Math.abs(p.z-d.scrapBelt.z)+.18).toBeLessThan(d.scrapBelt.depth/2);
    }
  });
  it('holds moving scrap in transit and preserves value through the left lift and four-lane deck',async()=>{
    const s=createScenario('empty');s.backends={plinko:'custom',pusher:'custom-stack'};
    const sim=await Simulation.create(s);
    try {
      sim.addRaw(30);
      for(let i=0;i<1500 && !sim.core.chute.length;i++)sim.step();
      const packet=sim.core.chute.peek()!;
      expect(packet.arriveAt-packet.leftAt).toBeCloseTo(s.flow.chuteSeconds+SCRAP_BELT_SECONDS);
      while(sim.core.time<packet.leftAt+(packet.arriveAt-packet.leftAt)*PROCESS_FRACTION)sim.step();
      expect(sim.core.compressorBuffer).toBe(0);expect(sim.core.stats.tokensMade).toBe(0);
      for(let step=0;step<2600 && sim.gateStats.fed<24;step++) {
        sim.step();
        const moving=sim.feedDisplay();
        for(let i=0;i<moving.length;i++)for(let j=i+1;j<moving.length;j++) {
          const a=sim.diePosition(moving[i].slot),b=sim.diePosition(moving[j].slot);
          if(Math.abs(a.y-b.y)<2*s.tray.tokenHalfHeight+.015)
            expect(Math.hypot(a.x-b.x,a.z-b.z)).toBeGreaterThanOrEqual(2*s.tray.tokenRadius+.025);
        }
      }
      expect(sim.gateStats.fed).toBeGreaterThanOrEqual(24);
      expect(sim.core.stats.lostTokens).toBe(0);expect(sim.core.stats.duplicateExits).toBe(0);
      expect(sim.core.conservationError()).toEqual({produced:0,seed:0,raw:0});
    }finally{sim.dispose();}
  });
});
