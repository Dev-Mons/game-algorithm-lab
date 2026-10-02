import {compareCells,type Vec3} from './analysis';
import type {GenerationDocument} from './document';
import {HEADING_VECTORS,type DecisionTrace,type Heading} from './environment-contract';
import {ENVIRONMENT} from './environment-settings';
import type {ScenePlacement} from './scene-inputs';

/** A connected sidewalk patch. Islands are derived from roads, never painted as a separate kind. */
export interface SidewalkComponent {
  id:string;kind:'sidewalk'|'island';cells:Vec3[];
  /** Headings (HEADING_VECTORS) on which at least one cell meets a road. */
  roadSides:Heading[];roadEdges:number;openEdges:number;covered:boolean;reasonCodes:string[];
}
export interface SidewalkAnalysis {components:SidewalkComponent[]}
const key=(x:number,z:number)=>`${x},${z}`;
const SETTINGS=ENVIRONMENT.sidewalks,SURFACE_TOP=SETTINGS.surfaceTop16/16;
interface Indexed {analysis:SidewalkAnalysis;kinds:Map<string,SidewalkComponent['kind']>;visible:Set<string>}
const cache=new WeakMap<GenerationDocument['sceneInputs'],Indexed>();

function longestRun(cells:Vec3[],axis:0|2){
  const lines=new Map<number,number[]>();
  for(const c of cells){const line=c[2-axis],list=lines.get(line)??[];list.push(c[axis]);lines.set(line,list);}
  let best=0;
  for(const list of lines.values()){list.sort((a,b)=>a-b);let run=1;best=Math.max(best,1);for(let i=1;i<list.length;i++){run=list[i]===list[i-1]+1?run+1:1;best=Math.max(best,run);}}
  return best;
}
function index(document:GenerationDocument):Indexed {
  const hit=cache.get(document.sceneInputs);if(hit)return hit;
  const {sidewalks,roads,parkingAreas}=document.sceneInputs;
  const mask=new Map(sidewalks.map(c=>[key(c[0],c[2]),c] as const)),road=new Set(roads.map(c=>key(c[0],c[2])));
  // Buildings and parking stand on the pavement; their footprint hides it and is never an island.
  const covering=new Set([...document.grid.filter(c=>c[1]===0),...parkingAreas.flatMap(p=>p.cells)].map(c=>key(c[0],c[2])));
  const components:SidewalkComponent[]=[],remaining=new Set(mask.keys());
  for(const root of [...sidewalks].sort(compareCells)){
    if(!remaining.delete(key(root[0],root[2])))continue;
    const cells=[root],sides=new Set<Heading>();let roadEdges=0,openEdges=0;
    for(let i=0;i<cells.length;i++)for(const [h,d] of HEADING_VECTORS.entries()){
      const x=cells[i][0]+d[0],z=cells[i][2]+d[2],id=key(x,z);
      if(mask.has(id)){if(remaining.delete(id))cells.push(mask.get(id)!);continue;}
      if(road.has(id)){roadEdges++;sides.add(h as Heading);}else openEdges++;
    }
    cells.sort(compareCells);
    const covered=cells.some(c=>covering.has(key(c[0],c[2])));
    const betweenX=sides.has(1)&&sides.has(3)&&longestRun(cells,0)<=SETTINGS.islandMaxRunCells;
    const betweenZ=sides.has(0)&&sides.has(2)&&longestRun(cells,2)<=SETTINGS.islandMaxRunCells;
    const [kind,reason]:[SidewalkComponent['kind'],string]=!roadEdges?['sidewalk','NO_ROAD_EDGE']:covered?['sidewalk','COVERED_BY_BUILDING_OR_PARKING']
      :!openEdges&&cells.length<=SETTINGS.islandMaxEnclosedCells?['island','ENCLOSED_BY_ROADS']
      :betweenX||betweenZ?['island','BETWEEN_ROADS']:!openEdges?['sidewalk','ENCLOSED_BLOCK_TOO_LARGE']:['sidewalk','ROADSIDE_SIDEWALK'];
    components.push({id:`sidewalk:${root[0]},${root[2]}`,kind,cells,roadSides:[...sides].sort(),roadEdges,openEdges,covered,reasonCodes:[reason]});
  }
  const kinds=new Map(components.flatMap(c=>c.cells.map(cell=>[key(cell[0],cell[2]),c.kind] as const)));
  const visible=new Set([...mask.keys()].filter(id=>!covering.has(id)));
  const value={analysis:{components},kinds,visible};cache.set(document.sceneInputs,value);return value;
}
export const analyzeSidewalks=(document:GenerationDocument)=>index(document).analysis;
/** Ground cells on a derived traffic island read as a median for objects and fixtures. */
export const isIslandCell=(document:GenerationDocument,cell:Vec3)=>cell[1]===0&&index(document).kinds.get(key(cell[0],cell[2]))==='island';
/** Presentation lift for a ground object standing on visible pavement. Semantic cells and reservations stay at Y=0. */
export const sidewalkSurfaceOffset=(document:GenerationDocument,cell:Vec3)=>cell[1]===0&&index(document).visible.has(key(cell[0],cell[2]))?SURFACE_TOP:0;

