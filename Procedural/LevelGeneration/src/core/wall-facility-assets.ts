import type {Box16} from './environment-contract';
export const FACILITY_KINDS=['balcony','fire-escape','elevator'] as const;
export type FacilityKind=typeof FACILITY_KINDS[number];
export type FacilityPart='single'|'start'|'repeat'|'end';
export interface WallFacilityAsset {boxes16:Box16[];bounds16:Box16;ports:{left:string;right:string;bottom:string;top:string}}
export const WALL_FACILITY_ASSETS:Record<string,WallFacilityAsset>={};
const parts:FacilityPart[]=['single','start','repeat','end'];
for(const kind of FACILITY_KINDS)for(const u of parts)for(const v of parts){
  const left=u==='single'||u==='start',right=u==='single'||u==='end',bottom=v==='single'||v==='start',top=v==='single'||v==='end';
  const boxes16:Box16[]=[];
  const box=(min:Box16['min'],max:Box16['max'])=>boxes16.push({min,max});
  if(kind==='balcony'){
    box([-8,-8,-5],[8,-6,5]);box([-8,3,4],[8,4,5]);
    for(const x of [-8,7])box([x,-8,-5],[x+1,8,-4]);
    for(const x of [-6,-2,2,6])box([x,-6,4],[x+1,4,5]);
    if(left)box([-8,-6,-5],[-7,4,5]);if(right)box([7,-6,-5],[8,4,5]);
  }else if(kind==='fire-escape'){
    for(let i=0;i<8;i++)box([-6,-8+i*2,-5+i],[6,-7+i*2,-3+i]);
    for(const x of [-8,7])box([x,-8,-5],[x+1,8,-4]);
    if(bottom)box([-8,-8,-5],[8,-7,5]);if(top)box([-8,7,-5],[8,8,5]);
  }else{
    for(const x of [-8,7])for(const z of [-5,4])box([x,-8,z],[x+1,8,z+1]);
    box([-7,-7,-4],[7,7,3]);if(bottom)box([-8,-8,-5],[8,-7,5]);if(top)box([-8,7,-5],[8,8,5]);
  }
  WALL_FACILITY_ASSETS[`wall-facility.${kind}.${u}.${v}`]={boxes16,bounds16:{min:[-8,-8,-5],max:[8,8,5]},ports:{left:left?'closed':`${kind}:u:${v}`,right:right?'closed':`${kind}:u:${v}`,bottom:bottom?'closed':`${kind}:v:${u}`,top:top?'closed':`${kind}:v:${u}`}};
}
