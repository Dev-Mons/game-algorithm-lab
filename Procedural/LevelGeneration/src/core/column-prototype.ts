import {add,cellId,type Vec3,type Surface} from './analysis';
import type {BuildingDesignV1} from './environment-contract';
import type {BandedFacadeAsset} from './banded-facade-assets';
export type ColumnRole='body'|'foot'|'head'|'single'|'slab-foot'|'slab-head'|'slab-single'|'cap';
export type ColumnKey=`facade.urban-column-${ColumnRole}`;
export const COLUMN_ASSETS={} as Record<ColumnKey,BandedFacadeAsset>;
for(const role of ['body','foot','head','single','slab-foot','slab-head','slab-single','cap'] as const){
  const reliefBoxes16:BandedFacadeAsset['reliefBoxes16']=[];
  if(role!=='cap'){
    if(['foot','single','slab-foot','slab-single'].includes(role))reliefBoxes16.push({min:[-4,-8,-8],max:[4,-6,-4]});
    if(['head','single','slab-head','slab-single'].includes(role))reliefBoxes16.push({min:[-4,6,-8],max:[4,8,-4]});
  }
  COLUMN_ASSETS[`facade.urban-column-${role}`]={structural:true,railWidth16:1,edgeProfile:'plain',bounds16:{min:[-8,-8,-8],max:[8,8,0]},reliefBoxes16,displayRects16:[{minU:-2,maxU:2,minV:role==='cap'?-2:-8,maxV:role==='cap'?2:8,n:role==='cap'?0:-6}]};
}
export interface ColumnPlan {buildingId:string;runs:{cells:Vec3[];bottom:'ground'|'slab'|'free';top:'slab'|'free';accepted:boolean;reason:string}[];faces:{faceId:string;assetKey:ColumnKey}[]}
export function planColumns(buildingId:string,cells:readonly Vec3[],surfaces:readonly Surface[],mode:NonNullable<BuildingDesignV1['columnMode']>,fixed:ReadonlySet<string>):ColumnPlan {
  const plan:ColumnPlan={buildingId,runs:[],faces:[]};if(mode==='building')return plan;
  const occupied=new Set(cells.map(cellId)),steps:Vec3[]=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]],candidate=new Map(cells.filter(c=>steps.every(d=>!occupied.has(cellId(add(c,d))))).map(c=>[cellId(c),c]));
  const byCell=new Map<string,Surface[]>();for(const s of surfaces)if(s.componentId===buildingId){const list=byCell.get(cellId(s.cell))??[];list.push(s);byCell.set(cellId(s.cell),list);}
  for(const cell of cells){if(!candidate.has(cellId(cell))||candidate.has(cellId(add(cell,[0,-1,0]))))continue;
    const run:Vec3[]=[];let c=cell;while(candidate.has(cellId(c))){run.push(c);c=add(c,[0,1,0]);}
    const below=occupied.has(cellId(add(cell,[0,-1,0]))),above=occupied.has(cellId(c)),bottom=below?'slab':cell[1]===0?'ground':'free',top=above?'slab':'free';
    const faces=run.flatMap(c=>byCell.get(cellId(c))??[]),reason=faces.some(s=>fixed.has(s.faceId))?'FIXED_FACE_CONSTRAINT':mode==='auto'&&!below&&!above?'AMBIGUOUS_NARROW_BUILDING':'DISPLAY_COLUMN';
    plan.runs.push({cells:run,bottom,top,accepted:reason==='DISPLAY_COLUMN',reason});if(reason!=='DISPLAY_COLUMN')continue;
    for(const [i,c] of run.entries())for(const s of byCell.get(cellId(c))??[]){
      let role:ColumnRole=run.length===1?'single':i===0?'foot':i===run.length-1?'head':'body';
      if(role==='single'&&(below||above))role='slab-single';else if(role==='foot'&&below)role='slab-foot';else if(role==='head'&&above)role='slab-head';
      plan.faces.push({faceId:s.faceId,assetKey:`facade.urban-column-${s.role==='wall'?role:'cap'}`});
    }
  }return plan;
}
