import { describe, expect, it } from 'vitest';
import { Silo2D } from '../../src/physics/silo-2d';
import { createScenario } from '../../src/lab/scenario';
import { Simulation } from '../../src/lab/simulation';
import { deviceLayout, rawFeedRoute, rawFeedPosition, byproductPoint, cargoOffset } from '../../src/lab/device-layout';
import { localToWorld } from '../../src/core/frame';
import { BOARD_DISPLAY_SCALE } from '../../src/core/config';

const scenario=createScenario('empty'),dev=deviceLayout(scenario.board,scenario.tray),dt=1/60;
const advance=(s:Silo2D,seconds:number)=>{for(let i=0;i<seconds*60;i++)s.step(dt);};
describe('single-layer silo physics',()=>{
  it('new stock falls, collides and settles inside the closed funnel without being consumed',()=>{
    const silo=new Silo2D(dev.silo);silo.syncStock(100);silo.step(dt);
    const first=silo.bodies[0],start=first.y;advance(silo,.6);expect(first.y).toBeLessThan(start-.2);
    advance(silo,6);expect(silo.bodies).toHaveLength(100);expect(silo.pending).toBe(0);expect(silo.released).toBe(0);
    for(const b of silo.bodies){expect(b.y-b.radius).toBeGreaterThanOrEqual(dev.silo.throatY-1e-5);expect(Math.abs(b.x)+b.radius).toBeLessThanOrEqual(dev.silo.width/2-.179);expect(Number.isFinite(b.x+b.y+b.vx+b.vy)).toBe(true);}
    let overlap=0;
    for(let i=0;i<silo.bodies.length;i++)for(let j=i+1;j<silo.bodies.length;j++){
      const a=silo.bodies[i],b=silo.bodies[j];overlap=Math.max(overlap,a.radius+b.radius-Math.hypot(a.x-b.x,a.y-b.y));
    }
    expect(overlap).toBeLessThan(dev.silo.radius*.2);
  });
  it('opening the outlet removes one bottom unit and lets the supported pile descend',()=>{
    const silo=new Silo2D(dev.silo);silo.syncStock(120,true);advance(silo,3);
    const before=new Map(silo.bodies.map(b=>[b.id,b.y]));let removed=0,credit=0;
    for(let i=0;i<5*60;i++){silo.step(dt);credit=Math.min(1,credit+dt*3);if(credit>=1&&silo.takeAtOutlet()){removed++;credit=0;}}
    expect(removed).toBeGreaterThan(10);expect(silo.bodies).toHaveLength(120-removed);expect(silo.released).toBe(removed);
    expect(silo.bodies.some(b=>b.y<before.get(b.id)!-.15)).toBe(true);
    // Closing the gate holds the rest, including inventory above the visual capacity.
    const count=silo.bodies.length;advance(silo,2);expect(silo.bodies).toHaveLength(count);
  });
  it('a 700-unit pile keeps feeding when bottom circles initially straddle the throat edges',()=>{
    const silo=new Silo2D(dev.silo);silo.syncStock(700);let credit=0,removed=0;
    for(let i=0;i<45*60;i++) {
      silo.step(dt);credit=Math.min(1,credit+dt*3);
      if(credit>=1&&silo.takeAtOutlet()){removed++;credit=0;}
    }
    expect(removed).toBeGreaterThan(80);expect(silo.bodies.length+silo.pending+removed).toBe(700);
  });
  it('the scaled board keeps its physical handoff and a processor opening wider than its material path',async()=>{
    const sim=await Simulation.create(scenario);
    try{
      expect(sim.frame.scale).toBeCloseTo(BOARD_DISPLAY_SCALE,12);
      const left=localToWorld(sim.frame,0,0),right=localToWorld(sim.frame,scenario.board.width,0);
      expect(Math.hypot(right.x-left.x,right.y-left.y,right.z-left.z)).toBeCloseTo(scenario.tray.width,8);
      const route=rawFeedRoute(scenario.board,sim.frame,sim.device,2),end=rawFeedPosition(route,route.seconds);
      const mouth=localToWorld(sim.frame,2,-1.65,.3);
      for(const axis of ['x','y','z'] as const) expect(end[axis]).toBeCloseTo(mouth[axis],12);
      for(const side of [-1,1]){
        const p=byproductPoint(scenario.board,sim.frame,sim.device,0,side*(dev.passageWidth/2-.3));
        expect(Number.isFinite(p.x+p.y+p.z)).toBe(true);
      }
      // The unchanged-size coins must still fit between the narrowed tray walls.
      for(let i=0;i<24;i++) expect(Math.abs(cargoOffset(sim.device,i).x)+scenario.tray.tokenRadius).toBeLessThan(scenario.tray.width/2-.15);
      expect(dev.silo.depth).toBeLessThan(dev.silo.radius*4); // two layers physically cannot fit
    }finally{sim.dispose();}
  });
});
