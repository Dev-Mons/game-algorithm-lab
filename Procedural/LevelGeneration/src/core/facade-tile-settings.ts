import type {AssetBand, AssetRow} from './banded-facade-assets';
import type {FacadeAssetKey} from './facade-assets';

export const FACADE_TILE_ROLES = {base:'저층 타일',corner:'코너 타일',body:'중앙 타일',crown:'상층 타일'} as const;
export const FACADE_TILE_SETS = {A:'A · 수평 띠',B:'B · 커튼월',C:'C · 연속창',D:'D · 반복창',wall:'솔리드 벽'} as const;
export type FacadeTileRole = keyof typeof FACADE_TILE_ROLES;
export type FacadeTileSet = keyof typeof FACADE_TILE_SETS;
export type FacadeTileSettings = Partial<Record<FacadeTileRole, FacadeTileSet>>;

export function facadeTileBand(band: string): AssetBand {
  return band==='base'||band==='retail'?'base':band==='crown'||band==='upper'?'crown':'body';
}
/** Standalone tiles close their openings; authored row/cap and corner variants remain automatic. */
export function facadeTileAsset(set: FacadeTileSet, band: AssetBand, row: AssetRow, rooftop: boolean, corner: boolean): FacadeAssetKey {
  if(set==='wall')return rooftop?'facade.rooftop-ribbon-a-wall':'facade.ribbon-a-wall';
  if(set==='D')return `facade.tower11-d-${band==='base'?'ground':'window'}${rooftop?'-rooftop':''}`;
  const family={A:'ribbon-a',B:'curtain-b',C:'streamline-c'}[set];
  const variant=rooftop&&!row.endsWith('-cap')?`${row}-cap`:row;
  return `facade.${rooftop?'rooftop-':''}${family}-${band}-${variant}-${corner?'pier':'single'}` as FacadeAssetKey;
}
