import {expect,it} from 'vitest';
import {createDocument,replaceGrid,replaceSceneInputs,loadDocument,exportDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs,type ObjectInput} from '../src/core/scene-inputs';
import {planWallFacilities} from '../src/core/wall-facilities';
import {ReservationBook} from '../src/core/reservations';
import {FACILITY_KINDS,WALL_FACILITY_ASSETS} from '../src/core/wall-facility-assets';
import {WallFacilityGeometryLibrary} from '../src/wall-facility-geometry';
import {COLUMN_ASSETS} from '../src/core/column-prototype';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {DocumentHistory} from '../src/editor';
import {editObjects} from '../src/scene-editor';
import {box} from '../src/fixtures';
import {BASES,type Vec3} from '../src/core/analysis';

const facility=(kind:ObjectInput['facilityKind'],width=3,height=3):ObjectInput=>({id:'installation',category:'facility',facilityKind:kind,direction:'PZ',cells:box(width,height,1).map(([x,y])=>[x+2,y+2,4])});
it.each(FACILITY_KINDS)('priority 4: %s has complete single/horizontal/vertical assemblies without changing ordinary facade',kind=>{
  for(const [w,h] of [[1,1],[3,1],[1,3],[3,3]]){
    const base=createDocument(box(8,8,4),17,'urban-shop'),doc=replaceSceneInputs(base,{...emptySceneInputs(),objects:[facility(kind,w,h)]}),r=generateDocument(doc),p=r.environment!.wallFacilities!;
    expect(p.groups[0].accepted,p.groups[0].reason).toBe(true);expect(p.placements).toHaveLength(w*h);expect(p.changes).toEqual([]);expect(r.placements).toEqual(generateDocument(base).placements);
    expect(r.environment!.reservations.filter(r=>r.ownerId==='installation')).toHaveLength(w*h);
    expect(r.environment!.fixtures!.placements).toEqual([]);expect(generateDocument(loadDocument(exportDocument(doc)),{cache:false})).toEqual(r);
  }
});

it('priority 4: approved solid-wall requests, protected clearance and support loss commit or reject the entire group',()=>{
  const base=createDocument(box(8,8,4),17,'urban-shop'),input={...facility('balcony'),facadeRequest:'solid' as const},doc=replaceSceneInputs(base,{...emptySceneInputs(),objects:[input]}),r=generateDocument(doc),p=r.environment!.wallFacilities!;
  expect(p.changes).toHaveLength(9);for(const f of p.changes)expect(r.traces.find(t=>t.faceId===f.faceId)?.facade?.patternId).toBe('approved-facility-wall');
  const book=new ReservationBook([...r.environment!.spatial!.staticReservations,{id:'protected-path',ownerId:'path',sourceRefs:[],kind:'walk',priority:700,cells:[],boxes16:[p.reservations[0].boxes16[0]]}]);
  const denied=planWallFacilities(doc,r.surfaces,r.environment!.vertical!,new Set(),book);expect(denied.groups[0].reason).toBe('PROTECTED_SPACE_CONFLICT');expect(denied.changes).toEqual([]);expect(denied.placements).toEqual([]);expect(book.snapshot().some(x=>x.ownerId===input.id)).toBe(false);
  const portalDenied=planWallFacilities(doc,r.surfaces,r.environment!.vertical!,new Set([p.changes[0].faceId]),new ReservationBook());expect(portalDenied.groups[0].reason).toBe('PROTECTED_PORTAL');expect(portalDenied.reservations).toEqual([]);
  const lost=replaceGrid(doc,doc.grid.filter(c=>c.join(',')!=='2,2,3')),lostResult=generateDocument(lost);expect(lost.sceneInputs.objects).toEqual(doc.sceneInputs.objects);expect(lostResult.environment!.wallFacilities!.groups[0].reason).toBe('NO_WALL_SUPPORT');expect(lostResult.environment!.wallFacilities!.changes).toEqual([]);
  const restored=replaceSceneInputs(doc,emptySceneInputs());expect(generateDocument(restored).placements).toEqual(generateDocument(base).placements);
  const history=new DocumentHistory(base);history.commit(doc);expect(history.undo()).toEqual(base);expect(history.redo()).toEqual(doc);
});
it('priority 4: actual road-access portals remain authoritative over new facility intents',()=>{
  const scene=emptySceneInputs();scene.roads=box(10,1,1).map(([x,y])=>[x,y,6]);const base=createDocument(box(10,8,4),17,'urban-shop',undefined,undefined,scene),a=generateDocument(base),portal=a.environment!.entrances![0].entrances[0];expect(portal).toBeDefined();
  const surface=a.surfaces.find(s=>s.faceId===portal.faceIds[0])!,normal=BASES[surface.direction].n;
  const input:ObjectInput={id:'portal-conflict',category:'facility',facilityKind:'balcony',facadeRequest:'solid',direction:surface.direction,cells:[surface.cell.map((n,i)=>n+normal[i]) as Vec3]};
  const r=generateDocument(replaceSceneInputs(base,{...scene,objects:[input]}));expect(r.environment!.wallFacilities!.groups[0]).toMatchObject({accepted:false,reason:'PROTECTED_PORTAL'});expect(r.environment!.entrances).toEqual(a.environment!.entrances);expect(r.placements).toEqual(a.placements);
});

