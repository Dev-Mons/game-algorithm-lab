import data from '../assets/residential/kit.json' with {type:'json'};
import type {Box16, Heading} from './environment-contract';
import {BASES, cellId, faceCenter2, compareCells, type Vec3, type Surface, type Direction} from './analysis';
import type {ScenePlacement} from './scene-inputs';

export interface HouseInstance {asset:string;center:Vec3;size:Vec3;yawQuarterTurns:Heading}
export interface HouseExample {id:string;variant:string;cells:Vec3[];instances:HouseInstance[]}
export const RESIDENTIAL_KIT = data as unknown as {
  version:number;sourceFile:string;metersPerCell:number;
  assets:Record<string,{bounds16:Box16;triangles:number;description:string;pivot:string;sourceMesh:string}>;
  examples:HouseExample[];
};
export const isResidential = (id:string|undefined) => ['residential-cream','residential-red','residential-brick','residential-garage'].includes(id??'');
const key = (name:string) => `house-kit:SM_${name}`;
const headings:Partial<Record<Direction,Heading>> = {PZ:0,PX:1,NZ:2,NX:3};
const wallDirections:Direction[]=['PZ','PX','NZ','NX'];
const signature=(cells:readonly (readonly number[])[])=>cells.map(c=>c.join(',')).sort().join('|');
function rotatePoint(point:readonly number[],turns:number):Vec3 {
  let [x,y,z]=point;
  for(let i=0;i<turns;i++)[x,z]=[z,-x];
  return [x,y,z];
}
function rotateCell(cell:readonly number[],turns:number):Vec3 {
  let [x,y,z]=cell;
  // Cells occupy [n,n+1), so rotating their minimum corner needs the -1.
  for(let i=0;i<turns;i++)[x,z]=[z,-x-1];
  return [x,y,z];
}
function rotateDirection(direction:Direction,turns:number):Direction {
  return direction==='PY'||direction==='NY'?direction:wallDirections[(headings[direction]!+turns)%4];
}
export function houseOrigin(cells:readonly (readonly number[])[]):Vec3 {
  return [0,1,2].map(a=>Math.min(...cells.map(c=>c[a]))) as Vec3;
}
const rotatedExamples=RESIDENTIAL_KIT.examples.flatMap(example=>[0,1,2,3].map(turns=>{
  const rotated=example.cells.map(c=>rotateCell(c,turns)),origin=houseOrigin(rotated);
  const cells=rotated.map(c=>c.map((v,a)=>v-origin[a]) as Vec3).sort(compareCells);
  const instances=example.instances.map(p=>({...p,
    center:rotatePoint(p.center,turns).map((v,a)=>v-origin[a]) as Vec3,
    yawQuarterTurns:(p.yawQuarterTurns+turns)%4 as Heading}));
  return {example:{...example,cells,instances},signature:signature(cells)};
}));
export function matchingHouse(cells:readonly (readonly number[])[],styleId:string):HouseExample|undefined {
  const origin=houseOrigin(cells),input=signature(cells.map(c=>c.map((v,a)=>v-origin[a])));
  return rotatedExamples.find(e=>`residential-${e.example.variant}`===styleId&&e.signature===input)?.example;
}
export function preferredHouseDoor(cells:readonly (readonly number[])[],styleId:string):{cell:Vec3;direction:Direction}|undefined {
  const example=matchingHouse(cells,styleId),door=example?.instances.find(p=>/House_.*(?:Door|GaragePortal).*_3m$/.test(p.asset));
  if(!door)return;
  const origin=houseOrigin(cells),direction=(['PZ','PX','NZ','NX'] as const)[door.yawQuarterTurns],n=BASES[direction].n;
  return {direction,cell:door.center.map((v,a)=>a===1?Math.round(v)+origin[a]:Math.floor(v-n[a]*.5)+origin[a]) as Vec3};
}

/** Build in a canonical footprint frame, then restore world pivots and face IDs.
 * Both observed assemblies and free-volume roofs follow the building's rotation. */
