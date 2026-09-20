import {ASSET_ROWS,portalDescriptor,type AssetBand,type AssetPart,type AssetRow,type BandedFacadeAsset} from './banded-facade-assets';
import {COLUMN_ASSETS,type ColumnRole} from './column-prototype';
import type {Box16} from './environment-contract';
import {cityRoof} from './city-facade-assets';

export type StreamlineCKey=`facade.${''|'rooftop-'}streamline-c-${AssetBand}-${AssetRow}-${AssetPart}${''|'-cut-left'|'-cut-right'|'-cut-both'}`
  | `facade.${''|'rooftop-'}streamline-c-${'wall'|'portal-single'|'portal-left'|'portal-right'}${''|'-cut-left'|'-cut-right'|'-cut-both'}`
  | 'facade.streamline-c-roof' | 'facade.streamline-c-terrace' | `facade.streamline-c-column-${ColumnRole}`;
export const STREAMLINE_C_ASSETS={} as Record<StreamlineCKey,BandedFacadeAsset>;
// Catalog 8 only had corner variants for piers. Preserve its exact tile list
// when validating saved files; catalog 9 supplies the missing module variants.
export function isStreamlineCCornerV9(key:string):boolean {
  return key.includes('streamline-c-')&&key.includes('-cut-')&&!key.includes('-pier-cut-');
}

function rooftop(base:BandedFacadeAsset):BandedFacadeAsset {
  return {...base,reliefBoxes16:[...base.reliefBoxes16,
    {min:[-8,8,0],max:[8,10.75,1.5]}, {min:[-8,10.75,0],max:[8,11.25,2]}],
    bounds16:{min:[-8,-8,0],max:[8,12,2]}};
}

// C: low charcoal ribbons above a 1.5-cell shopfront. Its full-height lower
// panel meets the half-height upper panel without a concrete floor divider.
for(const band of ['base','body','crown'] as const)for(const row of ASSET_ROWS)for(const part of ['single','left','right','pier'] as const){
  const ground=band==='base'&&(row.startsWith('foot')||row.startsWith('single'));
  const base=band==='base',cap=row.endsWith('-cap');
  // A locally capped, one-cell wall keeps a small lintel inside its own face.
  const minV=base?-8:-3,maxV=base?(ground?(cap?6:8):0):4;
  const minU=part==='right'?-8:-7.94,maxU=part==='left'?8:7.94;
  const openLeft=part==='right',openRight=part==='left';
  const reliefBoxes16:Box16[]=[];
  if(maxV<8)reliefBoxes16.push({min:[-8,maxV,0],max:[8,8,2]});
  if(minV>-8)reliefBoxes16.push({min:[-8,-8,0],max:[8,minV,2]});
  const accentBoxes16:Box16[]=[{min:[minU,minV,.25],max:[maxU,minV+.125,.5]}];
  if(!openLeft)accentBoxes16.push({min:[minU,minV,.25],max:[minU+.125,maxV,.5]});
  const asset:BandedFacadeAsset={finish:'streamline-c',structural:true,railWidth16:.125,
    edgeProfile:row.endsWith('-cap')?'cap':'plain',bounds16:{min:[-8,-8,0],max:[8,8,2]},
    opening16:{minU,maxU,minV,maxV,openLeft,openRight},
    opening:{minX:minU/16,maxX:maxU/16,minY:minV/16,maxY:maxV/16,openLeft,openRight},
    reliefBoxes16,accentBoxes16,
    ...(part==='pier'?{pierWidth16:.125}:{part,jointFamily:`streamline-c:${band}:${row}`})};
  if(base&&part==='pier'){
    delete asset.opening;delete asset.opening16;
    asset.reliefBoxes16=[{min:[-8,-8,0],max:[8,8,2]}];asset.accentBoxes16=[];
  }
  for(const roof of [false,true]){
    if(roof&&!row.endsWith('-cap'))continue;
    const key=`facade.${roof?'rooftop-':''}streamline-c-${band}-${row}-${part}` as StreamlineCKey;
    const base=roof?rooftop(asset):asset;
    STREAMLINE_C_ASSETS[key]=base;
  }
}
for(const part of ['single','left','right'] as const){
  const asset={...portalDescriptor(part),finish:'streamline-c' as const};
  // The authored lintel includes its own coping; no separate trim overlay.
  asset.reliefBoxes16[0].max[1]=8;
  STREAMLINE_C_ASSETS[`facade.streamline-c-portal-${part}`]=asset;
  STREAMLINE_C_ASSETS[`facade.rooftop-streamline-c-portal-${part}`]=rooftop(asset);
}
const wall:BandedFacadeAsset={finish:'streamline-c',structural:true,railWidth16:.125,edgeProfile:'plain',
  bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16:[{min:[-8,-8,0],max:[8,8,2]}]};
STREAMLINE_C_ASSETS['facade.streamline-c-wall']=wall;
STREAMLINE_C_ASSETS['facade.rooftop-streamline-c-wall']=rooftop(wall);
STREAMLINE_C_ASSETS['facade.streamline-c-roof']=cityRoof('streamline-c-roof');
STREAMLINE_C_ASSETS['facade.streamline-c-terrace']={...STREAMLINE_C_ASSETS['facade.streamline-c-roof'],surfaceRole:'terrace'};
for(const [key,asset] of Object.entries(COLUMN_ASSETS))
  STREAMLINE_C_ASSETS[key.replace('urban-column','streamline-c-column') as StreamlineCKey]={...asset,finish:'streamline-c'};

// Corner selection is independent of the facade rhythm, row role and run
// width. Both faces of every convex edge must use the same clipping plane.
for(const [key,base] of Object.entries(STREAMLINE_C_ASSETS)){
  if(base.surfaceRole||key.includes('-column-'))continue;
  base.integratedTrims=true;base.cornerAssets={};
  for(const cut of ['left','right','both'] as const){
    const variant=`${key}-cut-${cut}` as StreamlineCKey;
    base.cornerAssets[cut]=variant;
    const asset={...base,cornerAssets:undefined,reliefCorner:cut};
    if(base.opening16&&!base.portalClearance16){
      const minU=cut==='left'||cut==='both'?-8:base.opening16.minU;
      const maxU=cut==='right'||cut==='both'?8:base.opening16.maxU;
      asset.opening16={...base.opening16,minU,maxU};
      asset.opening={...base.opening!,minX:minU/16,maxX:maxU/16};
    }
    STREAMLINE_C_ASSETS[variant]=asset;
  }
}

export function streamlineCKey(key:string):StreamlineCKey {
  return key.replace('banded-shop-','streamline-c-').replace('rooftop-shop-','rooftop-streamline-c-')
    .replace(/^facade\.(wall|portal-)/,'facade.streamline-c-$1') as StreamlineCKey;
}
