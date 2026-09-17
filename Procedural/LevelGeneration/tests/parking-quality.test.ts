import {afterAll,expect,it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {parkingFixture,PARKING_QUALITY_TARGETS,type ParkingFixtureId} from '../src/parking-fixtures';
import {generateDocument} from '../src/core/generate-document';
import {validateStallProof} from '../src/core/parking-stalls';
import {cellId} from '../src/core/analysis';
const records:unknown[]=[];
afterAll(()=>writeFileSync('benchmarks/parking-quality.json',JSON.stringify({policy:'parking-budget-v1',records},null,2)+'\n'));
it.each(Object.keys(PARKING_QUALITY_TARGETS) as (keyof typeof PARKING_QUALITY_TARGETS)[])('%s satisfies both useful capacity and aisle area bounds with complete vehicle proofs',id=>{
  const document=parkingFixture(id),result=generateDocument(document),area=result.environment!.parking![0],target=PARKING_QUALITY_TARGETS[id];
  records.push({id,input:document,quality:area.quality,components:area.plans.map(p=>({quality:p.quality,budget:p.circulation.budget,counters:p.counters,circulationCounters:p.circulation.counters,reasonCodes:p.circulation.reasonCodes}))});
  expect(area.quality.acceptedStalls,JSON.stringify(area.quality)).toBeGreaterThanOrEqual(target.minimum);
  expect(area.quality.aisleRatio).toBeLessThanOrEqual(target.aisleRatio);
  expect(area.quality.untestedStalls).toBe(0);
  if(id==='D12')for(const plan of area.plans){expect(plan.stalls.length).toBeGreaterThanOrEqual(8);expect(plan.quality.aisleRatio).toBeLessThanOrEqual(.65);}
  for(const plan of area.plans){
    const baseMask=new Set([...document.sceneInputs.roads,...plan.circulation.aisleCells,...plan.circulation.gates.flatMap(g=>[...g.openingCells,...g.connectorCells])].map(cellId));
    for(const stall of plan.stalls)expect(validateStallProof(stall,baseMask)).toBeGreaterThan(0);
    expect(plan.counters.graphBuilds).toBe(1);expect(plan.counters.bfsPasses).toBe(2);expect(plan.counters.maxLocalStates).toBeLessThanOrEqual(16);
    expect(plan.quality.stallUsed).toBeLessThanOrEqual(plan.quality.stallReserved);
    expect(plan.quality.eligibleCells).toBe(plan.quality.vehicleCellsInArea+plan.quality.walkOnlyCellsInArea+plan.quality.stallCells+plan.quality.unallocatedCells);
    expect(plan.quality.potentialStalls).toBe(plan.quality.acceptedStalls+Object.values(plan.quality.primaryRejectionCounts).reduce((n,v)=>n+v,0));
  }
},60000);
it('a no-road negative control has zero stalls with an explicit gate failure',()=>{
  const document=parkingFixture('R12');document.sceneInputs.roads=[];const result=generateDocument(document),area=result.environment!.parking![0];
  records.push({id:'R12-no-road',quality:area.quality,reasonCodes:area.plans[0].reasonCodes,circulationReasons:area.plans[0].circulation.reasonCodes});
  expect(area.quality.acceptedStalls).toBe(0);expect(area.plans[0].circulation.reasonCodes).toContain('NO_ROAD_GATE');expect(area.quality.unallocatedCells).toBe(144);
});
