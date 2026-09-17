import {VehicleDomain,DijkstraQueue} from '../src/core/vehicle-domain';
import {expect,it} from 'vitest';
import {vehicleTransitions,vehicleFootprint,validTransitions,stateKey,buildVehicleGraph,vehicleBFS} from '../src/core/vehicle-motion';
import {cellId} from '../src/core/analysis';
import {box} from '../src/fixtures';
it('all six moves contain both footprints and turns use the full 4x4 sweep',()=>{
  for(const heading of [0,1,2,3] as const){const start={rear:[0,0,0] as [number,number,number],heading};
    for(const t of vehicleTransitions(start)){
      const mask=new Set(t.sweep.map(cellId));expect([...vehicleFootprint(start),...vehicleFootprint(t.state)].every(c=>mask.has(cellId(c)))).toBe(true);
      if(t.move.includes('left')||t.move.includes('right'))expect(mask.size).toBe(16);
      expect(vehicleTransitions(t.state).some(reverse=>stateKey(reverse.state)===stateKey(start)&&reverse.sweep.map(cellId).sort().join('|')===t.sweep.map(cellId).sort().join('|'))).toBe(true);
      const obstacle=t.sweep.find(c=>!vehicleFootprint(start).some(p=>cellId(p)===cellId(c)))!;mask.delete(cellId(obstacle));
      expect(validTransitions(start,mask).some(edge=>edge.move===t.move)).toBe(false);
    }
  }
});
it('a point-connected narrow L does not grant a vehicle turn and a graph expands each state only once',()=>{
  const cells=[...box(1,1,6),...box(5,1,1).map(([x,y,z])=>[x+1,y,z+5] as [number,number,number])];
  let expanded=0;const graph=buildVehicleGraph(cells,()=>expanded++);expect(expanded).toBe(graph.states.length);
  const start=graph.index.get('0,0,0|0')!,end=graph.index.get('4,0,5|1')!,reach=vehicleBFS(graph,[start]);
  expect(reach.distance[end]).toBe(-1);
});

it('compiled search geometry has exactly the same graph as the footprint/sweep reference in concave and obstructed masks',()=>{
 const domainCells=box(8,1,8).map(([x,y,z])=>[x-4,y,z-3] as [number,number,number]),domain=new VehicleDomain(domainCells,4);
 for(const mask of [domainCells,domainCells.filter(([x,,z])=>x<0||z<0),domainCells.filter(([x,,z])=>x!==0||z!==0)]){
 let referenceCharges=0,compiledCharges=0;expect(domain.graph(mask,()=>compiledCharges++)).toEqual(buildVehicleGraph(mask,()=>referenceCharges++));expect(compiledCharges).toBe(referenceCharges);
 }
});

it('the integer Dijkstra queue decreases keys without duplicate entries and preserves cost/state ties',()=>{
 const costs=new Float64Array(257).fill(Infinity),queue=new DijkstraQueue(costs),pending=new Set<number>();
 for(let i=0;i<257;i++){costs[i]=20+(i*17%19);queue.push(i);pending.add(i);}
 for(let i=0;i<257;i+=3){costs[i]=10+(i%5);queue.push(i);}expect(queue.size).toBe(257);
 while(pending.size){const expected=[...pending].sort((a,b)=>costs[a]-costs[b]||a-b)[0];expect(queue.pop()).toBe(expected);pending.delete(expected);expect(queue.size).toBe(pending.size);}
});
