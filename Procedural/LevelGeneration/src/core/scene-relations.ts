import { add, BASES, cellId, compareCells, type Direction, type Surface, type Vec3 } from './analysis';
import { cloneJSON, immutableJSON } from './canonical';
import type { GenerationDocument } from './document';
import type { Heading, SourceRef } from './environment-contract';
import type { VolumeAnalysis } from './regions';
import type { ObjectContext, ObjectInput } from './scene-inputs';
import type { VerticalPlan } from './vertical-design';
import { analyzeRoads, isRoadJunction, type RoadModule } from './roads';
import type { SpatialAnalysis } from './spatial-analysis';

const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const columnKey = (c: Vec3) => `${c[0]},${c[2]}`;
const compatibleKey = (o: ObjectInput) => `${o.category}:${o.direction}:${o.facilityKind === 'auto' ? '' : o.facilityKind ?? ''}:${o.facadeRequest ?? ''}`;
const refs = (values: SourceRef[]): SourceRef[] => [...new Map(values.map(r => [`${r.kind}:${r.id}`, r])).values()].sort((a,b) => ascii(a.kind,b.kind) || ascii(a.id,b.id));
const horizontal: Vec3[] = [[0,0,1],[1,0,0],[0,0,-1],[-1,0,0]];

export interface SurfaceRelation {
  faceId: string; supportOwner: string; role: Surface['role']; wallKind?: Surface['wallKind'];
  regionId?: string; interpretation?: string; massScopeIds: string[]; zoneIds: string[]; boundaryIds: string[];
}
export interface SupportRelation {
  id: string; category: ObjectInput['category']; direction: Direction; cell: Vec3; cells: Vec3[];
  sourceRefs: SourceRef[]; support: 'ground'|'roof'|'wall'; context: ObjectContext;
  accepted: boolean; reasonCodes: string[]; surface?: SurfaceRelation;
  boundaryRunIds?: string[];
  coveredBy?: { cell: Vec3; faceId?: string; supportOwner?: string };
  readDependencies: string[];
}
export interface IntentColumn { height: number; minY: number; maxY: number }

/** Execution-local source facts. No generated geometry, mutable reservations or global cache. */
export class SupportIndex {
  readonly records: readonly SupportRelation[];
  private readonly byCell = new Map<string, SupportRelation>();
  private readonly columns = new Map<string, IntentColumn>();
  private readonly owners = new Map<string, ObjectInput>();
  private readonly faces: Map<string, Surface>;
  private readonly surfaceLinks = new Map<string, SurfaceRelation>();
  private readonly objects: Map<string, ObjectInput>;

