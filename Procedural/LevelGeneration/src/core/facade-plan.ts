import {BASES,type Surface} from './analysis';
import type {VerticalPlan} from './vertical-design';
import type {DeepReadonly} from './rule-spatial-contract';
import {FRAME_ASSETS,frameAssetKey,type FrameKey} from './urban-facade-assets';
export interface FacadeGrammar {sections:string[];periodV:number;minWidth:number;minHeight:number;boundaryPolicy:'absolute'|'restart';maxGroups:number;frameStyle?:'shop'|'office'}
export interface FacadePanel {id:string;faceIds:string[];status:'complete'|'fallback';reason:'COMPLETE'|'INCOMPLETE_MASK'|'FIXED_CONSTRAINT'|'MINIMUM_SIZE'|'BUDGET_EXCEEDED'}
export interface FacadePlan {
  buildingId:string;panels:FacadePanel[];
  faces:{faceId:string;moduleId:string;panelId:string;u:number;v:number;assetKey:FrameKey}[];
  counters:{candidateGroups:number;faceChecks:number;completeGroups:number;fallbackFaces:number;budgetExceeded:boolean};
}
export function planFacade(surfaces:readonly Surface[],vertical:DeepReadonly<VerticalPlan>,grammar:FacadeGrammar,fixed:ReadonlySet<string>=new Set()):FacadePlan {
  const plan:FacadePlan={buildingId:vertical.buildingId,panels:[],faces:[],counters:{candidateGroups:0,faceChecks:0,completeGroups:0,fallbackFaces:0,budgetExceeded:false}};
  const band=new Map(vertical.faceBands.map(f=>[f.faceId,f])),caps=new Set(vertical.boundaries.filter(b=>b.kind==='local-cap').map(b=>b.hostFaceId));
  const zone=new Map(vertical.zones?.flatMap(z=>z.faceIds.map(id=>[id,z.id] as const))??[]);
  const width=vertical.alignment.periodCells,height=grammar.periodV;
  const eligible=surfaces.filter(s=>s.componentId===vertical.buildingId&&s.role==='wall'&&s.architecture?.interpretation!=='unsupported'&&grammar.sections.includes(band.get(s.faceId)?.band??''));
  const origin=new Map<string,{u:number;v:number}>();
  const coord=(s:Surface)=>({u:s.cell.reduce((n,x,i)=>n+x*BASES[s.direction].u[i],0),v:s.cell[1],plane:s.cell.reduce((n,x,i)=>n+x*BASES[s.direction].n[i],0)});
  if(grammar.boundaryPolicy==='restart')for(const s of eligible){const {u,v}=coord(s),key=zone.get(s.faceId)??s.architecture!.regionId,prev=origin.get(key);origin.set(key,{u:Math.min(prev?.u??Infinity,u),v:Math.min(prev?.v??Infinity,v)});}
  const groups=new Map<string,{u:number;v:number;members:{s:Surface;u:number;v:number}[]}>();
  for(const s of eligible){const c=coord(s),o=grammar.boundaryPolicy==='restart'?origin.get(zone.get(s.faceId)??s.architecture!.regionId)!:{u:vertical.alignment.anchor.reduce((n,x,i)=>n+x*BASES[s.direction].u[i],0),v:vertical.alignment.anchor[1]};
    const u=o.u+Math.floor((c.u-o.u)/width)*width,v=o.v+Math.floor((c.v-o.v)/height)*height,key=`frame:${s.direction}:${c.plane}:${u}:${v}`;
    let group=groups.get(key);if(!group){group={u,v,members:[]};groups.set(key,group);}group.members.push({s,u:c.u,v:c.v});
  }
  for(const [id,g] of [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const panel:FacadePanel={id,faceIds:g.members.map(m=>m.s.faceId).sort(),status:'fallback',reason:'INCOMPLETE_MASK'};plan.panels.push(panel);
    plan.counters.candidateGroups++;
    if(plan.counters.candidateGroups>grammar.maxGroups){panel.reason='BUDGET_EXCEEDED';plan.counters.budgetExceeded=true;}
    else {
      plan.counters.faceChecks+=g.members.length;
      const zones=new Set(g.members.map(m=>zone.get(m.s.faceId)??m.s.architecture?.regionId));
      if(width<grammar.minWidth||height<grammar.minHeight)panel.reason='MINIMUM_SIZE';
      else if(g.members.some(m=>fixed.has(m.s.faceId)))panel.reason='FIXED_CONSTRAINT';
      else if(g.members.length===width*height&&zones.size===1&&g.members.every(m=>m.u>=g.u&&m.u<g.u+width&&m.v>=g.v&&m.v<g.v+height&&!caps.has(m.s.faceId)&&m.s.wallKind!=='rooftop')){
        panel.status='complete';panel.reason='COMPLETE';plan.counters.completeGroups++;
        for(const m of g.members){const u=m.u-g.u,v=m.v-g.v,bits=(u===0?1:0)|(u===width-1?2:0)|(v===0?4:0)|(v===height-1?8:0);plan.faces.push({faceId:m.s.faceId,moduleId:`frame-${bits}`,assetKey:frameAssetKey(bits,grammar.frameStyle),panelId:id,u,v});}
      }
    }
    if(panel.status==='fallback')plan.counters.fallbackFaces+=g.members.length;
  }
  validateFacadeJoints(plan);return plan;
}
/** Every open port is paired inside the same complete group, on an actual neighbor. */
export function validateFacadeJoints(plan:FacadePlan){
  const faces=new Map(plan.faces.map(f=>[`${f.panelId}:${f.u}:${f.v}`,f]));
  for(const face of plan.faces){const ports=FRAME_ASSETS[face.assetKey].ports;
    for(const [side,other,du,dv] of [['left','right',-1,0],['right','left',1,0],['bottom','top',0,-1],['top','bottom',0,1]] as const){
      if(ports[side]==='closed')continue;const neighbor=faces.get(`${face.panelId}:${face.u+du}:${face.v+dv}`);
      if(!neighbor||FRAME_ASSETS[neighbor.assetKey].ports[other]!==ports[side])throw new Error('INCOMPLETE_FACADE_JOINT');
    }
  }
}
