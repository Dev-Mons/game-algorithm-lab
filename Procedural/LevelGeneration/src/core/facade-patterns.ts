import type {AssetRow} from "./banded-facade-assets";
import {
  BASES,
  add,
  cellId,
  type Surface,
  type Direction,
  type Placement,
} from "./analysis";
import {
  validateBuildingStyle,
  type BuildingStyle,
  type VerticalBand,
  type FacadeKind,
  type FacadePattern,
} from "./building-style";
import type { FaceTrace, SelectionOptions } from "./selection";
import type { VolumeAnalysis } from "./regions";

export interface FacadeTrace {
  styleId: string;
  styleVersion: number;
  level: VerticalBand;
  topBoundary: boolean;
  wallKind?: Surface['wallKind'];
  facade: FacadeKind;
  runId: string;
  patternId: string;
  moduleId: string;
  entranceSpan?: number;
  portalId?: string;
  portalRole?: string;
  rowRole?: string;
  phase?: number;
  groupId?: string;
  part?: "single" | "left" | "middle" | "right";
  alignment?: string;
  framePanelId?:string;
  reason: string;
  candidates: { id: string; reason: string; filler?: number }[];
}
export interface PatternRunBand {role: VerticalBand; patterns:string[];moduleSet:string[];align?:string}
const cmp = (a:string,b:string) => a < b ? -1 : a > b ? 1 : 0;

export function chooseFacadePattern(
  style: BuildingStyle,
  run: {
    width: number;
    start: number;
    anchor: number;
    level: PatternRunBand;
    kind: FacadeKind;
    direction: Direction;
  },
  forced?: string,
) {
  const modules = new Map(style.modules.map((m) => [m.id, m]));
  const candidates: FacadeTrace["candidates"] = [];
  const fitted: {
    pattern: FacadePattern;
    tokens: string[];
    filler: number;
    prefix: number;
    repeats: number;
  }[] = [];
  for (const id of run.level.patterns) {
    const p = style.patterns.find((p) => p.id === id)!;
    let reason =
      forced && id !== forced
        ? "shared-floor-pattern"
        : !p.roles.includes(run.level.role)
          ? "level-role"
          : !p.facades.includes(run.kind)
            ? "facade-kind"
            : run.width < p.minWidth
              ? "minimum-width"
              : "";
    const keys = [...p.start, ...p.repeat, ...p.end, p.remainder];
    if (
      keys.some(
        (key) =>
          !run.level.moduleSet.includes(key) ||
          !modules.get(key)!.directions.includes(run.direction),
      )
    )
      reason = "module-set-or-direction";
    // The repeated group follows the authored start pieces and the alignment filler.
    const prefix = run.level.align
      ? (((run.anchor - run.start - p.start.length) % p.repeat.length) + p.repeat.length) %
        p.repeat.length
      : 0;
    const repeats = Math.min(
      p.maxRepeat,
      Math.floor(
        (run.width - p.start.length - p.end.length - prefix) / p.repeat.length,
      ),
    );
    if (!reason && repeats < p.minRepeat)
      reason = "too-short-for-complete-group";
    if (reason) {
      candidates.push({ id, reason });
      continue;
    }
    const suffix =
      run.width -
      p.start.length -
      p.end.length -
      prefix -
      repeats * p.repeat.length;
    const filler = prefix + suffix;
    fitted.push({
      pattern: p,
      filler,
      prefix,
      repeats,
      tokens: [
        ...p.start,
        ...Array<string>(prefix).fill(p.remainder),
        ...Array.from({ length: repeats }, () => p.repeat).flat(),
        ...Array<string>(suffix).fill(p.remainder),
        ...p.end,
      ],
    });
    candidates.push({
      id,
      filler,
      reason: filler ? "integer-remainder" : "exact-fit",
    });
  }
  fitted.sort(
    (a, b) =>
      Number(a.filler !== 0) - Number(b.filler !== 0) ||
      a.filler - b.filler ||
      b.pattern.priority - a.pattern.priority ||
      cmp(a.pattern.id, b.pattern.id),
  );
  const best = fitted[0];
  for (const c of candidates)
    if (c.id !== best?.pattern.id && c.filler !== undefined)
      c.reason += ":lower-ranked";
  return { best, candidates };
}