  constructor(document: GenerationDocument, analysis: Pick<VolumeAnalysis,'surfaces'>, vertical: readonly VerticalPlan[] = []) {
    this.faces = new Map(analysis.surfaces.map(s => [s.faceId,s]));
    this.objects = new Map(document.sceneInputs.objects.map(o => [o.id,o]));
    const occupied = new Set(document.grid.map(cellId)), roads = new Set(document.sceneInputs.roads.map(cellId));
    const overhead = new Map<string,Vec3[]>(), scopes = new Map<string,string[]>(), zones = new Map<string,string[]>(), boundaries = new Map<string,string[]>();
    for (const c of document.grid) { const key=columnKey(c), cells=overhead.get(key)??[]; cells.push(c); overhead.set(key,cells); }
    for (const cells of overhead.values()) cells.sort(compareCells);
    for (const v of vertical) {
      for (const scope of v.mass?.scopes??[]) for (const key of scope.columns) { const id=`${v.buildingId}|${key}`, ids=scopes.get(id)??[]; ids.push(scope.id); scopes.set(id,ids); }
      for (const z of v.zones??[]) for (const id of z.faceIds) { const ids=zones.get(id)??[]; ids.push(z.id); zones.set(id,ids); }
      for (const b of v.boundaries) { const ids=boundaries.get(b.hostFaceId)??[]; ids.push(b.id); boundaries.set(b.hostFaceId,ids); }
    }
    for (const s of analysis.surfaces) this.surfaceLinks.set(s.faceId, immutableJSON({
      faceId:s.faceId,supportOwner:s.componentId,role:s.role,...(s.wallKind?{wallKind:s.wallKind}:{}),
      ...(s.architecture?{regionId:s.architecture.regionId,interpretation:s.architecture.interpretation}:{}),
      massScopeIds:[...(scopes.get(`${s.componentId}|${columnKey(s.cell)}`)??[])], zoneIds:[...(zones.get(s.faceId)??[])], boundaryIds:[...(boundaries.get(s.faceId)??[])],
    }));
    const groups = new Map<string, Map<string,Vec3>>();
    for (const o of document.sceneInputs.objects) {
      const key=compatibleKey(o), cells=groups.get(key)??new Map<string,Vec3>();
      for (const c of o.cells) { cells.set(cellId(c),c); this.owners.set(cellId(c),o); }
      groups.set(key,cells);
    }
    const records:SupportRelation[]=[];
    for (const cells of groups.values()) {
      const ordered=[...cells.values()].sort(compareCells), input=this.owners.get(cellId(ordered[0]))!, normal=BASES[input.direction].n;
      // A rectangular editor fragment is not a semantic height boundary.
      for (const root of ordered) if (!cells.has(cellId(add(root,[0,-1,0])))) {
        const run:Vec3[]=[]; let c=root;
        while (cells.has(cellId(c))) { run.push(c); c=add(c,[0,1,0]); }
        const column=immutableJSON({height:run.length,minY:root[1],maxY:c[1]-1});
        for (const member of run) this.columns.set(cellId(member),column);
      }
      for (const root of ordered) {
        const behind=normal.map(n=>-n) as Vec3;
        if (cells.has(cellId(add(root,behind)))) continue;
        const run:Vec3[]=[]; let c=root;
        while (cells.has(cellId(c))) { run.push(c); c=add(c,normal); }
        const hostId=`${cellId(add(root,behind))}|${input.direction}`, host=this.faces.get(hostId);
        const support=input.direction==='PY'?(root[1]===0?'ground':'roof'):'wall';
        const adjacent=horizontal.map(d=>roads.has(cellId(add(root,d))));
        const context:ObjectContext=support==='ground'?(adjacent[0]&&adjacent[2]||adjacent[1]&&adjacent[3]?'median':adjacent.some(Boolean)?'roadside':'ground'):support;
        const reason=input.direction==='NY'?'UNSUPPORTED_MOUNT_DIRECTION':run.some(c=>occupied.has(cellId(c)))?'OBJECT_BUILDING_OVERLAP':support==='wall'&&input.category==='vegetation'?'UNSUPPORTED_WALL_CATEGORY':support!=='ground'&&!host?(support==='wall'?'NO_WALL_SUPPORT':'NO_SUPPORTED_SURFACE'):undefined;
        const cover=overhead.get(columnKey(root))?.find(c=>c[1]>=root[1]), underside=cover?this.faces.get(`${cellId(cover)}|NY`):undefined;
        const sources=refs([...run.map(c=>({kind:'object' as const,id:this.owners.get(cellId(c))!.id})),...(host?[{kind:'building' as const,id:host.componentId}]:[]),...(underside?[{kind:'building' as const,id:underside.componentId}]:[])]);
        const record=immutableJSON(cloneJSON({
          id:`support:${input.category}:${input.direction}:${cellId(root)}`,category:input.category,direction:input.direction,cell:root,cells:run,sourceRefs:sources,support,context,
          accepted:!reason,reasonCodes:[reason??(support==='ground'?'GROUND_SUPPORT':'EXPOSED_SURFACE_SUPPORT')],
          ...(host?{surface:this.surfaceLinks.get(hostId)!}:{}),
          ...(cover?{coveredBy:{cell:cover,...(underside?{faceId:underside.faceId,supportOwner:underside.componentId}:{})}}:{}),
          readDependencies:['grid:occupancy','analysis:exterior',...(host?['analysis:regions',`vertical:${host.componentId}`]:[]),`intent:${compatibleKey(input)}`,'scene:roads'],
        } satisfies SupportRelation));
        records.push(record); for (const member of run) this.byCell.set(cellId(member),record);
      }
    }
    this.records=immutableJSON(records.sort((a,b)=>compareCells(a.cell,b.cell)||ascii(a.id,b.id)));
  }
  at(cell:Vec3):SupportRelation|undefined { return this.byCell.get(cellId(cell)); }
  columnAt(cell:Vec3):IntentColumn|undefined { return this.columns.get(cellId(cell)); }
  ownerAt(cell:Vec3):ObjectInput|undefined { return this.owners.get(cellId(cell)); }
  face(id:string):Surface|undefined { return this.faces.get(id); }
  forObject(id:string):SupportRelation[] {
    return [...new Set(this.objects.get(id)?.cells.map(c=>this.at(c)!)??[])];
  }
  validCells(input:ObjectInput):Vec3[] { return input.cells.filter(c=>this.at(c)?.accepted); }
  automaticWallKind(cell:Vec3):'balcony'|'fire-escape'|'elevator' {
    const column=this.columnAt(cell)!;
    return column.height===1?'balcony':column.minY===0?'elevator':'fire-escape';
  }
}

