import type {BuildingStyle} from './building-style';
import type {BuildingDesignV1} from './environment-contract';

export interface DesignOverrides {programId?:string;familyId?:string;palette?:'clay'|'sage'|'sand'}
export interface BuildingDesignProfile {
  seed:number; programId:string; familyId:string; bayPeriod:number;
  palette:'clay'|'sage'|'sand'; emphasis:'vertical'|'balanced'|'horizontal';
}
/** Independent decision hashes; no run length, component/region ID or RNG cursor. */
export function designHash(seed:number,anchor:readonly number[],decision:string){
  let value=seed>>>0;for(const c of `design-v1|${anchor.join(',')}|${decision}`)value=(Math.imul(value,33)+c.charCodeAt(0))>>>0;return value;
}
export function resolveDesignProfile(style:BuildingStyle,design:BuildingDesignV1):BuildingDesignProfile|undefined {
  if(!style.programs)return undefined;
  const seed=design.designSeed??0,hash=(key:string)=>designHash(seed,design.anchor,`${style.id}|${key}`),override=design.overrides;
  const programs=[...style.programs].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const families=[...style.alignedFamilies].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const program=override?.programId?programs.find(p=>p.id===override.programId):programs[hash('program')%programs.length];
  const family=override?.familyId?families.find(f=>f.id===override.familyId):families[hash('family')%families.length];
  if(!program||!family)throw new Error('INVALID_DESIGN_OVERRIDE');
  return {seed,programId:program.id,familyId:family.id,bayPeriod:family.periodCells,palette:override?.palette??(['clay','sage','sand'] as const)[hash('material')%3],emphasis:family.periodCells===2?'horizontal':family.periodCells===4?'vertical':'balanced'};
}
