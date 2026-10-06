import {BASES,add,cellId,compareCells,faceCenter2,partitionNormalizedCells,type Vec3,type Surface,type Direction} from './analysis';
import type {GenerationDocument} from './document';
import type {ParkingAreaInput,Box16,Heading,DecisionTrace,SourceRef} from './environment-contract';
import type {ScenePlacement} from './scene-inputs';
import {isResidential,preferredHouseDoor} from './residential-kit';
import {cellBox16,mergeBoxes16,scenePlacementBounds16,boxesOverlap} from './placement-bounds';

type WallDirection=Extract<Direction,'PX'|'NX'|'PZ'|'NZ'>;
const directions:WallDirection[]=['PZ','PX','NZ','NX'];
const headings:Record<WallDirection,Heading>={PZ:0,PX:1,NZ:2,NX:3};
export interface AttachedGaragePlan {
  id:string;areaId:string;buildingId:string;cells:Vec3[];contactFaceIds:string[];
  doorDirection:WallDirection;openingCells:Vec3[];bayCount:number;
  access:'road-facing'|'local';vehicleProof:'not-verified';
  placements:ScenePlacement[];bounds16:Box16[];
}
export interface AttachedGaragePlanning {
  garages:AttachedGaragePlan[];openParkingAreas:ParkingAreaInput[];traces:DecisionTrace[];
}

/** Parking input remains authoritative. A compact rectangle against a residential
 * ground wall is a one-story garage; larger/unsupported masks keep open-lot rules. */
export function planAttachedGarages(document:GenerationDocument,surfaces:readonly Surface[],components=partitionNormalizedCells(document.grid)):AttachedGaragePlanning {
  const styles=new Map(document.buildings.map(b=>[b.componentId,b.theme??document.buildingDefinition]));
  const occupied=new Set(document.grid.map(cellId));
  const walls=new Map(surfaces.filter(s=>s.role==='wall'&&s.cell[1]===0).map(s=>[s.faceId,s]));
  const houses=new Set(document.buildings.filter(b=>b.rule.id==='standard-contextual'&&isResidential(styles.get(b.componentId)!.id)&&styles.get(b.componentId)!.id!=='residential-garage').map(b=>b.componentId));
  if(!houses.size||!document.sceneInputs.parkingAreas.length)return {garages:[],openParkingAreas:document.sceneInputs.parkingAreas,traces:[]};
  const componentCells=new Map(components.map(c=>[c.id,c.cells]));
  const obstacles=[...document.sceneInputs.roads.map(cellBox16),...document.sceneInputs.objects.flatMap(o=>o.cells.map(cellBox16))];
  const garages:AttachedGaragePlan[]=[],openParkingAreas:ParkingAreaInput[]=[],traces:DecisionTrace[]=[];
  for(const area of document.sceneInputs.parkingAreas){
    const claimed=new Set<string>(),candidates:DecisionTrace['candidates']=[];
    for(const part of partitionNormalizedCells(area.cells)){
      const cells=part.cells,mask=new Set(cells.map(cellId)),contacts:Surface[]=[],blockedNeighbors=new Set<string>();
      for(const c of cells)for(const d of directions){
        const neighbor=add(c,BASES[d].n),opposite=directions[(headings[d]+2)%4];
        const face=walls.get(`${cellId(neighbor)}|${opposite}`);
        if(face&&houses.has(face.componentId)&&face.architecture?.interpretation!=='unsupported')contacts.push(face);
        else if(occupied.has(cellId(neighbor)))blockedNeighbors.add(cellId(neighbor));
      }
      if(!contacts.length)continue;
      const id=`garage:${area.id}:${cellId(cells[0])}`,trace:DecisionTrace['candidates'][number]={candidateId:id,accepted:false,reasonCodes:[],metrics:{cells:cells.length},conflictIds:[]};
      candidates.push(trace);
      const reject=(reason:string)=>{trace.reasonCodes=[reason];};
      const min=[0,1,2].map(a=>Math.min(...cells.map(c=>c[a]))) as Vec3,max=[0,1,2].map(a=>Math.max(...cells.map(c=>c[a]))+1) as Vec3;
      if(cells.some(c=>occupied.has(cellId(c)))||blockedNeighbors.size){reject('GARAGE_BUILDING_OVERLAP');continue;}
      if(cells.length!==(max[0]-min[0])*(max[2]-min[2])){reject('GARAGE_RECTANGLE_REQUIRED');continue;}
      if(cells.length<2||max[0]-min[0]>4||max[2]-min[2]>4){reject('GARAGE_COMPACT_FOOTPRINT_REQUIRED');continue;}
      const owners=new Set(contacts.map(s=>s.componentId));
      if(owners.size!==1){reject('GARAGE_SINGLE_HOUSE_REQUIRED');continue;}
      const buildingId=contacts[0].componentId,style=styles.get(buildingId)!;
      const fullContact=directions.some(d=>{
        const side=contacts.filter(s=>s.direction===d),axis=d==='PX'||d==='NX'?2:0;
        return new Set(side.map(s=>s.faceId)).size===max[axis]-min[axis];
      });
      if(!fullContact){reject('GARAGE_FULL_WALL_CONTACT_REQUIRED');continue;}
      const preferred=preferredHouseDoor(componentCells.get(buildingId)!,style.id)?.direction;
      const options=directions.flatMap(direction=>{
        const n=BASES[direction].n,axis=n[0]?0:2,depth=max[axis]-min[axis];
        if(depth<2)return [];
        const edge=cells.filter(c=>!mask.has(cellId(add(c,n))));
        if(edge.some(c=>occupied.has(cellId(add(c,n)))||document.sceneInputs.objects.some(o=>o.cells.some(p=>cellId(p)===cellId(add(c,n))))))return [];
        const distances=document.sceneInputs.roads.flatMap(road=>edge.flatMap(c=>{
          const forward=(road[0]-c[0])*n[0]+(road[2]-c[2])*n[2],side=Math.abs((road[0]-c[0])*n[2]-(road[2]-c[2])*n[0]);
          return forward>0&&forward<=8&&side===0?[forward]:[];
        }));
        return [{direction,edge,distance:distances.length?Math.min(...distances):Infinity,preferred:direction===preferred}];
      }).sort((a,b)=>a.distance-b.distance||Number(b.preferred)-Number(a.preferred)||style.frontOrder.indexOf(a.direction)-style.frontOrder.indexOf(b.direction));
      if(!options.length){reject('GARAGE_CLEAR_ENTRY_REQUIRED');continue;}
      const chosen=options[0],contactFaceIds=[...new Set(contacts.map(s=>s.faceId))].sort();
      const placements=createGarageShell(id,area.id,buildingId,cells,occupied,chosen.direction,style.id);
      const bounds16=mergeBoxes16([...cells.map(cellBox16),...placements.map(scenePlacementBounds16)]);
      if(bounds16.some(b=>[0,2].some(a=>b.min[a]<-1000000*16||b.max[a]>(1000000+1)*16))){reject('GARAGE_COORDINATE_LIMIT');continue;}
      if(bounds16.some(b=>obstacles.some(o=>boxesOverlap(b,o)))){reject('GARAGE_INPUT_OBSTRUCTION');continue;}
      if(bounds16.some(b=>garages.some(g=>g.bounds16.some(o=>boxesOverlap(b,o))))){reject('GARAGE_GARAGE_OVERLAP');continue;}
      trace.accepted=true;trace.metrics.buildingId=buildingId;trace.metrics.bays=chosen.edge.length;trace.metrics.direction=chosen.direction;
      trace.metrics.vehicleProof='not-verified';if(!Number.isFinite(chosen.distance))trace.reasonCodes=['GARAGE_LOCAL_NO_ROAD'];
      garages.push({id,areaId:area.id,buildingId,cells,contactFaceIds,doorDirection:chosen.direction,openingCells:chosen.edge,
        bayCount:chosen.edge.length,access:Number.isFinite(chosen.distance)?'road-facing':'local',vehicleProof:'not-verified',placements,bounds16});
      cells.forEach(c=>claimed.add(cellId(c)));
    }
    const remaining=area.cells.filter(c=>!claimed.has(cellId(c)));
    if(remaining.length)openParkingAreas.push({...area,cells:remaining});
    if(candidates.length)traces.push({id:`attached-garages:${area.id}`,ownerId:area.id,ruleId:'attached-garage',ruleVersion:'1.0.0',
      sourceRefs:[{kind:'parking',id:area.id}],readDependencies:['parking:cells','building:ground-walls','scene:roads','scene:objects'],
      selectedIds:candidates.filter(c=>c.accepted).map(c=>c.candidateId),candidates});
  }
  return {garages,openParkingAreas,traces};
}

