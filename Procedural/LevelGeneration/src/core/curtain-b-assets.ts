import {ASSET_ROWS,portalDescriptor,type AssetBand,type AssetPart,type AssetRow,type BandedFacadeAsset} from './banded-facade-assets';
import type {Box16} from './environment-contract';

export type CurtainBKey=`facade.${''|'rooftop-'}curtain-b-${AssetBand}-${AssetRow}-${AssetPart}${''|'-edge-left'|'-edge-right'|'-edge-both'}`
  | `facade.${''|'rooftop-'}curtain-b-${'wall'|'portal-single'|'portal-left'|'portal-right'}${''|'-edge-left'|'-edge-right'|'-edge-both'}` | 'facade.curtain-b-roof';
export const isCurtainBCornerV10=(key:string)=>key.includes('curtain-b-')&&key.includes('-edge-');
export const CURTAIN_B_ASSETS={} as Record<CurtainBKey,BandedFacadeAsset>;
function rooftop(base:BandedFacadeAsset):BandedFacadeAsset{
  return {...base,reliefBoxes16:[...base.reliefBoxes16,{min:[-8,8,0],max:[8,12,.375]}],bounds16:{min:[-8,-8,0],max:[8,12,2]}};
}
for(const band of ['base','body','crown'] as const)for(const row of ASSET_ROWS)for(const part of ['single','left','right','pier'] as const){
  const role=row.replace('-cap',''),foot=role==='foot'||role==='single',head=role==='head'||role==='single';
  const lowerBelt=band==='crown'&&foot,upperBelt=band==='base'&&head;
  // An opaque, matte gray floor panel belongs below each middle-floor window.
  const minV=band==='body'?-5.75:-7.75,maxV=7.75;
  const minU=part==='right'?-8:-7.875,maxU=part==='left'?8:7.875;
  const openLeft=part==='right',openRight=part==='left';
  const reliefBoxes16:Box16[]=[],accentBoxes16:Box16[]=[];
  if(row.endsWith('-cap'))reliefBoxes16.push({min:[-8,7.75,0],max:[8,8,.375]});
  // Flush belts and narrow bronze joints keep the whole facade planar.
  accentBoxes16.push({min:[minU,minV,.25],max:[maxU,minV+.125,.375]},
    {min:[-.0625,minV,.25],max:[.0625,maxV,.375]},
    {min:[minU,maxV-.125,.25],max:[maxU,maxV,.375]});
  if(!openLeft)accentBoxes16.push({min:[minU,minV,.25],max:[minU+.125,maxV,.375]});
  if(!openRight)accentBoxes16.push({min:[maxU-.125,minV,.25],max:[maxU,maxV,.375]});
  const asset:BandedFacadeAsset={finish:'curtain-b',integratedTrims:true,structural:true,railWidth16:.125,
    bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16,accentBoxes16,
    opening16:{minU,maxU,minV,maxV,openLeft,openRight},
    opening:{minX:minU/16,maxX:maxU/16,minY:minV/16,maxY:maxV/16,openLeft,openRight},edgeProfile:row.endsWith('-cap')?'cap':'plain',
    ...(part==='pier'?{pierWidth16:.125}:{part,jointFamily:`curtain-b:${band}:${row}`})};
  if(lowerBelt||upperBelt){
    // Belt rows own a full opaque cell, with no hidden glazing behind them.
    delete asset.opening;delete asset.opening16;
    asset.reliefBoxes16=[{min:[-8,-8,0],max:[8,8,.375]}];
    asset.accentBoxes16=[];
  }
  CURTAIN_B_ASSETS[`facade.curtain-b-${band}-${row}-${part}`]=asset;
  if(row.endsWith('-cap'))CURTAIN_B_ASSETS[`facade.rooftop-curtain-b-${band}-${row}-${part}`]=rooftop(asset);
}
for(const part of ['single','left','right'] as const){
  const asset={...portalDescriptor(part),finish:'curtain-b' as const,integratedTrims:true};
  for(const b of [...asset.reliefBoxes16,...asset.accentBoxes16??[]]){
    b.min[2]*=.1875;b.max[2]*=.1875;
  }
  CURTAIN_B_ASSETS[`facade.curtain-b-portal-${part}`]=asset;
  CURTAIN_B_ASSETS[`facade.rooftop-curtain-b-portal-${part}`]=rooftop(asset);
}
const wall:BandedFacadeAsset={finish:'curtain-b',integratedTrims:true,structural:true,railWidth16:.125,edgeProfile:'plain',bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16:[]};
CURTAIN_B_ASSETS['facade.curtain-b-wall']=wall;
CURTAIN_B_ASSETS['facade.rooftop-curtain-b-wall']=rooftop(wall);
CURTAIN_B_ASSETS['facade.curtain-b-roof']={...wall,finish:'curtain-b-roof',surfaceRole:'roof',bounds16:{min:[-8,-8,-1],max:[8,8,0]}};

// Select only at an actual convex building edge, independently of window
// rhythm. Short returns can have a pillar at both ends of the same tile.
const cornerPrototypes=new Map<string,CurtainBKey>();
for(const [key,base] of Object.entries(CURTAIN_B_ASSETS)){
  if(base.surfaceRole)continue;
  base.cornerAssets={};
  for(const edge of ['left','right','both'] as const){
    const variant=`${key}-edge-${edge}` as CurtainBKey;
    const asset:BandedFacadeAsset={...base,cornerAssets:undefined,reliefCorner:edge,
      reliefBoxes16:[...base.reliefBoxes16],accentBoxes16:[...base.accentBoxes16??[]]};
    const left=edge==='left'||edge==='both',right=edge==='right'||edge==='both';
    if(base.opening16){
      const minU=left?Math.max(-7,base.opening16.minU):base.opening16.minU;
      const maxU=right?Math.min(7,base.opening16.maxU):base.opening16.maxU;
      asset.opening16={...base.opening16,minU,maxU};
      asset.opening={...base.opening!,minX:minU/16,maxX:maxU/16};
      if(!base.portalClearance16)asset.accentBoxes16=asset.accentBoxes16!.map(b=>({min:[Math.max(minU,b.min[0]),b.min[1],b.min[2]] as [number,number,number],max:[Math.min(maxU,b.max[0]),b.max[1],b.max[2]] as [number,number,number]})).filter(b=>b.max[0]>b.min[0]);
    }
    const solidBelt=base.reliefBoxes16.some(b=>b.min[0]===-8&&b.max[0]===8&&b.min[1]===-8&&b.max[1]===8);
    if(!solidBelt){
      if(left)asset.reliefBoxes16.push({min:[-8,-8,0],max:[-7,8,.375]});
      if(right)asset.reliefBoxes16.push({min:[7,-8,0],max:[8,8,.375]});
    }
    // Row-specific joint names do not change an exposed corner prototype.
    // Reuse identical shapes instead of multiplying the serialized catalog.
    const signature=JSON.stringify({...asset,jointFamily:undefined});
    const existing=cornerPrototypes.get(signature);
    base.cornerAssets[edge]=existing??variant;
    if(!existing){cornerPrototypes.set(signature,variant);CURTAIN_B_ASSETS[variant]=asset;}
  }
}
export function curtainBKey(key:string):CurtainBKey{
  return key.replace('banded-office-','curtain-b-').replace('rooftop-office-','rooftop-curtain-b-')
    .replace(/^facade\.(wall|portal-)/,'facade.curtain-b-$1') as CurtainBKey;
}
