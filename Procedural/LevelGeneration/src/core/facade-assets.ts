// Authored dimensions in local face coordinates. No style IDs or volume input.
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
const windowParts = (bottom: number, top: number, inset: number) => ({
  single: {
    opening: { minX: -inset, maxX: inset, minY: bottom, maxY: top },
    mullion: true,
  },
  left: {
    opening: {
      minX: -inset,
      maxX: 0.5,
      minY: bottom,
      maxY: top,
      openRight: true,
    },
  },
  right: {
    opening: {
      minX: -0.5,
      maxX: inset,
      minY: bottom,
      maxY: top,
      openLeft: true,
    },
  },
});
const regular = windowParts(-0.28, 0.29, 0.34);
const shop = windowParts(-0.38, 0.33, 0.4);
const office = windowParts(-0.34, 0.34, 0.44);
export const FACADE_ASSETS = {
  "facade.wall": {},
  "facade.window-single": regular.single,
  "facade.window-left": regular.left,
  "facade.window-right": regular.right,
  "facade.shop-single": { ...shop.single, band: "base" },
  "facade.shop-left": { ...shop.left, band: "base" },
  "facade.shop-right": { ...shop.right, band: "base" },
  "facade.office-single": office.single,
  "facade.office-left": office.left,
  "facade.office-right": office.right,
  "facade.shop-entry": {
    opening: { minX: -0.32, maxX: 0.32, minY: -0.5, maxY: 0.32 },
    mullion: true,
    band: "base",
  },
  "facade.lobby-entry": {
    opening: { minX: -0.44, maxX: 0.44, minY: -0.5, maxY: 0.38 },
    mullion: true,
  },
  "facade.pier": { pier: 0.22, band: "base" },
  "facade.office-pier": { pier: 0.1 },
  "facade.corner": { pier: 0.4, band: "base" },
  "facade.cornice": { band: "cornice" },
  "facade.cap": { band: "cap" },
} as const satisfies Record<string, FacadeAsset>;
export type FacadeAssetKey = keyof typeof FACADE_ASSETS;
export const FACADE_MODULE_ASSETS = ["facade.cornice", "facade.cap"].map(
  (assetKey) => ({
    assetKey,
    coverage: "attachment",
    bounds16: { min: [-8, 5, 0], max: [8, 8, 2] },
  }),
);
