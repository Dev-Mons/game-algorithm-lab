import {expect,it} from 'vitest';
import {box} from '../src/fixtures';
import {parkingFixture} from '../src/parking-fixtures';
import {createDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {add,cellId,type Vec3} from '../src/core/analysis';
import {HEADING_VECTORS} from '../src/core/environment-contract';
import {validateStallProof} from '../src/core/parking-stalls';
import {boxesOverlap,cellBox16} from '../src/core/placement-bounds';
import {analyzeVolume} from '../src/core/regions';
import {analyzeSpatial} from '../src/core/spatial-analysis';
import {planParkingCirculation} from '../src/core/parking-circulation';
import {planParkingStalls} from '../src/core/parking-stalls';
import {AccessSearch} from '../src/core/access-graph';

const rect=(w:number,d:number,x=0,z=0)=>box(w,1,d).map(c=>add(c,[x,0,z]));
const lot=(cells:Vec3[],width:number)=>createDocument([],42,'office',undefined,undefined,{version:2,objects:[],roads:rect(width,4,0,-4),parkingAreas:[{id:'lot',anchor:[0,0,0],cells}]});
const hole=parkingFixture('R12');hole.sceneInputs.parkingAreas[0].cells=hole.sceneInputs.parkingAreas[0].cells.filter(c=>cellId(c)!=='5,0,5');
const cases=[
  {name:'one-cell hole',document:hole,minimum:17},
  {name:'L-shaped wings',document:parkingFixture('L16'),minimum:26},
  {name:'U-shaped wings',document:lot(rect(16,16).filter(([x,,z])=>x<6||x>=10||z<6),16),minimum:27},
  {name:'single-loaded narrow row',document:lot(rect(6,16),6),minimum:13},
  {name:'two rooms with a neck too narrow for a car corridor',document:lot([...rect(10,12),...rect(10,12,14),...rect(4,2,10,5)],24),minimum:32},
];
it.each(cases)('$name uses local rows with independently valid vehicle and pedestrian access',({name,document,minimum})=>{
  const before=JSON.stringify(document),spatial=analyzeSpatial(document,analyzeVolume(document.grid,'region-context-v1'),[]);
  const circulation=planParkingCirculation(document,spatial.spatial,spatial.book,spatial.solidIndex);
  const book=circulation.book.clone(),areas=planParkingStalls(document,circulation.areas,spatial.spatial,book,spatial.solidIndex,circulation.domains);
  expect(areas[0].quality.acceptedStalls).toBeGreaterThanOrEqual(minimum);
  const pedestrian=new AccessSearch(spatial.spatial,document,book,spatial.solidIndex);
  for(const plan of areas[0].plans){
    const c=plan.circulation,own=new Set(c.eligibleCells.map(cellId)),base=new Set([...document.sceneInputs.roads,...c.aisleCells,...c.gates.flatMap(g=>[...g.openingCells,...g.connectorCells])].map(cellId));
    for(const stall of plan.stalls){
      expect(stall.cells.every(p=>own.has(cellId(p)))).toBe(true);
      expect(validateStallProof(stall,base)).toBeGreaterThan(0);
      // Check after every other bay and island has been occupied.
      expect(pedestrian.reachable(stall.walkAccessCell,100000)).toBe(true);
    }
    const gates=new Set(c.gates.flatMap(g=>g.openingCells.map(cellId))),roads=new Set(document.sceneInputs.roads.map(cellId));
    for(const cell of c.aisleCells.filter(p=>own.has(cellId(p))))if(HEADING_VECTORS.some(d=>roads.has(cellId(add(cell,d)))))expect(gates.has(cellId(cell))).toBe(true);
    for(const island of plan.islands)for(const cell of island.cells){
      expect(own.has(cellId(cell))).toBe(true);
      expect([...c.aisleCells,...c.walkCells,...plan.stalls.flatMap(s=>s.cells)].some(p=>boxesOverlap(cellBox16(cell),cellBox16(p)))).toBe(false);
    }
    expect(c.search.provenStalls).toBe(plan.stalls.length);
    expect(c.search.evaluated+c.search.pruned+c.search.untried).toBe(c.search.layoutDescriptors);
    expect(c.counters.stateExpansions).toBeLessThanOrEqual(c.budget.circulationLimit);
    expect(c.counters.layoutCandidates).toBeLessThanOrEqual(c.budget.layoutTickets);
    expect(plan.quality.stallUsed).toBeLessThanOrEqual(plan.quality.stallReserved);
  }
  if(name==='L-shaped wings')expect(new Set(areas[0].plans[0].stalls.map(s=>s.heading%2)).size).toBe(2);
  if(name.startsWith('two rooms')){
    expect(areas[0].quality.gateCount).toBe(2);
    expect(areas[0].plans[0].stalls.some(s=>s.rear[0]>=14)).toBe(true);
  }
  expect(JSON.stringify(document)).toBe(before);
});

it('does not invent an external pedestrian strip through neighboring solid objects',()=>{
  const document=lot(rect(6,16),6);
  document.sceneInputs.objects=[-1,6].map(x=>({id:`wall-${x}`,category:'vegetation' as const,direction:'PY' as const,cells:rect(1,16,x)}));
  const area=generateDocument(document,{cache:false}).environment!.parking![0];
  const blocked=new Set(document.sceneInputs.objects.flatMap(o=>o.cells.map(cellId)));
  for(const plan of area.plans){expect(plan.circulation.walkCells.every(c=>!blocked.has(cellId(c)))).toBe(true);expect(plan.stalls.every(s=>!blocked.has(cellId(s.walkAccessCell)))).toBe(true);}
  expect(area.quality.acceptedStalls).toBeLessThan(13);
});

it('keeps the chosen layout and proofs stable when source cell order is reversed',()=>{
  const document=cases[1].document,reversed=structuredClone(document);
  reversed.sceneInputs.parkingAreas[0].cells.reverse();reversed.sceneInputs.roads.reverse();
  const read=(d:typeof document)=>generateDocument(d,{cache:false}).environment!.parking!.map(a=>a.plans.map(p=>({layout:p.circulation.layoutId,stalls:p.stalls,islands:p.islands,walk:p.circulation.walkCells})));
  expect(read(reversed)).toEqual(read(document));
});
