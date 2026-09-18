import type {BandedFacadeAsset} from './banded-facade-assets';
import {BANDED_FACADE_ASSETS} from './banded-facade-assets';
import type {Box16} from './environment-contract';
import {cloneJSON} from './canonical';
import {COLUMN_ASSETS} from './column-prototype';

export interface FrameAsset extends BandedFacadeAsset {ports:{left:string;right:string;bottom:string;top:string}}
export type FrameKey=`facade.urban-frame-${0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15}`;
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

/** Shared solid service module, independent of semantic program section IDs. */
export const URBAN_FACADE_ASSETS={
  ...FRAME_ASSETS,
  ...COLUMN_ASSETS,
  'facade.urban-louver':{structural:true,bounds16:{min:[-8,-8,0],max:[8,8,2]},railWidth16:1,edgeProfile:'plain',reliefBoxes16:Array.from({length:5},(_,i)=>({min:[-6,-6+i*3,0],max:[6,-5+i*3,2]}))} as BandedFacadeAsset,
} satisfies Record<string,BandedFacadeAsset>;
