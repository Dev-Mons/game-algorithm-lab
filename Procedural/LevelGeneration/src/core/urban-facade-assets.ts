import type {BandedFacadeAsset} from './banded-facade-assets';
import {BANDED_FACADE_ASSETS} from './banded-facade-assets';
import type {Box16} from './environment-contract';
import {cloneJSON} from './canonical';
import {COLUMN_ASSETS} from './column-prototype';

export interface FrameAsset extends BandedFacadeAsset {ports:{left:string;right:string;bottom:string;top:string}}
type FrameBits=0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15;
export type FrameKey=`facade.urban-${''|'shop-'|'office-'}frame-${FrameBits}`;
export function frameAssetKey(bits:number,style?:'shop'|'office'):FrameKey {
  return `facade.urban-${style?`${style}-`:''}frame-${bits}` as FrameKey;
}
export const FRAME_ASSETS={} as Record<FrameKey,FrameAsset>;
// Four authored border bits (left/right/bottom/top), 16 finite complete prototypes.
for(let bits=0;bits<16;bits++){
  const base=cloneJSON(BANDED_FACADE_ASSETS['facade.banded-office-body-repeat-single']),relief:Box16[]=[];
  if(bits&1)relief.push({min:[-8,-8,0],max:[-7,8,2]});
  if(bits&2)relief.push({min:[7,-8,0],max:[8,8,2]});
  if(bits&4)relief.push({min:[-8,-8,0],max:[8,-7,2]});
  if(bits&8)relief.push({min:[-8,7,0],max:[8,8,2]});
  const horizontal=`rail:${bits&4?1:0}:${bits&8?1:0}`,vertical=`rail:${bits&1?1:0}:${bits&2?1:0}`;
  FRAME_ASSETS[`facade.urban-frame-${bits}` as FrameKey]={...base,reliefBoxes16:[...base.reliefBoxes16,...relief],ports:{left:bits&1?'closed':horizontal,right:bits&2?'closed':horizontal,bottom:bits&4?'closed':vertical,top:bits&8?'closed':vertical}};
}

// Two complete, finite mesh families. Open group edges have continuous glazing;
// only the authored outer bits carry the deep architectural surround.
for(const style of ['shop','office'] as const)for(let bits=0;bits<16;bits++){
  const width=style==='shop'?1.5:.65;
  const minU=bits&1?-8+width:-8,maxU=bits&2?8-width:8;
  const minV=bits&4?-8+width:-8,maxV=bits&8?8-width:8;
  const relief:Box16[]=[],accent:Box16[]=[];
  if(bits&1)relief.push({min:[-8,-8,0],max:[minU,8,2]});
  if(bits&2)relief.push({min:[maxU,-8,0],max:[8,8,2]});
  if(bits&4)relief.push({min:[minU,-8,0],max:[maxU,minV,2]});
  if(bits&8)relief.push({min:[minU,maxV,0],max:[maxU,8,2]});
  // Subdivisions belong to the fixed prototype, independent of run length/seed.
  if(style==='office'){
    accent.push({min:[-.125,minV,.25],max:[.125,maxV,1.25]});
    for(const v of [-8,7.8125])accent.push({min:[minU,v,.25],max:[maxU,v+.1875,1]});
  }else{
    accent.push({min:[-.1875,minV,.25],max:[.1875,maxV,.875]});
    if(bits&4)accent.push({min:[minU,minV,.25],max:[maxU,minV+.25,1.25]});
    if(bits&8)accent.push({min:[minU,maxV-.25,.25],max:[maxU,maxV,1.25]});
  }
  const horizontal=`rail:${bits&4?1:0}:${bits&8?1:0}`,vertical=`rail:${bits&1?1:0}:${bits&2?1:0}`;
  FRAME_ASSETS[frameAssetKey(bits,style)]={
    finish:`urban-${style}`,structural:true,bounds16:{min:[-8,-8,0],max:[8,8,2]},
    opening16:{minU,maxU,minV,maxV,openLeft:!(bits&1),openRight:!(bits&2)},
    opening:{minX:minU/16,maxX:maxU/16,minY:minV/16,maxY:maxV/16},
    reliefBoxes16:relief,reliefBevel16:style==='shop'?.2:.1,accentBoxes16:accent,railWidth16:width,edgeProfile:'plain',
    ports:{left:bits&1?'closed':horizontal,right:bits&2?'closed':horizontal,bottom:bits&4?'closed':vertical,top:bits&8?'closed':vertical},
  };
}

/** Shared solid service module, independent of semantic program section IDs. */
export const URBAN_FACADE_ASSETS={
  ...FRAME_ASSETS,
  ...COLUMN_ASSETS,
  'facade.urban-louver':{finish:'urban-office',structural:true,bounds16:{min:[-8,-8,0],max:[8,8,2]},railWidth16:1,edgeProfile:'plain',reliefBoxes16:[{min:[-7,-7,0],max:[-6,7,2]},{min:[6,-7,0],max:[7,7,2]}],accentBoxes16:Array.from({length:9},(_,i)=>({min:[-6,-6+i*1.5,.25],max:[6,-5.5+i*1.5,1.75]}))} as BandedFacadeAsset,
} satisfies Record<string,BandedFacadeAsset>;