function createGarageShell(id:string,areaId:string,buildingId:string,cells:Vec3[],occupied:ReadonlySet<string>,doorDirection:WallDirection,styleId:string):ScenePlacement[]{
  const mask=new Set(cells.map(cellId)),output:ScenePlacement[]=[],refs:SourceRef[]=[{kind:'parking',id:areaId}];
  const variant=styleId==='residential-brick'?'Brick':styleId==='residential-red'?'Red':'Cream';
  const wall=variant==='Cream'?'SidingPlainCream':`${variant}Plain`;
  const addMesh=(name:string,center:Vec3,yaw:Heading=0)=>{
    const p:ScenePlacement={id:`${id}:${output.length}`,kind:'parking',asset:`house-kit:SM_${name}`,center,size:[1,1,1],color:'#ffffff',context:'attached-garage',
      planId:id,sourceRefs:refs,yawQuarterTurns:yaw};
    p.worldBounds16=scenePlacementBounds16(p);output.push(p);
  };
  for(const cell of cells){
    addMesh('House_GarageSlab_3m',[cell[0]+.5,-.04,cell[2]+.5]);
    addMesh('Roof_FlatCharcoal_3m',[cell[0]+.5,1,cell[2]+.5]);
    for(const direction of directions){
      const n=BASES[direction].n,neighbor=add(cell,n);
      // A shared wall belongs to the house; interior tile edges have no wall.
      if(mask.has(cellId(neighbor))||occupied.has(cellId(neighbor)))continue;
      const center=faceCenter2(cell,direction).map(n=>n/2) as Vec3;center[1]=0;
      if(direction===doorDirection){
        addMesh(`House_GaragePortal${variant}_3m`,center,headings[direction]);
        addMesh('House_GarageDoorClosedWhite',center,headings[direction]);
      }else addMesh(`House_${wall}_3m`,center,headings[direction]);
    }
  }
  return output;
}
