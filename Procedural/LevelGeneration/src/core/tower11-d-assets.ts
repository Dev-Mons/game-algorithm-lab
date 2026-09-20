import {portalDescriptor,type BandedFacadeAsset} from './banded-facade-assets';
import type {Box16} from './environment-contract';

type Part='ground'|'window'|'wall'|'portal-single'|'portal-left'|'portal-right';
export type Tower11DKey=`facade.tower11-d-${Part}${''|'-rooftop'}`;
export const TOWER11_D_ASSETS={} as Record<Tower11DKey,BandedFacadeAsset>;
const wall:BandedFacadeAsset={finish:'tower11-d',structural:true,integratedTrims:true,
  railWidth16:.25,edgeProfile:'plain',bounds16:{min:[-8,-8,0],max:[8,8,2]},reliefBoxes16:[]};

for(const part of ['ground','window','wall','portal-single','portal-left','portal-right'] as const){
  let asset:BandedFacadeAsset={...wall,reliefBoxes16:[],accentBoxes16:[]};
  if(part==='ground'||part==='window'){
    // Tower11: one three-unit floor per cell, 2.15-unit glazing above a
    // 0.55-unit slab band. The ground floor has tall individual storefronts.
    const ground=part==='ground',minU=ground?-6.8:-7.5,maxU=-minU;
    const minV=ground?-6.65:-4,maxV=ground?7:7.5;
    asset.opening16={minU,maxU,minV,maxV,openLeft:false,openRight:false};
    asset.opening={minX:minU/16,maxX:maxU/16,minY:minV/16,maxY:maxV/16};
    asset.part='single';asset.pierWidth16=.25;
    if(ground)asset.reliefBoxes16.push({min:[-7.25,7.25,0],max:[7.25,8,2]});
    else asset.reliefBoxes16.push(
      {min:[-8,-8,0],max:[8,-5,.9]},
      {min:[-8,-5,.5],max:[8,-4.5,1.25]},
    );
    const frames:Box16[]=[
      {min:[minU-.25,minV-.25,.25],max:[minU,maxV+.25,.75]},
      {min:[maxU,minV-.25,.25],max:[maxU+.25,maxV+.25,.75]},
      {min:[minU,minV-.25,.25],max:[maxU,minV,.75]},
      {min:[minU,maxV,.25],max:[maxU,maxV+.25,.75]},
    ];
    asset.accentBoxes16=frames;
  }else if(part.startsWith('portal-')){
    // Keep the common, measured door clearance and shared entrance planning.
    asset={...portalDescriptor(part.slice(7) as 'single'|'left'|'right'),finish:'tower11-d',integratedTrims:true};
    asset.reliefBoxes16.push({min:[-7.25,7.25,0],max:[7.25,8,2]});
  }
  TOWER11_D_ASSETS[`facade.tower11-d-${part}`]=asset;
  TOWER11_D_ASSETS[`facade.tower11-d-${part}-rooftop`]={...asset,
    reliefBoxes16:[...asset.reliefBoxes16,{min:[-8,8,0],max:[8,11.75,.5]},{min:[-8,11.75,0],max:[8,12,.8]}],
    bounds16:{min:[-8,-8,0],max:[8,12,2]}};
}
