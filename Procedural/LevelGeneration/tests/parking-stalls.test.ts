import {ENVIRONMENT} from '../src/core/environment-settings';
import {expect,it} from 'vitest';
import {parkingFixture} from '../src/parking-fixtures';
import {analyzeVolume} from '../src/core/regions';
import {analyzeSpatial} from '../src/core/spatial-analysis';
import {planParkingCirculation} from '../src/core/parking-circulation';
import {planParkingStalls,validateStallProof} from '../src/core/parking-stalls';
import {bodyBox16} from '../src/core/access-graph';
import {ParkingCharge} from '../src/core/parking-budget';
import {cellId} from '../src/core/analysis';
import {parkingPlacements} from '../src/core/parking-placement';
import {createParkingArrowGeometry} from '../src/parking-geometry';
it('protects stall proof work after circulation exhaustion and keeps unrelated slots when an entrance path reserves one',()=>{
  const document=parkingFixture('R12'),spatial=analyzeSpatial(document,analyzeVolume(document.grid,'region-context-v1'),[]),circulation=planParkingCirculation(document,spatial.spatial,spatial.book,spatial.solidIndex),plan=circulation.areas[0].components[0];
  const charge=new ParkingCharge(plan.budget);for(let i=0;i<plan.budget.circulationLimit;i++)charge.circulation();plan.counters.stateExpansions=charge.circulationUsed;
  const before=JSON.stringify(circulation.areas),first=planParkingStalls(document,circulation.areas,spatial.spatial,circulation.book.clone(),spatial.solidIndex),stalls=first[0].plans[0].stalls;
  expect(stalls.length).toBeGreaterThanOrEqual(8);expect(first[0].quality.stallUsed).toBeLessThanOrEqual(plan.budget.stallLimit);
  const book=circulation.book.clone(),target=stalls[0];
  expect(book.tryReserveBatch([{id:'entrance-path',ownerId:'building',sourceRefs:[],kind:'walk',priority:700,cells:[target.rear],boxes16:[bodyBox16(target.rear,ENVIRONMENT.access)]}]).accepted).toBe(true);
  const second=planParkingStalls(document,circulation.areas,spatial.spatial,book,spatial.solidIndex);
  expect(second[0].plans[0].stalls.map(s=>s.id)).toEqual(stalls.filter(s=>s.id!==target.id).map(s=>s.id));
  expect(second[0].quality.primaryRejectionCounts.RESERVED_ACCESS).toBe(1);expect(second[0].quality.unallocatedPrimaryReasonCounts.RESERVED_ACCESS).toBe(1);
  expect(JSON.stringify(circulation.areas)).toBe(before);
  const base=new Set([...document.sceneInputs.roads,...plan.aisleCells,...plan.gates.flatMap(g=>[...g.openingCells,...g.connectorCells])].map(cellId));
  for(const stall of stalls)expect(validateStallProof(stall,base)).toBeGreaterThan(0);
  const paint=parkingPlacements(first);expect(new Set(paint.map(p=>p.id)).size).toBe(paint.length);expect(paint.some(p=>p.asset==='parking.arrow')).toBe(true);
},30000);
it('the shared arrow has a forward silhouette and every vertex stays in its normalized bounds',()=>{
  const geometry=createParkingArrowGeometry(),p=geometry.getAttribute('position');
  for(let i=0;i<p.count;i++){expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(.5);expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(.5);expect(Math.abs(p.getZ(i))).toBeLessThanOrEqual(.5);}
  expect(p.count).toBeGreaterThan(24);geometry.dispose();
});
