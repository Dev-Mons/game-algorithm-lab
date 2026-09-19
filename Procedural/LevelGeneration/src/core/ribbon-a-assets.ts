import {ASSET_ROWS,portalDescriptor,type AssetBand,type AssetPart,type AssetRow,type BandedFacadeAsset} from './banded-facade-assets';
import type {Box16} from './environment-contract';

export type RibbonAKey=`facade.${''|'rooftop-'}ribbon-a-${AssetBand}-${AssetRow}-${AssetPart}`
  | `facade.${''|'rooftop-'}ribbon-a-${'wall'|'portal-single'|'portal-left'|'portal-right'}`;
export const RIBBON_A_ASSETS={} as Record<RibbonAKey,BandedFacadeAsset>;

function rooftop(base:BandedFacadeAsset):BandedFacadeAsset{
  return {...base,reliefBoxes16:[...base.reliefBoxes16,
    {min:[-8,8,0],max:[8,10.5,1]}, {min:[-8,10.5,0],max:[8,11,2]}],
    bounds16:{min:[-8,-8,0],max:[8,12,2]}};
}

// An authored floor strip: limestone slab / recessed dark glazing / thin sill.
// Every part carries the same horizontal profile, including the corner module.
// This keeps the ribbons continuous through paired openings and narrow remnants.
for(const band of ['base','body','crown'] as const)for(const row of ASSET_ROWS)for(const part of ['single','left','right','pier'] as const){
  const foot=row==='foot'||row==='single'||row==='foot-cap'||row==='single-cap';
  const minV=band==='base'&&foot?-6:-3.5,maxV=band==='base'&&foot?1:3;
  const minU=part==='right'?-8:part==='pier'?-7.5:-7.875;
  const maxU=part==='left'?8:part==='pier'?7.5:7.875;
  const openLeft=part==='right',openRight=part==='left';
  const reliefBoxes16:Box16[]=[
    {min:[-8,maxV,0],max:[8,row.endsWith('-cap')?6:8,2]},
    {min:[-8,-8,0],max:[8,minV,1.25]},
  ];
  const accentBoxes16:Box16[]=[{min:[minU,minV,.125],max:[maxU,minV+.1875,.375]},
    {min:[minU,maxV-.1875,.125],max:[maxU,maxV,.375]}];
  if(!openLeft)accentBoxes16.push({min:[minU,minV,.125],max:[minU+.125,maxV,.5]});
  if(!openRight)accentBoxes16.push({min:[maxU-.125,minV,.125],max:[maxU,maxV,.5]});
  const asset:BandedFacadeAsset={finish:'ribbon-a',structural:true,railWidth16:.125,reliefBevel16:.06,
    bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16,accentBoxes16,
    opening16:{minU,maxU,minV,maxV,openLeft,openRight},
    opening:{minX:minU/16,maxX:maxU/16,minY:minV/16,maxY:maxV/16,openLeft,openRight},
    edgeProfile:row.endsWith('-cap')?'cap':'plain',
    ...(part==='pier'?{pierWidth16:.5}:{part,jointFamily:`ribbon-a:${band}:${row}`})};
  RIBBON_A_ASSETS[`facade.ribbon-a-${band}-${row}-${part}`]=asset;
  if(row.endsWith('-cap'))RIBBON_A_ASSETS[`facade.rooftop-ribbon-a-${band}-${row}-${part}`]=rooftop(asset);
}
for(const part of ['single','left','right'] as const){
  const asset={...portalDescriptor(part),finish:'ribbon-a' as const};
  RIBBON_A_ASSETS[`facade.ribbon-a-portal-${part}`]=asset;
  RIBBON_A_ASSETS[`facade.rooftop-ribbon-a-portal-${part}`]=rooftop(asset);
}
const wall:BandedFacadeAsset={finish:'ribbon-a',structural:true,railWidth16:.125,edgeProfile:'plain',
  bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16:[]};
RIBBON_A_ASSETS['facade.ribbon-a-wall']=wall;
RIBBON_A_ASSETS['facade.rooftop-ribbon-a-wall']=rooftop(wall);

export function ribbonAKey(key:string):RibbonAKey{
  return key.replace('banded-shop-','ribbon-a-').replace('rooftop-shop-','rooftop-ribbon-a-')
    .replace(/^facade\.(wall|portal-)/,'facade.ribbon-a-$1') as RibbonAKey;
}