export function applyFacadeStyle<T extends {surfaces:Surface[];placements:Placement[];traces:FaceTrace[]}>(base:T,options:SelectionOptions):T {
  if(!options.architecture)return base;
  const style=validateBuildingStyle(options.architecture),context=options.context;
  if(!context?.verticalBands||!context.entrances)throw new Error('ENV_PIPELINE_NOT_READY:facade-context');
  const vertical=context.verticalBands,entrances=context.entrances;
  const caps=new Set(vertical.boundaries.filter(b=>b.kind==='local-cap').map(b=>b.hostFaceId)),catalogIds=new Set(options.catalog?.map(t=>t.tileId));
  const defs=new Map(style.modules.map(m=>[m.id,m])),faces=new Map(base.surfaces.map(s=>[s.faceId,s]));
  for(const c of context.columns?.faces??[])defs.set(c.assetKey,{id:c.assetKey,assetId:c.assetKey,semantic:'wall',width:1,height:1,directions:['PX','NX','PZ','NZ']});
  const bands=new Map(vertical.faceBands.map(b=>[b.faceId,b]));
  const family=style.alignedFamilies.find(f=>f.id===vertical.alignment.familyId)!;
  const placements=base.placements.map(p=>({...p})),traces=base.traces.map(t=>({...t}));
  const byPlacement=new Map(placements.map(p=>[p.faceId,p])),byTrace=new Map(traces.map(t=>[t.faceId,t]));
  const claimed=new Set<string>();
  const u=(s:Surface)=>s.cell.reduce((n,v,i)=>n+v*BASES[s.direction].u[i],0);
  const plane=(s:Surface)=>s.cell.reduce((n,v,i)=>n+v*Math.abs(BASES[s.direction].n[i]),0)+(BASES[s.direction].n.some(n=>n===1)?1:0);
  const kind=(s:Surface):FacadeKind=>entrances.frontages.some(f=>f.direction===s.direction&&f.plane===plane(s))?'front':'side';
  const assign=(s:Surface,key:string,patternId:string,reason:string,candidates:FacadeTrace['candidates']=[],groupId?:string,portal?:typeof entrances.entrances[number])=>{
    const def=defs.get(key),band=bands.get(s.faceId),p=byPlacement.get(s.faceId),trace=byTrace.get(s.faceId);
    if(!def||!band||!p||!trace||!def.directions.includes(s.direction))throw new Error('INVALID_FACADE_MODULE');
    const isCap=caps.has(s.faceId);
    const rowAsset=(isCap?`${band.rowRole}-cap`:band.rowRole) as AssetRow;
    const rooftopAsset=s.wallKind==='rooftop'?def.rooftopAssets?.[rowAsset]:undefined;
    const asset=rooftopAsset??def.rowAssets?.[rowAsset]??def.assetId;
    const palette=vertical.profile?.palette??trace.architecture?.palette??'clay',tileId=`${asset}.${palette}`;
    if(!catalogIds.has(tileId))throw new Error(`MISSING_FACADE_ASSET:${tileId}`);
    p.tileId=tileId;p.ruleId=portal?'building.entrance':'building.banded';
    if(rooftopAsset&&!portal)p.ruleId='building.rooftop-wall';
    trace.selection={...trace.selection,ruleId:p.ruleId,tileId};
    trace.facade={styleId:style.id,styleVersion:style.version,level:band.band,rowRole:band.rowRole,phase:vertical.alignment.phaseByDirection[s.direction as 'PX'|'NX'|'PZ'|'NZ'],topBoundary:caps.has(s.faceId),facade:kind(s),runId:`${s.componentId}:${s.direction}:${plane(s)}:${s.cell[1]}`,patternId,moduleId:key,reason,candidates,...(groupId?{groupId}:{}),...(def.connection?{part:def.connection.part}:{}),...(portal?{portalId:portal.id,portalRole:portal.role,entranceSpan:portal.widthCells}:{})};
    claimed.add(s.faceId);
    trace.facade.wallKind=s.wallKind;
  };
  for(const portal of entrances.entrances)for(const [partIndex,faceId] of portal.faceIds.entries()){const face=faces.get(faceId);if(!face||face.role!=='wall')throw new Error('INVALID_PORTAL_FACE');assign(face,portal.widthCells===2?style.entrancePair[partIndex]:style.entrance,'entrance','validated exterior access',[],portal.id,portal);}
  for(const change of context.facadeChanges??[]){const s=faces.get(change.faceId);if(!s)continue;if(claimed.has(s.faceId))throw new Error('FACILITY_PORTAL_CONFLICT');assign(s,change.moduleId,'approved-facility-wall','atomic approved wall request');}
  for(const c of context.columns?.faces??[]){const s=faces.get(c.faceId)!,trace=byTrace.get(c.faceId)!;if(claimed.has(c.faceId))throw new Error('COLUMN_FIXED_CONSTRAINT');if(s.role==='wall')assign(s,c.assetKey,'column-display','source occupancy and face ownership retained');else{const p=byPlacement.get(c.faceId)!,tileId=`${c.assetKey}.${vertical.profile?.palette??trace.architecture?.palette??'clay'}`;if(!catalogIds.has(tileId))throw new Error('MISSING_COLUMN_CAP');p.tileId=tileId;p.ruleId='column-display';trace.selection={...trace.selection,tileId,ruleId:p.ruleId};}}
  for(const face of context.facadePlan?.faces??[]){if(claimed.has(face.faceId))throw new Error('FACADE_FIXED_CONSTRAINT_OVERWRITE');assign(faces.get(face.faceId)!,face.moduleId,'multi-floor-frame','complete U/V group');byTrace.get(face.faceId)!.facade!.framePanelId=face.panelId;}
  const rows=new Map<string,Surface[]>();
  for(const s of base.surfaces)if(s.role==='wall'&&s.architecture?.interpretation!=='unsupported'&&bands.has(s.faceId)){const key=`${s.componentId}:${s.direction}:${plane(s)}:${s.cell[1]}`,row=rows.get(key)??[];row.push(s);rows.set(key,row);}
  for(const row of rows.values()){
    row.sort((a,b)=>u(a)-u(b));
    // Physical run ends, rather than bounding rectangle ends, receive corners.
    let all:Surface[]=[];
    const fill=()=>{
      if(!all.length)return;
      if(all.length>=style.corner.minRunWidth)for(const face of [all[0],all[all.length-1]])if(!claimed.has(face.faceId))assign(face,style.bands[bands.get(face.faceId)!.band].moduleSet.find(k=>defs.get(k)?.semantic==='pier')??style.corner.module,'corner','actual run end');
      let open:Surface[]=[];
      const flush=()=>{
        if(!open.length)return;
        const first=open[0],band=bands.get(first.faceId)!.band;
        const result=chooseFacadePattern(style,{width:open.length,start:u(first),anchor:vertical.alignment.phaseByDirection[first.direction as 'PX'|'NX'|'PZ'|'NZ'],level:{role:band,patterns:family.patterns[band],moduleSet:style.bands[band].moduleSet,align:family.id},kind:kind(first),direction:first.direction});
        const tokens=result.best?.tokens??Array<string>(open.length).fill(style.bands[band].fallback);
        let groupId:string|undefined;
        tokens.forEach((key,i)=>{const def=defs.get(key)!;if(def.connection?.part==='left')groupId=`group:${first.componentId}:${first.direction}:${first.cell[1]}:${u(open[i])}:${plane(first)}`;assign(open[i],key,result.best?.pattern.id??'single-fallback','absolute anchor / complete connected groups',result.candidates,groupId);if(def.connection?.part==='right'||def.connection?.part==='single'||!def.connection)groupId=undefined;});
        open=[];
      };
      for(const face of all){if(claimed.has(face.faceId))flush();else {const prior=open[open.length-1];if(prior&&(bands.get(prior.faceId)!.band!==bands.get(face.faceId)!.band||bands.get(prior.faceId)!.rowRole!==bands.get(face.faceId)!.rowRole||prior.wallKind!==face.wallKind||caps.has(prior.faceId)!==caps.has(face.faceId)))flush();open.push(face);}}flush();all=[];
    };
    for(const face of row){if(all.length&&u(face)!==u(all[all.length-1])+1)fill();all.push(face);}fill();
  }
  return {...base,placements,traces};
}
