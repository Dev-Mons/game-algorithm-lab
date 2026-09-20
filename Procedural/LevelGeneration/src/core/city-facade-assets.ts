import type {BandedFacadeAsset} from './banded-facade-assets';

// Shared A–C membrane finish; painted seams preserve the support plane.
export function cityRoof(finish:BandedFacadeAsset['finish']='city-roof'):BandedFacadeAsset {
  return {finish,structural:true,integratedTrims:true,surfaceRole:'roof',railWidth16:0,
    edgeProfile:'plain',bounds16:{min:[-8,-8,-1],max:[8,8,0]},reliefBoxes16:[]};
}
export const CITY_FACADE_ASSETS = {
  'facade.city-roof':cityRoof(),
  'facade.city-terrace':{...cityRoof(),surfaceRole:'terrace'},
} satisfies Record<string,BandedFacadeAsset>;
