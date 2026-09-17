import {BASES,add,cellId,compareCells,faceCenter2,type Surface,type Vec3} from './analysis';
import {VERTICAL_BANDS,validateBuildingStyle,type BuildingStyle,type BandPolicy,type VerticalBand} from './building-style';
import type {BuildingDesignV1,BuildingUse,DecisionTrace} from './environment-contract';
export type WallDirection='PX'|'NX'|'PZ'|'NZ';
export type RowRole='foot'|'repeat'|'head'|'single';
export interface VerticalPlan {
  buildingId:string;datumY:number;heightCells:number;
  bands:{band:VerticalBand;yMin:number;yMaxExclusive:number}[];
  alignment:{anchor:Vec3;familyId:string;periodCells:number;phaseByDirection:Record<WallDirection,number>};
  faceBands:{faceId:string;band:VerticalBand;rowRole:RowRole}[];
  boundaries:{id:string;hostFaceId:string;kind:'base-belt'|'crown-belt'|'local-cap';edgeStart2:Vec3;edgeEnd2:Vec3}[];
  traces:DecisionTrace[];
}
export const positiveMod=(n:number,d:number)=>((n%d)+d)%d;
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
export function verticalCounts(height:number,use:BuildingUse,policy:BandPolicy) {
  if(!Number.isInteger(height)||height<0)throw new Error('INVALID_BUILDING_HEIGHT');
  if(height===0)return {base:0,body:0,crown:0,requestedBase:0,requestedCrown:0,reasonCodes:['EMPTY_BUILDING']};
  const requestedBase=policy.baseCountOverride??Math.floor((height*policy.baseRatioPermille[use]+500)/1000);
  const requestedCrown=policy.crownCountOverride??Math.floor((height*policy.crownRatioPermille+500)/1000);
  if(height<=3)return {base:1,body:height-1,crown:0,requestedBase,requestedCrown,reasonCodes:['SHORT_BUILDING_COLLAPSE']};
  const base=clamp(requestedBase,policy.baseCountOverride===undefined&&height>=8?2:1,Math.min(policy.maxBaseCells,height-2));
  const crown=clamp(requestedCrown,policy.crownCountOverride===0?0:1,Math.min(policy.maxCrownCells,height-base-1));
  return {base,body:height-base-crown,crown,requestedBase,requestedCrown,reasonCodes:requestedBase!==base||requestedCrown!==crown?['BAND_COUNTS_CLAMPED']:[]};
}
export function planVertical(buildingId:string,cells:readonly Vec3[],surfaces:readonly Surface[],design:BuildingDesignV1,definition:BuildingStyle):VerticalPlan {
  const style=validateBuildingStyle(definition);
  const family=[...style.alignedFamilies].sort((a,b)=>b.priority-a.priority||(a.id<b.id?-1:a.id>b.id?1:0))[0];
  const phaseByDirection=Object.fromEntries((['PX','NX','PZ','NZ'] as const).map(d=>[d,positiveMod(design.anchor.reduce((n,v,i)=>n+v*BASES[d].u[i],0),family.periodCells)])) as Record<WallDirection,number>;
  if(!cells.length)return {buildingId,datumY:0,heightCells:0,bands:[],alignment:{anchor:[...design.anchor],familyId:family.id,periodCells:family.periodCells,phaseByDirection},faceBands:[],boundaries:[],traces:[]};
  let datumY=Infinity,top=-Infinity;for(const c of cells){datumY=Math.min(datumY,c[1]);top=Math.max(top,c[1]);}
  const heightCells=top-datumY+1,counts=verticalCounts(heightCells,design.use,style.bandPolicy);
  const bands:VerticalPlan['bands']=[];let y=datumY;
  for(const band of VERTICAL_BANDS){const n=counts[band];if(n)bands.push({band,yMin:y,yMaxExclusive:y+n});y+=n;}

  const walls=surfaces.filter(s=>s.componentId===buildingId&&s.role==='wall'),faceSet=new Set(walls.map(s=>s.faceId));
  const faceBands=walls.map(s=>{const band=bands.find(b=>s.cell[1]>=b.yMin&&s.cell[1]<b.yMaxExclusive)!;return {faceId:s.faceId,band:band.band,rowRole:(band.yMaxExclusive-band.yMin===1?'single':s.cell[1]===band.yMin?'foot':s.cell[1]===band.yMaxExclusive-1?'head':'repeat') as RowRole};});
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
    const band=bands.find(b=>b.yMin===s.cell[1]);
    if(band&&band.band!=='base'&&faceSet.has(below))emit(s,band.band==='crown'?'crown-belt':'base-belt',false);
  }
  return {buildingId,datumY,heightCells,bands,alignment:{anchor:[...design.anchor],familyId:family.id,periodCells:family.periodCells,phaseByDirection},faceBands,
    boundaries:[...boundaries.values()].sort((a,b)=>compareCells(a.edgeStart2,b.edgeStart2)||compareCells(a.edgeEnd2,b.edgeEnd2)),
    traces:[{id:`vertical:${buildingId}`,ownerId:buildingId,ruleId:'banded-facade-v1',ruleVersion:String(style.version),sourceRefs:[{kind:'building',id:buildingId}],selectedIds:bands.map(b=>b.band),candidates:[{candidateId:'height-split',accepted:true,reasonCodes:counts.reasonCodes,metrics:{height:heightCells,use:design.use,base:counts.base,body:counts.body,crown:counts.crown,requestedBase:counts.requestedBase,requestedCrown:counts.requestedCrown,family:family.id},conflictIds:[]}]}]};
}
