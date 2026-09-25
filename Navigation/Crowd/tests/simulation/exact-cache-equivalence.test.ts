import { expect, it, vi } from 'vitest';
import { CrowdSimulation, DEFAULT_CONFIG } from '../../src/core/simulation';
import { FlowField } from '../../src/algorithms/flow-field/flow-field';
import { StaticFreeSpace } from '../../src/core/static-free-space';
import { getScenario } from '../../src/scenarios/scenarios';

it('matches JS state bytes with WASM/caches through mixed radii, forces and geometry/goal edits',()=>{
  const make=()=>new CrowdSimulation({...DEFAULT_CONFIG,agentCount:180,largeAgentPercent:20},getScenario('rocky-pass'));
  const a=make(),b=make();
  b.external.backend='js';
  for(let tick=0;tick<100;tick++) {
    for(const s of [a,b]) {
      if(tick===20)s.enqueueExternal({kind:'blast',id:'hit',tick,generation:s.external.generation,x:60,y:360,radius:100,speed:400});
      if(tick===50)s.setGoal(s.goal.x,s.goal.y+30);
      if(tick===70)s.updateObstacles([...s.scenario.obstacles,{x:1150,y:20,width:10,height:10}]);
    }
    a.step();
    if(tick===20)expect(a.external.stats.wasm).toBe(1);
    const contains=vi.spyOn(StaticFreeSpace.prototype,'contains').mockReturnValue(false);
    const proto=FlowField.prototype as unknown as {hasLineOfSight: (x:number,y:number,ex:number,ey:number)=>boolean;isSegmentSafe:(x:number,y:number,ex:number,ey:number)=>boolean};
    const los=vi.spyOn(proto,'hasLineOfSight').mockImplementation(function(this:typeof proto,...args){return this.isSegmentSafe(...args);});
    try {b.step();} finally {contains.mockRestore();los.mockRestore();}
    for(const [name,view] of Object.entries(a.state)) {
      if(!ArrayBuffer.isView(view))continue;
      const other=b.state[name as keyof typeof b.state] as ArrayBufferView;
      expect(Buffer.from(view.buffer,view.byteOffset,view.byteLength).equals(Buffer.from(other.buffer,other.byteOffset,other.byteLength)),`tick ${tick} ${name}`).toBe(true);
    }
    expect(a.external.affected).toEqual(b.external.affected);
    expect(a.stateHash()).toBe(b.stateHash());
  }
});
