import type {Box16} from './environment-contract';
export type AssetBand='base'|'body'|'crown';
export type AssetRow='foot'|'repeat'|'head'|'single'|'foot-cap'|'repeat-cap'|'head-cap'|'single-cap';
export type AssetPart='single'|'left'|'right'|'pier';
export type BandedFacadeKey=`facade.banded-${'shop'|'office'}-${AssetBand}-${AssetRow}-${AssetPart}`;
export interface BandedFacadeAsset {
  finish?:'shop'|'office'|'urban-shop'|'urban-office'|'ribbon-a'|'curtain-b'|'curtain-b-roof'|'streamline-c'|'streamline-c-roof';
  reliefCorner?:'left'|'right'|'both';
  integratedTrims?:boolean;
  cornerAssets?:Partial<Record<'left'|'right'|'both',string>>;
  surfaceRole?:'roof'|'terrace';
  accentBoxes16?:Box16[];
  reliefBevel16?:number;
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
  const descriptor:BandedFacadeAsset={finish:style,structural:true,bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16,accentBoxes16:[],railWidth16,edgeProfile:cap?'cap':'plain'};
  if(part==='pier'){
    const width=style==='office'?(band==='base'?2:1):(band==='base'?4:band==='body'?2:3);descriptor.pierWidth16=width;
    reliefBoxes16.push({min:[-width/2,-8,0],max:[width/2,cap?6:8,2]});
  }else {
    const inset=style==='office'?(band==='crown'?6:7):(band==='base'?6:band==='body'?5:4);
    const minV=style==='office'?(band==='crown'?-5:band==='base'&&foot?-5:-6):(band==='base'?(foot?-5:-6):band==='body'?-4:-3);
    const maxV=style==='office'?(band==='crown'?5:6):(band==='base'?6:band==='body'?5:3);
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
  // Authored secondary profiles stay inside the existing reserved 2/16 relief.
  // Connected left/right windows keep the aperture and rail ends continuous.
  const accent=descriptor.accentBoxes16!;
  const o=descriptor.opening16;
  if(o){
    for(const v of [o.minV-.25,o.maxV])accent.push({min:[o.minU,v,1.5],max:[o.maxU,v+.25,1.75]});
    if(!o.openLeft)accent.push({min:[o.minU-.25,o.minV,1.5],max:[o.minU,o.maxV,1.75]});
    if(!o.openRight)accent.push({min:[o.maxU,o.minV,1.5],max:[o.maxU+.25,o.maxV,1.75]});
    if(style==='shop'){
      // A layered stone sill and lintel; the shadow gap separates their steps.
      reliefBoxes16.push({min:[o.minU,o.minV-1.5,0],max:[o.maxU,o.minV-.75,2]});
      if(band!=='base')reliefBoxes16.push({min:[o.minU,o.maxV+.5,0],max:[o.maxU,o.maxV+1.25,2]});
    }else{
      // Slim projecting aluminium fins and a recessed spandrel accent.
      if(!o.openLeft)accent.push({min:[o.minU-1,-8,0],max:[o.minU-.65,cap?6:8,2]});
      if(!o.openRight)accent.push({min:[o.maxU+.65,-8,0],max:[o.maxU+1,cap?6:8,2]});
      accent.push({min:[o.minU,-7.5,.125],max:[o.maxU,o.minV-1.25,.375]});
    }
  }else if(part==='pier'){
    const width=descriptor.pierWidth16!;
    if(style==='shop'){
      for(const v of [-6,-2,2])accent.push({min:[-width/2,v,2-.125],max:[width/2,v+.125,2]});
      reliefBoxes16.push({min:[-width/2-.5,4.5,0],max:[width/2+.5,5.5,2]});
    }else for(const u of [-.65,.35])accent.push({min:[u,-8,0],max:[u+.3,cap?6:8,2]});
  }
  if(style==='shop'&&band==='crown'){
    // Dentils below the coping, with no overlap into the window opening.
    for(let u=-7.5;u<8;u+=2)reliefBoxes16.push({min:[u,4.25,.5],max:[u+.75,4.875,1.75]});
  }
  assets[`facade.banded-${style}-${band}-${row}-${part}`]=descriptor;
}
export const BANDED_FACADE_ASSETS=assets;
export function portalDescriptor(part:'single'|'left'|'right'):BandedFacadeAsset {
  const minU=part==='single'?-6:part==='left'?-4:-8,maxU=part==='single'?6:part==='left'?8:4,openLeft=part==='right',openRight=part==='left',reliefBoxes16:Box16[]=[{min:[minU,6,0],max:[maxU,7,2]}];
  if(!openLeft)reliefBoxes16.push({min:[minU-1,-8,0],max:[minU,7,2]});
  if(!openRight)reliefBoxes16.push({min:[maxU,-8,0],max:[maxU+1,7,2]});
  const accentBoxes16:Box16[]=[{min:[minU,7.25,.25],max:[maxU,7.75,1.5]}];
  if(!openLeft)accentBoxes16.push({min:[minU-.5,-8,2-.125],max:[minU-.25,6,2]});
  if(!openRight)accentBoxes16.push({min:[maxU+.25,-8,2-.125],max:[maxU+.5,6,2]});
  return {structural:true,opening16:{minU,maxU,minV:-8,maxV:6,openLeft,openRight},opening:{minX:minU/16,maxX:maxU/16,minY:-.5,maxY:6/16,openLeft,openRight},reliefBoxes16,accentBoxes16,bounds16:{min:[-8,-8,0],max:[8,8,2]},railWidth16:1,jointFamily:'portal-v1',part,edgeProfile:'plain',portalClearance16:{width:part==='single'?12:24,height:14}};
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
