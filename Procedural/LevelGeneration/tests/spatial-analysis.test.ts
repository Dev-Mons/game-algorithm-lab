import {expect,it} from 'vitest';
import {spatialFixture} from './spatial-fixture';
import {spatialRelation,boundaryRuns,segmentOccluded} from '../src/core/spatial-analysis';
import {BoundsIndex} from '../src/core/reservations';
import {cellBox16} from '../src/core/placement-bounds';
import {box} from '../src/fixtures';
it('uses real concave masks for containment and cardinal contact rather than an AABB',()=>{
  const mask=box(4,1,4).filter(([x,,z])=>x<2||z<2),solid=new BoundsIndex<string>();
  const a={kind:'object' as const,id:'a'},b={kind:'parking' as const,id:'b'};
  expect(spatialRelation(a,[[3,0,3]],b,mask,solid)).toMatchObject({containedCellCount:0,planarDistanceCells:2});
  expect(spatialRelation(a,[[0,0,0]],b,[[1,0,1]],solid)?.contactLengthCells).toBe(0);
  expect(spatialRelation(a,[[0,0,0]],b,[[1,0,0]],solid)?.contactLengthCells).toBe(1);
  const runs=boundaryRuns(mask,b);expect(runs.reduce((n,r)=>n+r.lengthCells,0)).toBe(16);
});
it('reports occlusion separately from reachable detours and supercovers diagonal corner contacts',()=>{
  const solid=new BoundsIndex<string>();solid.add(cellBox16([1,0,0]),'wall');
  expect(segmentOccluded([0,0,0],[2,0,2],solid)).toBe(true);
  const fixture=spatialFixture([[2,0,1]],[[4,0,1]],[],box(5,1,3));
  expect(segmentOccluded([0,0,1],[3,0,1],fixture.solidIndex)).toBe(true);
  expect(fixture.search.query([0,0,1]).reachable).toBe(true);
});
it('keeps unresolved vegetation and facilities as input but only supported vegetation blocks access',()=>{
  const fixture=spatialFixture([],[[4,0,0]],[{id:'roof-tree',category:'vegetation',direction:'PY',cells:[[0,1,0]]},{id:'facility',category:'facility',direction:'PY',cells:[[2,0,0]]}]);
  expect(fixture.spatial.diagnostics.some(d=>d.ownerId==='roof-tree')).toBe(true);
  expect(fixture.spatial.staticReservations.some(r=>r.ownerId==='roof-tree'||r.ownerId==='facility')).toBe(false);
  expect(fixture.spatial.relations.some(r=>r.from.id==='facility'&&r.to.kind==='road')).toBe(true);
});