export function sidewalkTraces(document:GenerationDocument):DecisionTrace[] {
  return index(document).analysis.components.map(c=>({id:`sidewalk-landscape:${c.id}`,ownerId:'sidewalks',ruleId:'sidewalk-landscape',ruleVersion:'1.0.0',
    sourceRefs:[{kind:'sidewalk',id:'sidewalks'},...(c.roadEdges?[{kind:'road' as const,id:'roads'}]:[])],readDependencies:['scene:sidewalks','scene:roads','grid:occupancy','scene:parking'],
    selectedIds:[c.id],candidates:[{candidateId:c.id,accepted:true,reasonCodes:c.reasonCodes,metrics:{kind:c.kind,cells:c.cells.length,roadEdges:c.roadEdges,openEdges:c.openEdges,roadSides:c.roadSides.join(',')},conflictIds:[]}]}));
}
/** Pavement slabs with curbs toward roads; islands get a curb ring and a planted bed. */
export function sidewalkPlacements(document:GenerationDocument):ScenePlacement[] {
  const {analysis,visible}=index(document),road=new Set(document.sceneInputs.roads.map(c=>key(c[0],c[2]))),out:ScenePlacement[]=[];
  const make=(c:SidewalkComponent,id:string,asset:string,center:Vec3,size:Vec3,color:string)=>out.push({id,kind:'sidewalk',asset,center,size,color,context:c.kind,planId:c.id,sourceRefs:[{kind:'sidewalk',id:'sidewalks'}]});
  for(const c of analysis.components){
    const own=new Set(c.cells.map(cell=>key(cell[0],cell[2])));
    for(const cell of c.cells){
      const [x,,z]=cell,id=`${c.id}|${x},${z}`;if(!visible.has(key(x,z)))continue;
      const edges=HEADING_VECTORS.map(d=>key(x+d[0],z+d[2])).map(n=>own.has(n)?'inside':road.has(n)?'road':'open');
      if(c.kind==='island'){
        make(c,`${id}|base`,'sidewalk.island-base',[x+.5,SURFACE_TOP/2,z+.5],[1,SURFACE_TOP,1],'#a9aba0');
        // The bed is inset from every outer edge so a 1-cell median keeps a curb on both sides.
        const inset=(h:number)=>edges[h]==='inside'?0:.14,x0=x+inset(3),x1=x+1-inset(1),z0=z+inset(2),z1=z+1-inset(0);
        make(c,`${id}|planting`,'sidewalk.island-planting',[(x0+x1)/2,SURFACE_TOP+1/128,(z0+z1)/2],[x1-x0,1/64,z1-z0],'#6e8f52');
      }else make(c,`${id}|paving`,'sidewalk.paving',[x+.5,SURFACE_TOP/2,z+.5],[1,SURFACE_TOP,1],(x+z)%2===0?'#bdbab1':'#b4b1a7');
      for(const [h,edge] of edges.entries()){
        if(edge==='inside'||c.kind==='sidewalk'&&edge!=='road')continue;
        const d=HEADING_VECTORS[h],along=d[0]===0,height=c.kind==='island'?3/16:SURFACE_TOP+1/64;
        make(c,`${id}|curb:${h}`,c.kind==='island'?'sidewalk.island-curb':'sidewalk.curb',[x+.5+d[0]*.43,height/2,z+.5+d[2]*.43],along?[1,height,.14]:[.14,height,1],c.kind==='island'?'#dcdacf':'#cfccc2');
      }
    }
  }
  return out;
}
