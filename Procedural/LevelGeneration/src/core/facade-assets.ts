import {BANDED_FACADE_ASSETS,portalDescriptor,TRIM_ASSETS} from './banded-facade-assets';
import {ROOFTOP_FACADE_ASSETS} from './rooftop-facade-assets';
import {URBAN_FACADE_ASSETS} from './urban-facade-assets';
// Authored dimensions in local face coordinates. No volume input.
export interface FacadeAsset {
  opening?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    openLeft?: boolean;
    openRight?: boolean;
  };
  pier?: number;
  band?: "base" | "cornice" | "cap";
  mullion?: boolean;
}
export const FACADE_ASSETS = {
  ...BANDED_FACADE_ASSETS,
  ...ROOFTOP_FACADE_ASSETS,
  ...URBAN_FACADE_ASSETS,
  "facade.portal-single": portalDescriptor('single'),
  "facade.portal-left": portalDescriptor('left'),
  "facade.portal-right": portalDescriptor('right'),
  "facade.wall": {},
  "facade.cornice": { band: "cornice" },
  "facade.cap": { band: "cap" },
} as const satisfies Record<string, FacadeAsset>;
export type FacadeAssetKey = keyof typeof FACADE_ASSETS;
export const FACADE_MODULE_ASSETS = [...Object.values(TRIM_ASSETS),...["facade.cornice", "facade.cap"].map(
  (assetKey) => ({
    assetKey,
    coverage: "attachment",
    bounds16: { min: [-8, 5, 0], max: [8, 8, 2] },
  }),
)];
