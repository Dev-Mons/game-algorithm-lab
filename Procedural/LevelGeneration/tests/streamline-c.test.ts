import {expect,it} from 'vitest';
import {createDocument,exportDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {LEGACY_URBAN_SHOP_STYLE} from '../src/core/building-style';
import {FACADE_ASSETS,type FacadeAssetKey} from '../src/core/facade-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {FIXTURES,box} from '../src/fixtures';
import {isStreamlineCCornerV9} from '../src/core/streamline-c-assets';
import {type Direction} from '../src/core/analysis';
import {DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';

it.each(['referenceCLow','referenceCHigh','referenceCPortal'])('%s uses floor ribbons and closes every source face, deterministically',name=>{
  const doc=createDocument(FIXTURES[name].cells,42,'urban-shop'),result=generateDocument(doc);
  expect(result.status).toBe('ok');expect(result.cells).toEqual(doc.grid);
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
  expect(result.environment!.facades).toEqual([]);
  expect(result.placements.flatMap(p=>p.finishIds??[])).toEqual([]);
  const tiles=new Map(doc.catalog.tiles.map(t=>[t.tileId,t]));
  for(const p of result.placements){
    const face=result.surfaces.find(s=>s.faceId===p.faceId)!;
    if(face.role==='wall')expect(tiles.get(p.tileId)!.assetKey).toContain('streamline-c-');
    if(face.role!=='wall'||face.cell[1]===0)continue;
    const asset=FACADE_ASSETS[tiles.get(p.tileId)!.assetKey as FacadeAssetKey];
    if('opening16' in asset&&asset.opening16&&!('portalClearance16' in asset&&asset.portalClearance16))
      expect(asset.opening16.maxV-asset.opening16.minV).toBe(tiles.get(p.tileId)!.assetKey.includes('-base-')?8:7);
  }
  expect(generateDocument({...doc,grid:[...doc.grid].reverse()},{cache:false})).toEqual(result);
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
});

it('both faces of convex C corners agree across 1/2-cell returns, offsets, caps and base/body changes',()=>{
  const grids=[box(1,5,2),box(2,6,4),box(3,7,2),box(9,8,6).filter(([x,y,z])=>(x<2||x>=7||z<3)&&(x<7||y<5))];
  // Clockwise convex edge pairs. The first face ends on its positive U side;
  // the second starts on its negative U side, regardless of the facade run.
  const pairs:[Direction,Direction][]=[['PZ','PX'],['PX','NZ'],['NZ','NX'],['NX','PZ']];
  for(const grid of grids){
    const doc=createDocument(grid,42,'urban-shop');doc.buildings[0].design.columnMode='building';
    const result=generateDocument(doc),placements=new Map(result.placements.map(p=>[p.faceId,p]));
    const tiles=new Map(doc.catalog.tiles.map(t=>[t.tileId,t]));
    for(const cell of grid)for(const [a,b] of pairs){
      const pa=placements.get(`${cell.join(',')}|${a}`),pb=placements.get(`${cell.join(',')}|${b}`);
      if(!pa||!pb)continue;
      for(const [placement,side,sign] of [[pa,'right',1],[pb,'left',-1]] as const){
        const key=tiles.get(placement.tileId)!.assetKey as FacadeAssetKey,asset=FACADE_ASSETS[key];
        expect('reliefCorner' in asset&&[side,'both'].includes(asset.reliefCorner!),`${placement.faceId}: ${key}`).toBe(true);
        const geometry=buildCraftedGeometry(placement.faceAssetKey!),p=geometry.getAttribute('position');
        // All slots (including glass and metal) respect the same diagonal.
        for(let i=0;i<p.count;i++)expect(sign*p.getX(i)+p.getZ(i),key).toBeLessThanOrEqual(.500001);
        geometry.dispose();
      }
    }
    expect(generateDocument({...doc,grid:[...doc.grid].reverse()},{cache:false})).toEqual(result);
  }
});

it('C solid facade overrides keep the same convex corners and integrated coping',()=>{
  const doc=createDocument(box(4,5,4),42,'urban-shop');
  // Force ordinary wall panels rather than the pier/window rhythm.
  for(const pattern of doc.buildingDefinition.patterns){pattern.repeat.fill('wall');pattern.remainder='wall';}
  for(const band of Object.values(doc.buildingDefinition.bands))band.fallback='wall';
  doc.buildingDefinition.corner.module='wall';
  for(const module of doc.buildingDefinition.modules)if(module.semantic==='pier')module.semantic='wall';
  const result=generateDocument(doc);
  expect(result.placements.find(p=>p.faceId==='3,2,3|PZ')!.tileId).toContain('wall-cut-right');
  expect(result.placements.flatMap(p=>p.finishIds??[])).toEqual([]);
});

it('catalog 8 C documents upgrade missing short-return variants and remain editable',()=>{
  const old=createDocument(box(2,5,2),42,'urban-shop');old.catalog.version=8;
  old.catalog.tiles=old.catalog.tiles.filter(t=>!isStreamlineCCornerV9(t.assetKey)&&!t.assetKey.includes('-edge-'));
  const loaded=loadDocument(JSON.stringify(old));expect(loaded.catalog.version).toBe(10);
  expect(loaded.grid).toEqual(old.grid);expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  const result=generateDocument(loaded);
  expect(result.placements.filter(p=>p.faceId.endsWith('|PZ')&&p.faceId.includes(',2,')).every(p=>p.tileId.includes('-cut-'))).toBe(true);
  expect(generateDocument(loadDocument(exportDocument(loaded)))).toEqual(result);
});

it('C bevels convex cladding corners without cutting concave walls or repeating bevels inside a run',()=>{
  const doc=createDocument(box(6,5,4),42,'urban-shop'),r=generateDocument(doc);
  for(const id of ['0,2,3|PZ','5,2,3|PZ'])expect(r.placements.find(p=>p.faceId===id)!.tileId).toContain('-cut-');
  expect(r.placements.find(p=>p.faceId==='2,2,3|PZ')!.tileId).not.toContain('-cut-');
  const key='facade.streamline-c-body-repeat-pier-cut-right';
  const geometry=buildCraftedGeometry(key),positions=geometry.getAttribute('position'),indices=geometry.index!;
  for(const group of geometry.groups.filter(g=>g.materialIndex===1))for(let i=group.start;i<group.start+group.count;i++){
    const index=indices.getX(i);expect(positions.getX(index)+positions.getZ(index)).toBeLessThanOrEqual(.500001);
  }
  geometry.dispose();
  const court=createDocument(box(6,5,4).filter(([x,,z])=>x<3||z<2),42,'urban-shop');
  const concave=generateDocument(court).placements.find(p=>p.faceId==='2,2,2|PX')!;
  expect(concave.tileId).not.toContain('-cut-');
});

it('saved C catalog 7 keeps its authored frames while new C uses independent modules',()=>{
  const old=createDocument(box(6,5,4),42,'urban-shop',LEGACY_URBAN_SHOP_STYLE);
  const before=generateDocument(old);old.catalog.version=7;
  old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.includes('streamline-c-')&&!t.assetKey.includes('-edge-'));
  const loaded=loadDocument(JSON.stringify(old));expect(loaded.catalog.version).toBe(10);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(generateDocument(loaded).placements).toEqual(before.placements);
});

it.each([2,3,8])('C height %i joins a full-cell ground window to a half-cell transom without a concrete seam',height=>{
  const doc=createDocument(box(8,height,4),42,'urban-shop');
  doc.buildings[0].design.overrides={familyId:'bay-2'};
  const result=generateDocument(doc),materials=[0,1,2,3].map(()=>new MeshBasicMaterial({side:DoubleSide}));
  for(const y of [0,1]){
    // Check an ordinary shopfront bay beside the new central ground entrance.
    const placement=result.placements.find(p=>p.faceId===`1,${y},3|PZ`)!;
    const geometry=buildCraftedGeometry(placement.faceAssetKey!),p=geometry.getAttribute('position'),index=geometry.index!;
    const glass=geometry.groups.filter(g=>g.materialIndex===2).flatMap(g=>Array.from({length:g.count},(_,i)=>p.getY(index.getX(g.start+i))+y+.5));
    expect(Math.min(...glass)).toBe(y);expect(Math.max(...glass)).toBe(y===0?1:1.5);
    const mesh=new Mesh(geometry,materials);
    const seamY=y===0?.499:-.499;
    const hit=new Raycaster(new Vector3(.23,seamY,1),new Vector3(0,0,-1)).intersectObject(mesh,false)[0];
    expect([2,3]).toContain(hit.face!.materialIndex); // glass or a thin metal transom, never concrete
    geometry.dispose();
  }
  materials.forEach(m=>m.dispose());
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
});

it('C one-cell shopfront stays below its rooftop lintel and leaves corner piers solid',()=>{
  const result=generateDocument(createDocument(box(8,1,4),42,'urban-shop'));
  for(const [id,expectedGlass] of [['3,0,3|PZ',true],['0,0,3|PZ',false]] as const){
    const geometry=buildCraftedGeometry(result.placements.find(p=>p.faceId===id)!.faceAssetKey!);
    expect(geometry.groups.some(g=>g.materialIndex===2)).toBe(expectedGlass);
    if(expectedGlass){const p=geometry.getAttribute('position'),index=geometry.index!;
      const glass=geometry.groups.filter(g=>g.materialIndex===2).flatMap(g=>Array.from({length:g.count},(_,i)=>p.getY(index.getX(g.start+i))));
      expect(Math.max(...glass)).toBe(6/16);
    }
    geometry.dispose();
  }
});