export function planResidential(cells:readonly (readonly number[])[], surfaces:readonly Surface[],styleId:string,
  componentId:string,portalFaces:ReadonlySet<string>=new Set(),coveredWallFaces:ReadonlySet<string>=new Set()):ScenePlacement[] {
  let frame:{turns:number;origin:Vec3;cells:Vec3[];signature:string}|undefined;
  for(let turns=0;turns<4;turns++){
    const rotated=cells.map(c=>rotateCell(c,turns)),origin=houseOrigin(rotated);
    const local=rotated.map(c=>c.map((v,a)=>v-origin[a]) as Vec3).sort(compareCells),id=signature(local);
    if(!frame||id<frame.signature)frame={turns,origin,cells:local,signature:id};
  }
  const {turns,origin,cells:local}=frame!,localToWorld=new Map<string,string>(),localPortals=new Set<string>(),localCovered=new Set<string>();
  const localSurfaces=surfaces.map(s=>{
    const cell=rotateCell(s.cell,turns).map((v,a)=>v-origin[a]) as Vec3,direction=rotateDirection(s.direction,turns);
    const faceId=`${cellId(cell)}|${direction}`;localToWorld.set(faceId,s.faceId);
    if(portalFaces.has(s.faceId))localPortals.add(faceId);
    if(coveredWallFaces.has(s.faceId))localCovered.add(faceId);
    return {...s,cell,direction,faceId};
  }).sort((a,b)=>compareCells(a.cell,b.cell)||(a.direction<b.direction?-1:a.direction>b.direction?1:0));
  const inverse=(4-turns)%4;
  return assembleResidential(local,localSurfaces,styleId,componentId,localPortals,localCovered).map(p=>({...p,
    center:rotatePoint(p.center.map((v,a)=>v+origin[a]),inverse),
    yawQuarterTurns:((p.yawQuarterTurns??0)+inverse)%4 as Heading,
    faceIds:p.faceIds!.map(id=>localToWorld.get(id)!)}));
}

/** Only integral walls, roofs, openings and their edge finishes belong to a
 * volume. The Blender examples also contain props; copying them is not an intent. */
export function isResidentialEnvelopeAsset(asset:string):boolean {
  if(!asset.startsWith('house-kit:SM_'))return false;
  const name=asset.replace('house-kit:SM_','');
  if(name.startsWith('Roof_'))return /^Roof_(?:Slope|Flat|HipCorner|HipCap|RidgeCap|RidgeJoint|ValleyFlashing|ValleyJunction|Gable|EaveOverhang)/.test(name);
  return /^House_(?:(?:Siding|Cream|Red|Brick).*(?:Window|Door|Plain)|(?:Gable|AtticWindowInsert|AtticVentInsert|WindowShutter|CornerTrim|FloorBand|FoundationBand|Gutter|GaragePortal|GarageDoor|GarageSlab))/.test(name);
}

