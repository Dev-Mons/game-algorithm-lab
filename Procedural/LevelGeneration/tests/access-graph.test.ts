import {expect,it} from 'vitest';
import {spatialFixture} from './spatial-fixture';
import {AccessSearch,bodyBox16,walkSweep16,authorizeCrossing} from '../src/core/access-graph';
import {cellId,type Vec3} from '../src/core/analysis';
import {box} from '../src/fixtures';
import {cellBox16} from '../src/core/placement-bounds';

it('uses a deterministic actual detour, fails when enclosed, and counts edges rather than straight distance',()=>{
  const wall=box(5,1,5).map(([x,y,z])=>[x+1,y,z+1] as Vec3).filter(([x,,z])=>x===1||x===5||z===1||z===5);
  const road=Array.from({length:8},(_,z)=>[8,0,z] as Vec3),open=wall.filter(c=>cellId(c)!=='5,0,4');
  const fixture=spatialFixture(open,road),a=fixture.search.query([3,0,3]);
  expect(a.reachable).toBe(true);expect(a.distanceCells).toBe(a.path.length-1);expect(a.distanceCells).toBeGreaterThan(4);
  expect(spatialFixture([...open].reverse(),[...road].reverse()).search.query([3,0,3])).toEqual(a);
  expect(fixture.search.query([3,0,3],2).reasonCodes).toEqual(['PATH_TOO_LONG']);
  expect(spatialFixture(wall,road).search.query([3,0,3])).toMatchObject({reachable:false,reasonCodes:['NO_REACHABLE_ROAD']});
  for(let i=1;i<a.path.length;i++){const p=a.path[i-1],q=a.path[i];expect(Math.abs(p[0]-q[0])+Math.abs(p[2]-q[2])).toBe(1);expect(fixture.solidIndex.query(walkSweep16(p,q,fixture.document.environment.access))).toEqual([]);}
});
it('never connects height changes, merges duplicate ground support, and excludes median arrivals',()=>{
  const roof=spatialFixture([[0,0,0]],[[2,0,0]]);
  expect(roof.search.query([0,1,0]).reasonCodes).toEqual(['HEIGHT_DISCONNECTED']);
  expect(roof.spatial.walkEdges.every(([a,b])=>a.split(',')[1]===b.split(',')[1])).toBe(true);
  const buried=spatialFixture([[0,-1,0]],[[2,0,0]]);
  expect(buried.spatial.walkNodes.filter(n=>n.id==='0,0,0')).toHaveLength(1);
  expect(buried.spatial.walkNodes.find(n=>n.id==='0,0,0')?.support).toBe('ground');
  const median=spatialFixture([],[[0,0,0],[2,0,0]]);
  expect(median.spatial.roadArrivals.some(a=>a.nodeId==='1,0,0')).toBe(false);
  expect(median.spatial.walkNodes.some(n=>n.id==='0,0,0')).toBe(false);
});
it('keeps a one-cell passage open with relief and refuses a fixture in the protected path',()=>{
  const walls=[...box(1,1,5),...box(1,1,5).map(([x,y,z])=>[x+2,y,z] as Vec3)];
  const f=spatialFixture(walls,[[1,0,6]]);
  f.solidIndex.add({min:[16,0,0],max:[18,16,80]},'relief');
  expect(f.solidIndex.query(bodyBox16([1,0,2],f.document.environment.access))).toEqual([]);
  const path=f.search.query([1,0,2]);expect(path.reachable).toBe(true);
  expect(f.book.tryReserveBatch([{id:'path',ownerId:'door',sourceRefs:[],kind:'walk',priority:700,cells:path.path,boxes16:path.path.map(c=>bodyBox16(c,f.document.environment.access))}]).accepted).toBe(true);
  expect(f.book.tryReserveBatch([{id:'fixture',ownerId:'object',sourceRefs:[],kind:'fixture',priority:300,cells:[[1,0,2]],boxes16:[cellBox16([1,0,2])]}]).accepted).toBe(false);
});
it('handles absent roads, empty scenes and bounded coordinate-limit halos',()=>{
  expect(spatialFixture([],[]).search.query([0,0,0]).reasonCodes).toEqual(['NO_ROAD']);
  const f=spatialFixture([],[[1000000,0,1000000]]);
  expect(f.spatial.diagnostics.map(d=>d.code)).toContain('ANALYSIS_BOUNDARY_LIMIT');
  expect(f.spatial.walkNodes.every(n=>Math.abs(n.foot[0])<=1000000&&Math.abs(n.foot[2])<=1000000)).toBe(true);
});
it('certifies a crossing only with supported walk ends, vehicle states, complete mask and solid clearance',()=>{
  const roads=Array.from({length:7},(_,z)=>[0,0,z-3] as Vec3),f=spatialFixture([],roads);
  const request={id:'cross',cells:[[0,0,0]] as Vec3[],walkEndpoints:[[-1,0,0],[1,0,0]] as [Vec3,Vec3],vehicleEndpoints:[{rear:[0,0,-1] as Vec3,heading:0 as const},{rear:[0,0,1] as Vec3,heading:0 as const}] as const,vehicleCells:roads,intersectionKeepout:[]};
  expect(authorizeCrossing({...request,vehicleEndpoints:[...request.vehicleEndpoints]},f.search)).toBeDefined();
  const crossed=new AccessSearch(f.spatial,f.document,f.book,f.solidIndex);
  expect(crossed.nodes.has('0,0,0')).toBe(true);
  expect(crossed.neighbors.get('0,0,0')).toContain('-1,0,0');
  const other=spatialFixture([],roads);
  expect(authorizeCrossing({...request,vehicleEndpoints:[...request.vehicleEndpoints],intersectionKeepout:[[0,0,0]]},other.search)).toBeUndefined();
  expect(other.book.crossingSnapshot()).toEqual([]);
});
