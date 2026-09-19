import { BANDED_FACADE_ASSETS, portalDescriptor, type AssetBand, type AssetPart, type BandedFacadeAsset, type BandedFacadeKey } from './banded-facade-assets';
import type { Box16 } from './environment-contract';

export type RooftopFacadeKey =
  | `facade.rooftop-banded-${'shop'|'office'}-${AssetBand}-${'foot'|'repeat'|'head'|'single'}-cap-${AssetPart}`
  | `facade.rooftop-${'shop'|'office'}-${'wall'|'portal-single'|'portal-left'|'portal-right'}`;
export const ROOFTOP_FACADE_ASSETS = {} as Record<RooftopFacadeKey, BandedFacadeAsset>;

// Fixed unit-wall variants retain their windows/doors and extend 4/16 above the roof.
// The extension is outside the roof footprint, leaving the walking surface clear.
function rooftop(base: BandedFacadeAsset, style: 'shop' | 'office'): BandedFacadeAsset {
  const parapet: Box16[] = style === 'shop'
    ? [{ min: [-8, 8, 0], max: [8, 11, 1] }, { min: [-8, 11, 0], max: [8, 12, 2] }]
    : [{ min: [-7, 8, 0], max: [-6, 11, 1] }, { min: [6, 8, 0], max: [7, 11, 1] },
       { min: [-8, 11, 0], max: [8, 12, 1] }];
  const accents:Box16[]=style==='shop'
    ? [{min:[-8,10.5,1],max:[8,10.75,1.25]}]
    : [{min:[-8,9.375,.25],max:[8,9.625,.625]}];
  return { ...base, finish:style, reliefBoxes16: [...base.reliefBoxes16, ...parapet],
    accentBoxes16:[...(base.accentBoxes16??[]),...accents],
    bounds16: { min: [-8, -8, 0], max: [8, 12, 2] } };
}

for (const [key, descriptor] of Object.entries(BANDED_FACADE_ASSETS)) {
  if (!key.includes('-cap-')) continue;
  ROOFTOP_FACADE_ASSETS[key.replace('facade.', 'facade.rooftop-') as RooftopFacadeKey] =
    rooftop(descriptor, key.includes('-shop-') ? 'shop' : 'office');
}
for (const style of ['shop', 'office'] as const) {
  for (const part of ['single', 'left', 'right'] as const)
    ROOFTOP_FACADE_ASSETS[`facade.rooftop-${style}-portal-${part}`] = rooftop(portalDescriptor(part), style);
  ROOFTOP_FACADE_ASSETS[`facade.rooftop-${style}-wall`] = rooftop({
    structural: true, reliefBoxes16: [], bounds16: { min: [-8, -8, 0], max: [8, 8, 2] },
    railWidth16: 1, edgeProfile: 'cap',
  }, style);
}

export function rooftopBandedKey(key: BandedFacadeKey): RooftopFacadeKey {
  return key.replace('facade.', 'facade.rooftop-') as RooftopFacadeKey;
}