export interface RoadRelation {
  module: RoadModule; frontageIds: string[]; arrivalNodeIds: string[];
  sourceRefs: SourceRef[]; readDependencies: string[];
}
export interface RoadContext {
  distanceCells?: number; heading?: Heading; moduleId?: string; frontageIds: string[]; junctionIds: string[];
}
export interface RelationView { supports: readonly SupportRelation[]; roads: readonly RoadRelation[] }

/** Adds already-computed spatial boundaries without feeding later access decisions into preflight. */
export class SceneRelationIndex {
  readonly view: RelationView;
  private readonly modulesByCell = new Map<string,RoadRelation>();
  private readonly roadCells:Vec3[];
  private readonly junctionCells:{cell:Vec3;id:string}[];
  private readonly roadsAt = new Map<string,RoadContext>();
  constructor(readonly support:SupportIndex, document:GenerationDocument, spatial:SpatialAnalysis) {
    this.roadCells=document.sceneInputs.roads;
    const frontages=new Map<string,string[]>(),arrivals=new Map<string,string[]>();
    for (const run of spatial.roadFrontages) for (const c of run.cells) { const key=cellId(c),ids=frontages.get(key)??[];ids.push(run.id);frontages.set(key,ids); }
    for (const arrival of spatial.roadArrivals) { const key=cellId(arrival.roadCell),ids=arrivals.get(key)??[];ids.push(arrival.nodeId);arrivals.set(key,ids); }
    const roads=analyzeRoads(this.roadCells).map(module=>immutableJSON({
      module,frontageIds:[...new Set(module.cells.flatMap(c=>frontages.get(cellId(c))??[]))].sort(ascii),
      arrivalNodeIds:[...new Set(module.cells.flatMap(c=>arrivals.get(cellId(c))??[]))].sort(ascii),
      sourceRefs:[{kind:'road' as const,id:'roads'}],readDependencies:['scene:roads','spatial:roadFrontages','spatial:roadArrivals'],
    }));
    for (const r of roads) for (const c of r.module.cells) this.modulesByCell.set(cellId(c),r);
    this.junctionCells=roads.filter(r=>isRoadJunction(r.module)).flatMap(r=>r.module.cells.map(cell=>({cell,id:r.module.id})));
    const runsByFace=new Map<string,string[]>();
    for(const run of spatial.buildingRuns)for(const c of run.cells){const id=`${cellId(c)}|${run.direction}`,ids=runsByFace.get(id)??[];ids.push(run.id);runsByFace.set(id,ids);}
    this.view=Object.freeze({supports:immutableJSON(support.records.map(r=>({...r,boundaryRunIds:r.surface?[...(runsByFace.get(r.surface.faceId)??[])]:[]}))),roads:Object.freeze(roads)});
  }
  roadModuleAt(cell:Vec3):RoadRelation|undefined { return this.modulesByCell.get(cellId(cell)); }
  roadAt(cell:Vec3,junctionRadius:number):RoadContext {
    const key=`${cellId(cell)}:${junctionRadius}`,hit=this.roadsAt.get(key);if(hit)return hit;
    const distance=(c:Vec3)=>c[1]===cell[1]?Math.abs(c[0]-cell[0])+Math.abs(c[2]-cell[2]):Infinity;
    let nearest:Vec3|undefined,best=Infinity;
    for (const c of this.roadCells) { const d=distance(c);if(d<best||d===best&&nearest&&compareCells(c,nearest)<0){nearest=c;best=d;} }
    const relation=nearest?this.modulesByCell.get(cellId(nearest)):undefined;
    const heading=nearest?horizontal.map((d,h)=>({h,score:d[0]*(cell[0]-nearest![0])+d[2]*(cell[2]-nearest![2])})).sort((a,b)=>b.score-a.score||a.h-b.h)[0].h as Heading:undefined;
    const result=immutableJSON({...(nearest?{distanceCells:best,heading,moduleId:relation!.module.id}:{}),frontageIds:relation?[...relation.frontageIds]:[],junctionIds:[...new Set(this.junctionCells.filter(c=>distance(c.cell)<=junctionRadius).map(c=>c.id))].sort(ascii)});
    this.roadsAt.set(key,result);return result;
  }
}