/** Mesh pivots remain authored: walls start at the story base; roofs at wall top. */
function assembleResidential(cells:readonly (readonly number[])[], surfaces:readonly Surface[],styleId:string,
  componentId:string,portalFaces:ReadonlySet<string>,coveredWallFaces:ReadonlySet<string>):ScenePlacement[] {
  const origin=houseOrigin(cells),example=matchingHouse(cells,styleId),result:ScenePlacement[]=[],owned=new Set<string>();
  const garage=styleId==='residential-garage';
  const variant=styleId.endsWith('red')?'Red':styleId.endsWith('brick')?'Brick':'Cream';
  const finish=styleId.endsWith('brick')?'Terracotta':'Charcoal';
  const wallName=(door:boolean)=>garage?(door?'House_GaragePortalCream_3m':'House_SidingPlainCream_3m'):variant==='Cream'?`House_Siding${door?'Door':'Window'}Cream_3m`:`House_${variant}${door?'Door':'Window'}_3m`;
  const plainWall=variant==='Cream'?'House_SidingPlainCream_3m':`House_${variant}Plain_3m`;
  const add=(instance:HouseInstance,faceIds:string[]=[])=>{
    if(!RESIDENTIAL_KIT.assets[instance.asset])throw new Error(`MISSING_RESIDENTIAL_ASSET:${instance.asset}`);
    faceIds.forEach(id=>owned.add(id));
    result.push({...instance,id:`house:${componentId}:${result.length}`,kind:'building',componentId,
      faceIds,color:'#ffffff',context:example?'blender-assembly':'residential-envelope'});
  };
  const at=(name:string,center:Vec3,yaw:Heading=0,size:Vec3=[1,1,1],faces:string[]=[])=>add({asset:key(name),center,size,yawQuarterTurns:yaw},faces);
  const walls=surfaces.filter(s=>s.role==='wall');
  const wallMap=new Map(walls.map(s=>[s.faceId,s]));
  if(example){
    for(const p of example.instances){
      if(!isResidentialEnvelopeAsset(p.asset))continue;
      const instance={...p,center:p.center.map((v,a)=>v+origin[a]) as Vec3,size:[...p.size] as Vec3};
      if(/House_.*(?:Window|Door|Plain|GaragePortal).*_3m$/.test(p.asset)){
        const direction=(['PZ','PX','NZ','NX'] as const)[p.yawQuarterTurns],n=BASES[direction].n;
        const cell=instance.center.map((v,a)=>a===1?Math.round(v):Math.floor(v-n[a]*.5)) as Vec3;
        const id=`${cellId(cell)}|${direction}`;
        if(!wallMap.has(id))continue;
        if(coveredWallFaces.has(id))instance.asset=key(plainWall);
        else if(portalFaces.has(id))instance.asset=garage&&p.asset.includes('GaragePortal')?p.asset:key(wallName(true));
        else if(p.asset.includes('Door')&&!p.asset.includes('Garage'))instance.asset=key(wallName(false));
        add(instance,[id]);
      }else{
        if(p.asset.includes('WindowShutter')){
          const direction=wallDirections[p.yawQuarterTurns],n=BASES[direction].n;
          const cell=instance.center.map((v,a)=>Math.floor(v-(a===1?0:n[a]*.5))) as Vec3;
          if(coveredWallFaces.has(`${cellId(cell)}|${direction}`))continue;
        }
        if(p.asset.endsWith('House_GarageSlab_3m')){
          const bottom=surfaces.find(s=>s.direction==='NY'&&s.cell[0]===Math.floor(instance.center[0])&&s.cell[2]===Math.floor(instance.center[2])&&s.cell[1]===Math.round(instance.center[1]));
          add(instance,bottom&&!owned.has(bottom.faceId)?[bottom.faceId]:[]);continue;
        }
        const top=surfaces.find(s=>s.direction==='PY'&&s.cell[0]===Math.floor(instance.center[0])&&s.cell[2]===Math.floor(instance.center[2])&&s.cell[1]+1===Math.round(instance.center[1]));
        const owns=top&&!owned.has(top.faceId)&&/Roof_(Slope|HipCorner|ValleyJunction|Flat|GableNarrow)/.test(p.asset)?[top.faceId]:[];
        add(instance,owns);
      }
    }
  }
  for(const s of walls){
    const center=faceCenter2(s.cell,s.direction).map(n=>n/2) as Vec3;center[1]=s.cell[1];
    const yaw=headings[s.direction]!;
    const name=s.architecture?.interpretation==='unsupported'||coveredWallFaces.has(s.faceId)?plainWall:wallName(portalFaces.has(s.faceId));
    if(!owned.has(s.faceId))at(name,center,yaw,[1,1,1],[s.faceId]);
    if(!example){
      if(s.cell[1]===origin[1])at('House_FoundationBand_3m',center,yaw);
      else at('House_FloorBandWhite_3m',center,yaw);
    }
    if(portalFaces.has(s.faceId)){
      if(garage&&!example)at('House_GarageDoorClosedSage',center,yaw);
    }
  }
  // Partition exposed tops into two-cell gable strips. This keeps concave holes,
  // setbacks and overhangs editable; observed cross-gable/hip joins use the recipe above.
  const tops=surfaces.filter(s=>s.direction==='PY'&&!owned.has(s.faceId));
  if(garage)for(const s of tops)at('Roof_FlatCharcoal_3m',[s.cell[0]+.5,s.cell[1]+1,s.cell[2]+.5],0,[1,1,1],[s.faceId]);
  const remaining=new Map(tops.map(s=>[cellId(s.cell),s]));
  if(garage)remaining.clear();
  for(const s of tops){
    if(!remaining.has(cellId(s.cell)))continue;
    const [x,y,z]=s.cell;
    const width=remaining.has(cellId([x+1,y,z]))?2:1;
    let length=1;
    while(Array.from({length:width},(_,i)=>remaining.has(cellId([x+i,y,z+length]))).every(Boolean))length++;
    const half=width/2,ridge=x+half,height=y+1;
    for(let j=0;j<length;j++){
      const faces=Array.from({length:width},(_,i)=>remaining.get(cellId([x+i,y,z+j]))!);
      faces.forEach(f=>remaining.delete(cellId(f.cell)));
      at(`Roof_Slope${finish}_3m`,[x+half/2,height,z+j+.5],0,[half,half,1],[faces[0].faceId]);
      at(`Roof_Slope${finish}_3m`,[x+width-half/2,height,z+j+.5],2,[half,half,1],width===2?[faces[1].faceId]:[]);
      at(`Roof_RidgeCap${finish}_3m`,[ridge,height+1.6/3*half,z+j+.5]);
    }
    for(const [plane,yaw] of [[z,2],[z+length,0]] as [number,Heading][]){
      // Paired attic skins retain the real opening and its insert from Blender.
      const left=yaw===0?x+half/2:x+width-half/2,right=yaw===0?x+width-half/2:x+half/2;
      at(`House_GableAttic${variant}Left_3m`,[left,height,plane],yaw,[half,half,1]);
      at(`House_GableAttic${variant}Right_3m`,[right,height,plane],yaw,[half,half,1]);
      at('House_AtticWindowInsert',[ridge,height+.2*half,plane],yaw,[half,half,1]);
    }
  }
  for(const s of surfaces)if(!owned.has(s.faceId)){
    // The authored slab closes undersides, including raised volumes. Top skins
    // are assigned above, so a slab never substitutes for an unsupported roof.
    if(s.direction!=='NY')throw new Error(`MISSING_RESIDENTIAL_FACE:${s.faceId}`);
    at('House_GarageSlab_3m',[s.cell[0]+.5,s.cell[1],s.cell[2]+.5],0,[1,1,1],[s.faceId]);
  }
  return result;
}
