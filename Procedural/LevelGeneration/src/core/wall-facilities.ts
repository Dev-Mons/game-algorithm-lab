import {add,BASES,cellId,faceCenter2,type Surface,type Vec3} from './analysis';
import type {GenerationDocument} from './document';
import type {DecisionTrace,Reservation,Heading} from './environment-contract';
import type {ObjectInput,ScenePlacement} from './scene-inputs';
import type {VerticalPlan} from './vertical-design';
import {faceBounds16,cellBox16,containedInUnion,scenePlacementBounds16} from './placement-bounds';
import {ReservationBook} from './reservations';
import {WALL_FACILITY_ASSETS,type FacilityPart} from './wall-facility-assets';
export interface WallFacilityPlan {
  placements:ScenePlacement[];reservations:Reservation[];traces:DecisionTrace[];
  changes:{faceId:string;moduleId:'wall';objectId:string}[];
  groups:{objectId:string;faceIds:string[];assetKeys:string[];zoneIds:string[];accepted:boolean;reason:string}[];
}
export function automaticFacilityKind(input: ObjectInput): 'balcony'|'fire-escape'|'elevator' {
  const ys = input.cells.map(c => c[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return minY === maxY ? 'balcony' : minY === 0 ? 'elevator' : 'fire-escape';
}
const part=(n:number,min:number,max:number):FacilityPart=>min===max?'single':n===min?'start':n===max?'end':'repeat';
/** Raw support → protected-space approval → atomic wall/assembly output. No generated mesh input. */
export function planWallFacilities(document:GenerationDocument,surfaces:readonly Surface[],vertical:VerticalPlan[],portals:ReadonlySet<string>,book:ReservationBook):WallFacilityPlan {
  const plan:WallFacilityPlan={placements:[],reservations:[],changes:[],traces:[],groups:[]},faces=new Map(surfaces.filter(s=>s.role==='wall').map(s=>[s.faceId,s]));
  const zones=new Map(vertical.flatMap(v=>v.zones?.flatMap(z=>z.faceIds.map(id=>[id,z.id] as const))??v.faceBands.map(f=>[f.faceId,`band:${f.band}`] as const)));
  for(const input of document.sceneInputs.objects.filter(o=>o.category==='facility'&&['PX','NX','PZ','NZ'].includes(o.direction))){
    const facilityKind=input.facilityKind&&input.facilityKind!=='auto'?input.facilityKind:automaticFacilityKind(input);
    const normal=BASES[input.direction].n,hosts=input.cells.map(c=>faces.get(`${cellId(add(c,normal.map(n=>-n) as Vec3))}|${input.direction}`));
    let reason=hosts.some(f=>!f)?'NO_WALL_SUPPORT':hosts.some(f=>f!.architecture?.interpretation==='unsupported')?'UNSUPPORTED_FACADE_TOPOLOGY':hosts.some(f=>!zones.has(f!.faceId))?'NO_BUILDING_CAPABILITY':hosts.some(f=>portals.has(f!.faceId))?'PROTECTED_PORTAL':'';
    const us=input.cells.map(c=>c.reduce((n,v,i)=>n+v*BASES[input.direction].u[i],0)),ys=input.cells.map(c=>c[1]),planes=new Set(input.cells.map(c=>c.reduce((n,v,i)=>n+v*normal[i],0)));
    const minU=Math.min(...us),maxU=Math.max(...us),minY=Math.min(...ys),maxY=Math.max(...ys);
    if(planes.size!==1)reason='UNSUPPORTED_FACILITY_DEPTH';
    const placements:ScenePlacement[]=[],reservations:Reservation[]=[],assetKeys:string[]=[],intent=input.cells.map(cellBox16);
    if(!reason)for(let i=0;i<input.cells.length;i++){
      const face=hosts[i]!,center=faceCenter2(face.cell,face.direction).map((n,a)=>n/2+normal[a]*7/16) as Vec3;
      const asset=`wall-facility.${facilityKind}.${part(us[i],minU,maxU)}.${part(ys[i],minY,maxY)}`,descriptor=WALL_FACILITY_ASSETS[asset];assetKeys.push(asset);
      const heading=({PZ:0,PX:1,NZ:2,NX:3} as Record<string,Heading>)[input.direction],id=`facility:${input.id}:${face.faceId}`;
      const p:ScenePlacement={id,input,kind:'object',asset,center,size:[1,1,1],color:facilityKind==='elevator'?'#8fabb5':'#b8b0a0',context:'decorative-service-unverified',planId:`facility:${input.id}`,sourceRefs:[{kind:'object',id:input.id},{kind:'building',id:face.componentId}],yawQuarterTurns:heading};
      const bounds=scenePlacementBounds16(p);
      if(!containedInUnion(bounds,intent)){reason='BODY_OUTSIDE_INTENT';break;}
      p.worldBounds16=bounds;placements.push(p);
      // The catalog envelope reserves assembly and maintenance clearance, including empty rail space.
      const expected=faceBounds16({min:[-8,-8,2],max:[8,8,12]},faceCenter2(face.cell,face.direction),face.direction);
      if(JSON.stringify(expected)!==JSON.stringify(bounds))throw new Error('FACILITY_BOUNDS_MISMATCH');
      if(!descriptor)throw new Error('MISSING_FACILITY_ASSET');
      reservations.push({id,ownerId:input.id,sourceRefs:p.sourceRefs!,kind:'fixture',priority:500,cells:[input.cells[i]],boxes16:[bounds]});
    }
    if(!reason){const modules=new Map(assetKeys.map((key,i)=>[`${us[i]}:${ys[i]}`,WALL_FACILITY_ASSETS[key]]));for(let i=0;i<assetKeys.length;i++)for(const [side,other,du,dv] of [['left','right',-1,0],['right','left',1,0],['bottom','top',0,-1],['top','bottom',0,1]] as const){const port=WALL_FACILITY_ASSETS[assetKeys[i]].ports[side];if(port!=='closed'&&modules.get(`${us[i]+du}:${ys[i]+dv}`)?.ports[other]!==port)throw new Error('INCOMPLETE_FACILITY_JOINT');}}
    const decision=reason?{accepted:false,conflictIds:[]}:book.tryReserveBatch(reservations);
    if(!reason&&!decision.accepted)reason='PROTECTED_SPACE_CONFLICT';
    if(decision.accepted){plan.placements.push(...placements);plan.reservations.push(...reservations);if(input.facadeRequest==='solid')for(const face of hosts)plan.changes.push({faceId:face!.faceId,moduleId:'wall',objectId:input.id});}
    const faceIds=hosts.flatMap(f=>f?[f.faceId]:[]);plan.groups.push({objectId:input.id,faceIds,assetKeys,zoneIds:[...new Set(faceIds.flatMap(id=>zones.has(id)?[zones.get(id)!]:[]))].sort(),accepted:decision.accepted,reason:reason||'DECORATIVE_ASSEMBLY_APPROVED'});
    plan.traces.push({id:`facility:${input.id}`,ownerId:input.id,ruleId:'wall-facility-prototype',ruleVersion:'1',sourceRefs:[{kind:'object',id:input.id}],selectedIds:decision.accepted?placements.map(p=>p.id):[],candidates:[{candidateId:input.id,accepted:decision.accepted,reasonCodes:[reason||'DECORATIVE_ASSEMBLY_APPROVED','MOVEMENT_NOT_IMPLEMENTED'],conflictIds:decision.conflictIds,metrics:{cells:input.cells.length,wallChanges:decision.accepted&&input.facadeRequest==='solid'?hosts.length:0}}]});
  }return plan;
}