it('priority 4: facility directions, resize and deletion preserve authored kind and wall intent',()=>{
  const base=createDocument(box(8,8,4),17,'urban-office'),options={facilityKind:'elevator' as const,facadeRequest:'solid' as const};
  let doc=editObjects(base,{direction:'PZ',cells:[[2,2,3]]},'facility','add',options).document;
  doc=editObjects(doc,{direction:'PZ',cells:[[3,2,3]]},'facility','add',options).document;
  expect(doc.sceneInputs.objects).toHaveLength(1);expect(doc.sceneInputs.objects[0]).toMatchObject(options);expect(generateDocument(doc).environment!.wallFacilities!.placements).toHaveLength(2);
  doc=editObjects(doc,{direction:'PZ',cells:[[2,2,4]]},'facility','remove',options).document;expect(doc.sceneInputs.objects[0]).toMatchObject(options);expect(generateDocument(doc).environment!.wallFacilities!.placements).toHaveLength(1);
  for(const direction of ['PX','NX','PZ','NZ'] as const){const host:Vec3=direction==='PX'?[7,3,1]:direction==='NX'?[0,3,1]:direction==='PZ'?[3,3,3]:[3,3,0];const input={...facility('fire-escape',1,1),direction,cells:[host.map((n,i)=>n+BASES[direction].n[i]) as Vec3]};expect(generateDocument(replaceSceneInputs(base,{...emptySceneInputs(),objects:[input]})).environment!.wallFacilities!.placements).toHaveLength(1);}
});

it('priority 4: ambiguous narrow buildings stay buildings; explicit and slab-supported columns keep original cells and face ownership',()=>{
  const narrow=createDocument(box(1,5,1),3,'urban-office'),normal=generateDocument(narrow);expect(normal.environment!.columns![0].faces).toEqual([]);expect(normal.environment!.columns![0].runs[0].reason).toBe('AMBIGUOUS_NARROW_BUILDING');
  for(const cells of [box(1,1,1),box(1,5,1),[...box(3,1,3),...[1,2,3,4].map(y=>[1,y,1] as Vec3)], [...box(3,1,3),...[1,2,3].map(y=>[1,y,1] as Vec3),...box(3,1,3).map(([x,,z])=>[x,4,z] as Vec3)]]){
    const doc=createDocument(cells,3,'urban-office');doc.buildings[0].design.columnMode='column';const r=generateDocument(doc),columns=r.environment!.columns![0];expect(columns.faces.length).toBeGreaterThan(0);expect(r.cells).toEqual(doc.grid);expect(new Set(r.placements.map(p=>p.faceId)).size).toBe(r.surfaces.length);
    for(const face of columns.faces){const p=r.placements.find(p=>p.faceId===face.faceId)!;expect(p.faceAssetKey).toContain(face.assetKey);expect(p.finishIds).toEqual([]);expect(p.tileId).not.toContain('rooftop');}
    expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(r);
  }
  const supported=createDocument([...box(3,1,3),...[1,2,3,4].map(y=>[1,y,1] as Vec3)],3,'urban-office');expect(generateDocument(supported).environment!.columns![0].runs[0]).toMatchObject({accepted:true,bottom:'slab',top:'free'});
  const branch=replaceGrid(supported,[...supported.grid,[2,2,1]]);expect(generateDocument(branch).environment!.columns![0].faces.some(f=>f.faceId.startsWith('1,2,1|'))).toBe(false);
});

it('priority 4: all authored facility and column geometries fit declared bounds and share prototypes',()=>{
  const library=new WallFacilityGeometryLibrary();
  for(const [key,asset] of Object.entries({...WALL_FACILITY_ASSETS,...COLUMN_ASSETS})){
    const g=key.startsWith('wall-facility.')?library.get(key)!:buildCraftedGeometry(key),p=g.getAttribute('position');expect(p.count).toBeGreaterThan(0);
    for(let i=0;i<p.count;i++)for(let a=0;a<3;a++){expect(p.getComponent(i,a)*16,key).toBeGreaterThanOrEqual(asset.bounds16.min[a]-1e-5);expect(p.getComponent(i,a)*16,key).toBeLessThanOrEqual(asset.bounds16.max[a]+1e-5);}
    if(key.startsWith('wall-facility.'))expect(library.get(key)).toBe(g);else g.dispose();
  }library.dispose();
});
