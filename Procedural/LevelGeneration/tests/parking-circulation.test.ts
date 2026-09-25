import {expect,it} from 'vitest';
import {spatialFixture} from './spatial-fixture';
import {planParkingCirculation} from '../src/core/parking-circulation';
import {box} from '../src/fixtures';
import {cellId,type Vec3} from '../src/core/analysis';
const road=(w:number)=>box(w,1,4).map(([x,y,z])=>[x,y,z-4] as Vec3);
it('R12 has a proven gate, immutable aisle, connected walk and protected stall allocation',()=>{
  const f=spatialFixture([],road(12),[],box(12,1,12)),before=JSON.stringify(f.document);
  const result=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex),plan=result.areas[0].components[0];
  expect(plan.status,JSON.stringify({reasons:plan.reasonCodes,counters:plan.counters,candidates:plan.traces[0]?.candidates.slice(0,5)})).not.toBe('unplannable');
  expect(plan.gates.length).toBeGreaterThan(0);expect(plan.reachableStates.length).toBeGreaterThan(0);expect(plan.walkCells.length).toBeGreaterThan(0);expect(plan.bayStrips.length).toBeGreaterThan(0);
  expect(plan.budget.stallLimit).toBe(plan.budget.stallStateUpperBound);expect(plan.counters.stateExpansions).toBeLessThanOrEqual(plan.budget.circulationLimit);expect(plan.counters.layoutCandidates).toBeLessThanOrEqual(128);
  expect(JSON.stringify(f.document)).toBe(before);
});
it('keeps disconnected no-road masks as diagnosed inputs, without a fake gate or budget pool multiplication',()=>{
  const cells=[...box(12,1,12),...box(12,1,12).map(([x,y,z])=>[x+16,y,z] as Vec3)];
  const f=spatialFixture([],road(12),[],cells),result=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex),area=result.areas[0];
  expect(area.components).toHaveLength(2);expect(area.components[1].reasonCodes).toContain('NO_ROAD_GATE');expect(area.components[1].gates).toEqual([]);
  expect(area.ledger.allocations.reduce((n,a)=>n+a.layoutTickets,0)).toBeLessThanOrEqual(128);
});
it('plans two positive disconnected components with unique reservations under one budget',()=>{
  const cells=[...box(12,1,12),...box(12,1,12).map(([x,y,z])=>[x+16,y,z] as Vec3)],f=spatialFixture([],road(28),[],cells);
  const result=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex),area=result.areas[0];
  expect(area.components.every(p=>p.gates.length>0)).toBe(true);
  expect(area.components.reduce((n,p)=>n+p.counters.layoutCandidates,0)).toBeLessThanOrEqual(128);
  const reservations=result.book.snapshot();expect(new Set(reservations.map(r=>r.id)).size).toBe(reservations.length);
});
it('allows a two-cell straight connector only within the configured reach and rejects a solid barrier',()=>{
  const roads=road(12).map(([x,y,z])=>[x,y,z-2] as Vec3),cells=box(12,1,12),f=spatialFixture([],roads,[],cells);
  const yes=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex).areas[0].components[0];expect(yes.gates.length).toBeGreaterThan(0);expect(yes.gates[0].connectorCells.length).toBe(8);
  const short=spatialFixture([],road(12).map(([x,y,z])=>[x,y,z-5] as Vec3),[],cells);
  expect(planParkingCirculation(short.document,short.spatial,short.book,short.solidIndex).areas[0].components[0].reasonCodes).toContain('NO_ROAD_GATE');
  const blocked=spatialFixture(box(12,1,1).map(([x,y])=>[x,y,-2] as Vec3),roads,[],cells);
  expect(planParkingCirculation(blocked.document,blocked.spatial,blocked.book,blocked.solidIndex).areas[0].components[0].gates).toEqual([]);
});

it('only skips proofs when the geometric bay upper bound is strictly below a fully validated layout',()=>{
 const f=spatialFixture([],road(30),[],box(30,1,20)),area=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex).areas[0],p=area.components[0],skipped=p.traces[0].candidates.filter(c=>c.reasonCodes.includes('PROVEN_POTENTIAL_DOMINATED'));
 expect(skipped.length).toBeGreaterThan(0);for(const c of skipped){expect(c.metrics.potentialUpperBound).toBeLessThan(c.metrics.provenBestPotential as number);expect(c.metrics.provenBestPotential).toBeLessThanOrEqual(p.bayStrips.length);}
 expect(p.counters.layoutTrialsCompleted+p.counters.layoutTrialsAborted).toBe(p.counters.layoutCandidates);expect(p.search.evaluated+skipped.length+p.search.untried).toBe(p.counters.rawLayoutDescriptors);
});

it('evaluates each second gate against the unchanged primary and never accumulates a third gate',()=>{
 const roads=[...road(30),...road(30).map(([x,y,z])=>[x,y,z+24] as Vec3)],f=spatialFixture([],roads,[],box(30,1,20));
 const result=planParkingCirculation(f.document,f.spatial,f.book,f.solidIndex).areas[0].components[0];
 expect(result.gates.length).toBeGreaterThanOrEqual(1);expect(result.gates.length).toBeLessThanOrEqual(2);expect(result.counters.layoutCandidates).toBeLessThanOrEqual(result.budget.layoutTickets);expect(result.counters.stateExpansions).toBeLessThanOrEqual(result.budget.circulationLimit);
 const secondary=result.traces[0].candidates.filter(c=>c.candidateId.startsWith('secondary:'));expect(secondary.length).toBeGreaterThan(0);for(const c of secondary.filter(c=>c.accepted))expect(c.metrics.exitImprovement).toBeGreaterThanOrEqual(4);
 expect(result.traces[0].selectedIds.filter(id=>id.startsWith('secondary:'))).toHaveLength(result.gates.length-1);
 for(const c of secondary.filter(c=>c.accepted))expect(c.metrics.provenStalls).toBeGreaterThanOrEqual(c.metrics.primaryProvenStalls as number);
 if(result.gates.length===1)expect(secondary.some(c=>c.reasonCodes.includes('SECOND_GATE_REDUCES_CAPACITY'))).toBe(true);
});
