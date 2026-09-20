import {BASES,add,cellId,compareCells,faceCenter2,type Surface,type Vec3} from './analysis';
import {VERTICAL_BANDS,validateBuildingStyle,type BuildingStyle,type VerticalBand} from './building-style';
import type {BuildingDesignV1,DecisionTrace} from './environment-contract';
import {allocateProgram} from './architectural-program';
import {resolveDesignProfile,type BuildingDesignProfile} from './design-profile';
import {analyzeMass,type MassRelations} from './mass-relations';
export type WallDirection='PX'|'NX'|'PZ'|'NZ';
export type RowRole='foot'|'repeat'|'head'|'single';
export interface VerticalPlan {
  buildingId:string;datumY:number;heightCells:number;
  bands:{band:VerticalBand;yMin:number;yMaxExclusive:number}[];
  alignment:{anchor:Vec3;familyId:string;periodCells:number;phaseByDirection:Record<WallDirection,number>};
  faceBands:{faceId:string;band:VerticalBand;rowRole:RowRole}[];
  boundaries:{id:string;hostFaceId:string;kind:'base-belt'|'crown-belt'|'local-cap';edgeStart2:Vec3;edgeEnd2:Vec3}[];
  traces:DecisionTrace[];
  profile?:BuildingDesignProfile;
  mass?:MassRelations;
  zones?:{id:string;massId:string;sectionId:string;regionId:string;yMin:number;yMaxExclusive:number;faceIds:string[]}[];
}
export const positiveMod=(n:number,d:number)=>((n%d)+d)%d;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
export function verticalCounts(height:number,style:Pick<BuildingStyle,'id'>) {
  const baseRatio=style.id==='shop'?250:200,crownRatio=style.id==='office'?200:100;
  if(!Number.isInteger(height)||height<0)throw new Error('INVALID_BUILDING_HEIGHT');
  if(height===0)return {base:0,body:0,crown:0,requestedBase:0,requestedCrown:0,reasonCodes:['EMPTY_BUILDING']};
  if(style.id==='tower11-d')return {base:1,body:height-1,crown:0,requestedBase:1,requestedCrown:0,reasonCodes:[]};
  const requestedBase=Math.floor((height*baseRatio+500)/1000);
  const requestedCrown=Math.floor((height*crownRatio+500)/1000);
  if(height<=3)return {base:1,body:height-1,crown:0,requestedBase,requestedCrown,reasonCodes:['SHORT_BUILDING_COLLAPSE']};
  const base=clamp(requestedBase,height>=8?2:1,Math.min(4,height-2));
  const crown=clamp(requestedCrown,1,Math.min(3,height-base-1));
  return {base,body:height-base-crown,crown,requestedBase,requestedCrown,reasonCodes:requestedBase!==base||requestedCrown!==crown?['BAND_COUNTS_CLAMPED']:[]};
}
export function planVertical(buildingId:string,cells:readonly Vec3[],surfaces:readonly Surface[],design:BuildingDesignV1,definition:BuildingStyle,seed=0):VerticalPlan {
  const style=validateBuildingStyle(definition);
  const profile=resolveDesignProfile(style,design,seed);
  const family=profile?style.alignedFamilies.find(f=>f.id===profile.familyId)!:[...style.alignedFamilies].sort((a,b)=>b.priority-a.priority||(a.id<b.id?-1:a.id>b.id?1:0))[0];
  const phaseByDirection=Object.fromEntries((['PX','NX','PZ','NZ'] as const).map(d=>[d,positiveMod(design.anchor.reduce((n,v,i)=>n+v*BASES[d].u[i],0),family.periodCells)])) as Record<WallDirection,number>;
  if(!cells.length)return {buildingId,datumY:0,heightCells:0,bands:[],alignment:{anchor:[...design.anchor],familyId:family.id,periodCells:family.periodCells,phaseByDirection},faceBands:[],boundaries:[],traces:[]};
  let datumY=Infinity,top=-Infinity;for(const c of cells){datumY=Math.min(datumY,c[1]);top=Math.max(top,c[1]);}
  const heightCells=top-datumY+1,counts=verticalCounts(heightCells,style);
  const bands:VerticalPlan['bands']=[];let y=datumY;
  const allocation=profile?allocateProgram(heightCells,style.programs!.find(p=>p.id===profile.programId)!,datumY===style.groundY):undefined;
  for(const {id:band,count:n} of allocation?.sections??VERTICAL_BANDS.map(b=>({id:b,count:counts[b]}))){if(n)bands.push({band,yMin:y,yMaxExclusive:y+n});y+=n;}

  const walls=surfaces.filter(s=>s.componentId===buildingId&&s.role==='wall'),faceSet=new Set(walls.map(s=>s.faceId));
  const mass=style.massPolicy?analyzeMass(cells,style.massPolicy):undefined;
  const scopeColumns=new Map(mass?.scopes.flatMap(s=>s.columns.map(c=>[c,s] as const))??[]);
  const scopedBands=new Map(mass?.scopes.map(s=>{
    const allocation=allocateProgram(s.yMaxExclusive-s.yMin,style.programs!.find(p=>p.id===profile!.programId)!,s.yMin===style.groundY);let y=s.yMin;
    return [s.id,allocation.sections.map(section=>{const b={band:section.id,yMin:y,yMaxExclusive:y+section.count};y+=section.count;return b;})] as const;
  })??[]);
  const zones:NonNullable<VerticalPlan['zones']>=[],zoneMap=new Map<string,typeof zones[number]>();
  const faceBands=walls.map(s=>{
    const scope=scopeColumns.get(`${s.cell[0]},${s.cell[2]}`),local=scope?scopedBands.get(scope.id)!:bands;
    const band=local.find(b=>s.cell[1]>=b.yMin&&s.cell[1]<b.yMaxExclusive)??bands.find(b=>s.cell[1]>=b.yMin&&s.cell[1]<b.yMaxExclusive)!;
    const massId=scope?.id??'building',regionId=s.architecture?.regionId??`${s.direction}:${s.faceId}`,key=`${massId}|${band.band}|${regionId}`;
    if(mass){let zone=zoneMap.get(key);if(!zone){zone={id:`zone:${key}`,massId,regionId,sectionId:band.band,yMin:band.yMin,yMaxExclusive:band.yMaxExclusive,faceIds:[]};zoneMap.set(key,zone);zones.push(zone);}zone.faceIds.push(s.faceId);}
    return {faceId:s.faceId,band:band.band,rowRole:(band.yMaxExclusive-band.yMin===1?'single':s.cell[1]===band.yMin?'foot':s.cell[1]===band.yMaxExclusive-1?'head':'repeat') as RowRole};
  });
  const assigned=new Map(faceBands.map(f=>[f.faceId,f]));
  const boundaries=new Map<string,VerticalPlan['boundaries'][number]>();
  const emit=(s:Surface,kind:VerticalPlan['boundaries'][number]['kind'],top:boolean)=>{
    const center=faceCenter2(s.cell,s.direction);center[1]+=top?1:-1;
    let start=center.map((n,i)=>n-BASES[s.direction].u[i]) as Vec3,end=center.map((n,i)=>n+BASES[s.direction].u[i]) as Vec3;
    if(compareCells(start,end)>0)[start,end]=[end,start];
    const key=`${cellId(start)}|${cellId(end)}`;
    const rank={'base-belt':1,'crown-belt':2,'local-cap':3};
    if(!boundaries.has(key)||rank[kind]>rank[boundaries.get(key)!.kind])boundaries.set(key,{id:`boundary:${key}`,hostFaceId:s.faceId,kind,edgeStart2:start,edgeEnd2:end});
  };
  for(const s of walls){
    const above=`${cellId(add(s.cell,[0,1,0]))}|${s.direction}`,below=`${cellId(add(s.cell,[0,-1,0]))}|${s.direction}`;
    if(!faceSet.has(above))emit(s,'local-cap',true);
    const band=assigned.get(s.faceId)!,lower=assigned.get(below);
    if(lower&&lower.band!==band.band)emit(s,band.band==='crown'||band.band==='upper'?'crown-belt':'base-belt',false);
  }
  return {buildingId,datumY,heightCells,bands,...(profile?{profile}:{}),...(mass?{mass,zones}:{}),alignment:{anchor:[...design.anchor],familyId:family.id,periodCells:family.periodCells,phaseByDirection},faceBands,
    boundaries:[...boundaries.values()].sort((a,b)=>compareCells(a.edgeStart2,b.edgeStart2)||compareCells(a.edgeEnd2,b.edgeEnd2)),
    traces:[{id:`vertical:${buildingId}`,ownerId:buildingId,ruleId:'banded-facade-v1',ruleVersion:String(style.version),sourceRefs:[{kind:'building',id:buildingId}],selectedIds:bands.map(b=>b.band),candidates:[{candidateId:'height-split',accepted:true,reasonCodes:allocation?.reasons??counts.reasonCodes,metrics:{height:heightCells,base:counts.base,body:counts.body,crown:counts.crown,requestedBase:counts.requestedBase,requestedCrown:counts.requestedCrown,family:family.id,...(profile?{program:profile.programId}: {})},conflictIds:[]}]}]};
}
