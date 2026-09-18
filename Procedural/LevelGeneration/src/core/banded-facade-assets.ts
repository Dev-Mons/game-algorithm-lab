import type {Box16} from './environment-contract';
export type AssetBand='base'|'body'|'crown';
export type AssetRow='foot'|'repeat'|'head'|'single'|'foot-cap'|'repeat-cap'|'head-cap'|'single-cap';
export type AssetPart='single'|'left'|'right'|'pier';
export type BandedFacadeKey=`facade.banded-${'shop'|'office'}-${AssetBand}-${AssetRow}-${AssetPart}`;
export interface BandedFacadeAsset {
  displayRects16?:{minU:number;maxU:number;minV:number;maxV:number;n:number}[];
  structural:boolean;opening16?:{minU:number;maxU:number;minV:number;maxV:number;openLeft:boolean;openRight:boolean};
  opening?:{minX:number;maxX:number;minY:number;maxY:number;openLeft?:boolean;openRight?:boolean};
  reliefBoxes16:Box16[];bounds16:Box16;pierWidth16?:number;railWidth16:number;
  jointFamily?:string;part?:'single'|'left'|'middle'|'right';edgeProfile:'plain'|'cap';portalClearance16?:{width:number;height:number};
}
export const ASSET_ROWS:AssetRow[]=['foot','repeat','head','single','foot-cap','repeat-cap','head-cap','single-cap'];
const assets={} as Record<BandedFacadeKey,BandedFacadeAsset>;
for(const style of ['shop','office'] as const)for(const band of ['base','body','crown'] as const)for(const row of ASSET_ROWS)for(const part of ['single','left','right','pier'] as const){
  const cap=row.endsWith('-cap'),role=row.replace('-cap',''),foot=role==='foot'||role==='single',head=role==='head'||role==='single',railWidth16=style==='shop'?1:.5,reliefBoxes16:Box16[]=[];
  const descriptor:BandedFacadeAsset={structural:true,bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16,railWidth16,edgeProfile:cap?'cap':'plain'};
  if(part==='pier'){
    const width=band==='base'?4:band==='body'?2:3;descriptor.pierWidth16=width;
    reliefBoxes16.push({min:[-width/2,-8,0],max:[width/2,cap?6:8,2]});
  }else {
    const inset=band==='base'?6:band==='body'?5:4,minV=band==='base'?(foot?-5:-6):band==='body'?-4:-3,maxV=band==='base'?6:band==='body'?5:3;
    const opening16={minU:part==='right'?-8:-inset,maxU:part==='left'?8:inset,minV,maxV,openLeft:part==='right',openRight:part==='left'};
    descriptor.opening16=opening16;descriptor.opening={minX:opening16.minU/16,maxX:opening16.maxU/16,minY:minV/16,maxY:maxV/16,openLeft:opening16.openLeft,openRight:opening16.openRight};descriptor.jointFamily=`${style}:${band}:${row}`;descriptor.part=part;
    // Frames lie outside the clear aperture; an open join has no internal mullion.
    reliefBoxes16.push({min:[opening16.minU,minV-railWidth16,0],max:[opening16.maxU,minV,1.5]},{min:[opening16.minU,maxV,0],max:[opening16.maxU,maxV+railWidth16,1.5]});
    if(!opening16.openLeft)reliefBoxes16.push({min:[opening16.minU-railWidth16,minV-railWidth16,0],max:[opening16.minU,maxV+railWidth16,1.5]});
    if(!opening16.openRight)reliefBoxes16.push({min:[opening16.maxU,minV-railWidth16,0],max:[opening16.maxU+railWidth16,maxV+railWidth16,1.5]});
  }
  if(band==='base'&&foot)reliefBoxes16.push({min:[-8,-8,0],max:[8,-6,style==='shop'?2:1]});
  if(band==='base'&&head&&!cap)reliefBoxes16.push({min:[-8,6,0],max:[8,8,1]});
  if(band==='crown')reliefBoxes16.push({min:[-8,5,0],max:[8,cap?6:8,2]});
  assets[`facade.banded-${style}-${band}-${row}-${part}`]=descriptor;
}
export const BANDED_FACADE_ASSETS=assets;
export function portalDescriptor(part:'single'|'left'|'right'):BandedFacadeAsset {
  const minU=part==='single'?-6:part==='left'?-4:-8,maxU=part==='single'?6:part==='left'?8:4,openLeft=part==='right',openRight=part==='left',reliefBoxes16:Box16[]=[{min:[minU,6,0],max:[maxU,7,2]}];
  if(!openLeft)reliefBoxes16.push({min:[minU-1,-8,0],max:[minU,7,2]});
  if(!openRight)reliefBoxes16.push({min:[maxU,-8,0],max:[maxU+1,7,2]});
  return {structural:true,opening16:{minU,maxU,minV:-8,maxV:6,openLeft,openRight},opening:{minX:minU/16,maxX:maxU/16,minY:-.5,maxY:6/16,openLeft,openRight},reliefBoxes16,bounds16:{min:[-8,-8,0],max:[8,8,2]},railWidth16:1,jointFamily:'portal-v1',part,edgeProfile:'plain',portalClearance16:{width:part==='single'?12:24,height:14}};
}
export interface TrimAsset {assetKey:string;coverage:'attachment';bounds16:Box16;boxes16:Box16[];jointFamily:'facade-trim-v1'}
export const TRIM_ASSETS:Record<string,TrimAsset>={};
for(const kind of ['cap','belt'] as const){
  const v=kind==='cap'?6:-8;
  const store=(suffix:string,boxes16:Box16[])=>{const assetKey=`trim.${kind}.${suffix}`;TRIM_ASSETS[assetKey]={assetKey,coverage:'attachment',boxes16,jointFamily:'facade-trim-v1',bounds16:{min:[0,1,2].map(a=>Math.floor(Math.min(...boxes16.map(b=>b.min[a])))) as [number,number,number],max:[0,1,2].map(a=>Math.ceil(Math.max(...boxes16.map(b=>b.max[a])))) as [number,number,number]}};};
  for(const variant of ['plain','start','end','both'] as const)store(variant,[{min:[variant==='start'||variant==='both'?-6:-8,v,0],max:[variant==='end'||variant==='both'?6:8,v+2,2]}]);
  for(const sign of [-1,1]){
    const u=sign*8,suffix=sign>0?'positive':'negative';
    store(`outer-${suffix}`,[{min:[u-2,v,0],max:[u+2,v+2,2]},{min:[sign>0?u:u-2,v,-2],max:[sign>0?u+2:u,v+2,0]}]);
    store(`inner-${suffix}`,[{min:[sign>0?u-2:u,v,0],max:[sign>0?u:u+2,v+2,2]}]);
  }
}
