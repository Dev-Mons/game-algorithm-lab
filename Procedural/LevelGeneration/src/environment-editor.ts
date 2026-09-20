import {cellId,normalizeGrid,compareCells,type Vec3} from './core/analysis';
import {createDocument,type GenerationDocument} from './core/document';
import {cloneJSON,canonicalJSON} from './core/canonical';
import {editRoads} from './scene-editor';
import type {InputDelta,SourceRef} from './core/environment-contract';
import {hash33} from './core/selection';
export interface EnvironmentEditCommand {
  kind:'parking-add'|'parking-remove'|'road-add'|'road-remove';
  targetId?:string;cells?:Vec3[];
}
export interface EnvironmentEditRecord {editId:number;command:EnvironmentEditCommand;beforeSignature:string;afterSignature:string;outcome:'accepted'|'rejected';changed:boolean}
export const inputSignature=(text:string)=>`${text.length}:${hash33(0,text).toString(16)}`;
function replace(document:GenerationDocument){return createDocument(document.grid,document.seed,document.catalog.id,document.buildingDefinition,document.buildings,document.sceneInputs);}
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
  }else throw new Error('UNKNOWN_ENVIRONMENT_COMMAND');
  const after=canonicalJSON(next);
  const difference=(a:Vec3[],b:Vec3[])=>{const aa=new Set(a.map(cellId)),bb=new Set(b.map(cellId));return [...a.filter(c=>!bb.has(cellId(c))),...b.filter(c=>!aa.has(cellId(c)))].sort(compareCells);};
  const changedIds=(a:{id:string}[],b:{id:string}[])=>[...new Set([...a.map(x=>x.id),...b.map(x=>x.id)])].filter(id=>canonicalJSON(a.find(x=>x.id===id)??null)!==canonicalJSON(b.find(x=>x.id===id)??null)).sort();
  const delta:InputDelta={buildingCells:difference(document.grid,next.grid),roadCells:difference(document.sceneInputs.roads,next.sceneInputs.roads),objectIds:changedIds(document.sceneInputs.objects,next.sceneInputs.objects),parkingIds:changedIds(document.sceneInputs.parkingAreas,next.sceneInputs.parkingAreas)};
  return {document:next,changed:before!==after,beforeSignature:inputSignature(before),afterSignature:inputSignature(after),delta};
}
export interface SourceHit {source:SourceRef;distance:number;anchor:Vec3}
export function rankSourceHits(hits:SourceHit[],mode?:SourceRef['kind']):SourceHit[]{
  const sorted=[...hits].sort((a,b)=>Number(b.source.kind===mode)-Number(a.source.kind===mode)||a.distance-b.distance||compareCells(a.anchor,b.anchor)||(a.source.id<b.source.id?-1:a.source.id>b.source.id?1:0)||(a.source.kind<b.source.kind?-1:1));
  const seen=new Set<string>();return sorted.filter(h=>{const key=`${h.source.kind}:${h.source.id}`;if(seen.has(key))return false;seen.add(key);return true;});
}
