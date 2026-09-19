import { expect, it } from 'vitest';
import { DoubleSide, InstancedMesh, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { createDocument, exportDocument, loadDocument } from '../src/core/document';
import { generateDocument } from '../src/core/generate-document';
import { box, FIXTURES } from '../src/fixtures';
import { completeFaceAsset, selectCompleteFaceAsset } from '../src/core/complete-face-assets';
import { faceAssetBounds, faceBounds16, containedInUnion } from '../src/core/placement-bounds';
import { CraftedGeometryLibrary } from '../src/crafted-geometry';
import { createFaceMesh } from '../src/face-mesh';
import { BASES, type Vec3 } from '../src/core/analysis';
import { TRIM_ASSETS } from '../src/core/banded-facade-assets';

it.each(['shop', 'office'] as const)('%s finished faces preserve geometry bounds, reservation ownership and deterministic restoration', profile => {
  const grids = [box(3,4,3).filter(([x,,z])=>x!==2||z!==2), FIXTURES.terrace.cells];
  const library = new CraftedGeometryLibrary();
  for (const cells of grids) {
    const document = createDocument(cells,42,profile), result = generateDocument(document);
    expect(generateDocument(loadDocument(exportDocument(document))).placements).toEqual(result.placements);
    expect(result.modules).toEqual([]);
    expect(result.placements.length).toBe(result.surfaces.length);
    const reservationIds = new Set(result.environment!.reservations.filter(r => r.kind==='attachment').map(r=>r.id));
    expect(new Set(result.placements.flatMap(p=>p.finishIds!))).toEqual(reservationIds);
    if(profile==='office')expect(result.placements.flatMap(p=>p.finishIds!)).toEqual([]);
    else expect(result.placements.some(p=>p.finishIds!.length>1)).toBe(true);
    for (const placement of result.placements) {
      const key = placement.faceAssetKey!, descriptor = completeFaceAsset(key), bounds = faceAssetBounds(key);
      const geometry = library.get(key), position = geometry.getAttribute('position');
      expect(geometry.index!.count).toBe(library.get(descriptor.baseAssetKey).index!.count
        + descriptor.finishAssetKeys.reduce((n,key)=>n+TRIM_ASSETS[key].boxes16.length*36,0));
      expect(geometry.groups.reduce((n,g)=>n+g.count,0)).toBe(geometry.index!.count);
      for (let i=0;i<position.count;i++) for(let axis=0;axis<3;axis++) {
        expect(position.getComponent(i,axis)*16).toBeGreaterThanOrEqual(bounds.min[axis]-1e-5);
        expect(position.getComponent(i,axis)*16).toBeLessThanOrEqual(bounds.max[axis]+1e-5);
      }
      // Validate actual finish support without filling the empty corner of its AABB.
      const reservations = placement.finishIds!.flatMap(id=>result.environment!.reservations.find(r=>r.id===id)!.boxes16);
      expect(descriptor.finishAssetKeys.length).toBe(placement.finishIds!.length);
      for(const finish of descriptor.finishAssetKeys) {
        const actual=faceBounds16(faceAssetBounds(finish),placement.position2,placement.orientationId);
        const envelope=result.environment!.preflight.find(e=>e.buildingId===result.surfaces.find(s=>s.faceId===placement.faceId)!.componentId)!.envelope;
        expect(containedInUnion(actual,envelope.deferredAttachmentBounds16)).toBe(true);
      }
      if(descriptor.finishAssetKeys.length)expect(reservations.length).toBeGreaterThan(0);
    }
  }
  library.dispose();
});

it('each placed face is one real Mesh; glass and corner finish hits select its owner in all wall orientations',()=>{
  const library=new CraftedGeometryLibrary(),materials=[0,1,2,3].map(()=>new MeshBasicMaterial({side:DoubleSide}));
  const base='facade.banded-shop-body-repeat-single',key=selectCompleteFaceAsset(base,['trim.cap.start','trim.cap.outer-negative']);
  const tile=createDocument([[0,0,0]]).catalog.tiles.find(t=>t.assetKey===base)!;
  for(const direction of ['PX','NX','PZ','NZ'] as const){
    const placement={placementId:'p',faceId:`0,0,0|${direction}`,tileId:tile.tileId,ruleId:'test',position2:[1,1,1] as Vec3,orientationId:direction,faceAssetKey:key,finishIds:['corner','strip']};
    const mesh=createFaceMesh(placement,tile,library,materials,new Vector3()),second=createFaceMesh({...placement,faceId:'other'},tile,library,materials,new Vector3());
    expect(mesh).toBeInstanceOf(Mesh);expect(mesh).not.toBeInstanceOf(InstancedMesh);expect(mesh.children).toEqual([]);
    expect(second).not.toBe(mesh);expect(second.geometry).toBe(mesh.geometry);expect(second.material).toBe(mesh.material);
    mesh.updateMatrixWorld(true);
    for(const [point,slot] of [[[0,0,1/64],2],[[-8/16,7/16,2/16],1]] as const){
      const target=new Vector3(...point).applyMatrix4(mesh.matrixWorld),normal=new Vector3(...BASES[direction].n);
      const hits=new Raycaster(target.clone().add(normal),normal.negate()).intersectObject(mesh,false);
      expect(hits.length).toBeGreaterThan(0);expect(hits[0].object.userData.faceId).toBe(placement.faceId);expect(hits[0].face!.materialIndex).toBe(slot);
    }
  }
  library.dispose();materials.forEach(m=>m.dispose());
});

it('only fixed, non-overlapping finish alternatives can select a complete prototype',()=>{
  expect(()=>selectCompleteFaceAsset('crafted.roof',['trim.cap.plain'])).toThrow('UNKNOWN_COMPLETE_FACE_VARIANT');
  expect(()=>selectCompleteFaceAsset('facade.wall',['trim.cap.plain','trim.cap.outer-negative'])).toThrow('UNKNOWN_COMPLETE_FACE_VARIANT');
  expect(()=>selectCompleteFaceAsset('facade.wall',['trim.cap.stretched'])).toThrow('UNKNOWN_COMPLETE_FACE_VARIANT');
});
