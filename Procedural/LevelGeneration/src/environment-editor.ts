import {cellId,normalizeGrid,compareCells,type Vec3} from './core/analysis';
import {createDocument,exportDocument,type GenerationDocument} from './core/document';
import {cloneJSON,canonicalJSON} from './core/canonical';
import {editRoads} from './scene-editor';
import type {InputDelta,SourceRef} from './core/environment-contract';
import {hash33} from './core/selection';
export interface EnvironmentEditCommand {
  kind:'parking-add'|'parking-remove'|'road-add'|'road-remove'|'setting'|'building-design';
  targetId?:string;cells?:Vec3[];settingPath?:string;value?:string|number|boolean;
}
export interface EnvironmentEditRecord {editId:number;command:EnvironmentEditCommand;beforeSignature:string;afterSignature:string;outcome:'accepted'|'rejected';changed:boolean}
export const inputSignature=(text:string)=>`${text.length}:${hash33(0,text).toString(16)}`;
function replace(document:GenerationDocument){return createDocument(document.grid,document.seed,document.catalog.id,document.buildingDefinition,document.buildings,document.sceneInputs,document.environment);}
function setPath(target:object,path:string|undefined,value:EnvironmentEditCommand['value'],optional:string[]=[]){
  if(!path||path.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)))throw new Error('UNKNOWN_SETTING');
  const keys=path.split('.');let node=target as Record<string,unknown>;
  for(const key of keys.slice(0,-1)){if(!Object.hasOwn(node,key)||!node[key]||typeof node[key]!=='object')throw new Error('UNKNOWN_SETTING');node=node[key] as Record<string,unknown>;}
  const key=keys[keys.length-1];
  if(!Object.hasOwn(node,key)&&!optional.includes(path))throw new Error('UNKNOWN_SETTING');
  if(value===undefined){if(!optional.includes(path))throw new Error('REQUIRED_SETTING');delete node[key];}else node[key]=value;
}
export function applyEnvironmentEdit(document:GenerationDocument,command:EnvironmentEditCommand){
  const before=canonicalJSON(document);let next=cloneJSON(document);
  if(command.kind==='road-add'||command.kind==='road-remove'){
    const cells=normalizeGrid(command.cells);if(cells.some(c=>c[1]!==0))throw new Error('ROAD_GROUND_ONLY');
    next=editRoads(document,{direction:'PY',cells:cells.map(([x,,z])=>[x,-1,z])},command.kind==='road-add'?'add':'remove');
  }else if(command.kind==='parking-add'||command.kind==='parking-remove'){
    const cells=normalizeGrid(command.cells);if(cells.some(c=>c[1]!==0))throw new Error('PARKING_GROUND_ONLY');
    let area=next.sceneInputs.parkingAreas.find(p=>p.id===command.targetId);
    if(command.targetId&&!area)throw new Error('UNKNOWN_PARKING_AREA');
    if(command.kind==='parking-add'){
      if(!area&&cells.length){let suffix=1;const prefix=`parking:${cellId(cells[0])}:`,used=new Set([...next.sceneInputs.parkingAreas.map(p=>p.id),...next.sceneInputs.objects.map(o=>o.id)]);
        while(used.has(`${prefix}${suffix}`))suffix++;
        area={id:`${prefix}${suffix}`,anchor:[...cells[0]],cells:[]};next.sceneInputs.parkingAreas.push(area);
      }
      if(area)area.cells=normalizeGrid([...area.cells,...cells]);
    }else if(area){const remove=new Set(cells.map(cellId));area.cells=area.cells.filter(c=>!remove.has(cellId(c)));if(!area.cells.length)next.sceneInputs.parkingAreas=next.sceneInputs.parkingAreas.filter(p=>p.id!==area!.id);}
    next=replace(next);
  }else if(command.kind==='setting'){
    setPath(next.environment,command.settingPath,command.value,['units.metersPerCell']);next=replace(next);
  }else if(command.kind==='building-design'){
    const building=next.buildings.find(b=>b.componentId===command.targetId);if(!building)throw new Error('UNKNOWN_BUILDING');
    if(command.settingPath==='use')building.design.use=command.value as typeof building.design.use;
    else if(command.settingPath==='designSeed')building.design.designSeed=command.value as number;
    else if(command.settingPath==='columnMode')building.design.columnMode=command.value as typeof building.design.columnMode;
    else if(command.settingPath?.startsWith('overrides.')){building.design.overrides??={};setPath(building.design,command.settingPath,command.value,['overrides.programId','overrides.familyId','overrides.palette']);}
    else {
      building.theme??=cloneJSON(next.buildingDefinition);
      if(!command.settingPath?.startsWith('bandPolicy.'))throw new Error('UNKNOWN_SETTING');
      setPath(building.theme,command.settingPath,command.value,['bandPolicy.baseCountOverride','bandPolicy.crownCountOverride']);
    }
    next=replace(next);
  }else throw new Error('UNKNOWN_ENVIRONMENT_COMMAND');
  const after=canonicalJSON(next);
  const difference=(a:Vec3[],b:Vec3[])=>{const aa=new Set(a.map(cellId)),bb=new Set(b.map(cellId));return [...a.filter(c=>!bb.has(cellId(c))),...b.filter(c=>!aa.has(cellId(c)))].sort(compareCells);};
  const changedIds=(a:{id:string}[],b:{id:string}[])=>[...new Set([...a.map(x=>x.id),...b.map(x=>x.id)])].filter(id=>canonicalJSON(a.find(x=>x.id===id)??null)!==canonicalJSON(b.find(x=>x.id===id)??null)).sort();
  const delta:InputDelta={buildingCells:difference(document.grid,next.grid),roadCells:difference(document.sceneInputs.roads,next.sceneInputs.roads),objectIds:changedIds(document.sceneInputs.objects,next.sceneInputs.objects),parkingIds:changedIds(document.sceneInputs.parkingAreas,next.sceneInputs.parkingAreas),settingKeys:command.kind==='setting'||command.kind==='building-design'?[command.settingPath!]:[]};
  return {document:next,changed:before!==after,beforeSignature:inputSignature(before),afterSignature:inputSignature(after),delta};
}
export interface SourceHit {source:SourceRef;distance:number;anchor:Vec3}
export function rankSourceHits(hits:SourceHit[],mode?:SourceRef['kind']):SourceHit[]{
  const sorted=[...hits].sort((a,b)=>Number(b.source.kind===mode)-Number(a.source.kind===mode)||a.distance-b.distance||compareCells(a.anchor,b.anchor)||(a.source.id<b.source.id?-1:a.source.id>b.source.id?1:0)||(a.source.kind<b.source.kind?-1:1));
  const seen=new Set<string>();return sorted.filter(h=>{const key=`${h.source.kind}:${h.source.id}`;if(seen.has(key))return false;seen.add(key);return true;});
}
