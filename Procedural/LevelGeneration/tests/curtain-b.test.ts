import {expect,it} from 'vitest';
import {BUILDING_PROFILES,createDocument,exportDocument,loadDocument} from '../src/core/document';
import {LEGACY_OFFICE_STYLE} from '../src/core/building-style';
import {generateDocument} from '../src/core/generate-document';
import {box} from '../src/fixtures';
import {CURTAIN_B_ASSETS,isCurtainBCornerV10,type CurtainBKey} from '../src/core/curtain-b-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';

it('B keeps wall and horizontal roof ownership separate and round-trips its private roof finish',()=>{
  const doc=createDocument(box(12,10,9),42,'office'),result=generateDocument(doc);
  const surfaces=new Map(result.surfaces.map(s=>[s.faceId,s]));
  for(const p of result.placements){
    const role=surfaces.get(p.faceId)!.role;
    expect(p.tileId.includes('curtain-b-roof')).toBe(role==='roof');
    if(role==='wall')expect(p.tileId).toContain('curtain-b-');
  }
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
  for(const [id,style] of Object.entries(BUILDING_PROFILES))if(id!=='office'&&id!=='urban-shop'){
    expect(style.roofAsset).toBeUndefined();expect(style.modules.some(m=>m.assetId.includes('curtain-b-'))).toBe(false);
  }
});

it('B renders opaque gray spandrels below glass, flush edges and a continuous taller parapet',()=>{
  const materials=[0,1,2,3].map(()=>new MeshBasicMaterial({side:DoubleSide}));
  const geometry=buildCraftedGeometry('facade.curtain-b-body-repeat-single'),mesh=new Mesh(geometry,materials);
  const hit=(y:number)=>new Raycaster(new Vector3(.2,y,1),new Vector3(0,0,-1)).intersectObject(mesh,false)[0].face!.materialIndex;
  expect(hit(-7/16)).toBe(0); // Opaque wall material, not glass or bronze metal.
  expect(hit(0)).toBe(2);
  geometry.dispose();materials.forEach(m=>m.dispose());
  for(const [key,asset] of Object.entries(CURTAIN_B_ASSETS)){
    if(asset.surfaceRole)continue;
    expect(asset.integratedTrims,key).toBe(true);
    for(const b of [...asset.reliefBoxes16,...asset.accentBoxes16??[]])expect(b.max[2],key).toBeLessThanOrEqual(.375);
    if(key.includes('rooftop-'))expect(asset.reliefBoxes16).toContainEqual({min:[-8,8,0],max:[8,12,.375]});
  }
});

it('catalog 6 B documents keep their previous facade and roof after loading',()=>{
  const old=createDocument(box(5,6,4),42,'office',LEGACY_OFFICE_STYLE);
  const before=generateDocument(old);old.catalog.version=6;
  old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.includes('streamline-c-')&&!t.assetKey.includes('curtain-b-'));
  const loaded=loadDocument(JSON.stringify(old));expect(loaded.catalog.version).toBe(10);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(generateDocument(loaded).placements).toEqual(before.placements);
});

it('B belt rows render as full-cell white walls without any glazing',()=>{
  const result=generateDocument(createDocument(box(12,10,9),42,'office'));
  const materials=[0,1,2,3].map(()=>new MeshBasicMaterial({side:DoubleSide}));
  // The reference has its lower belt at Y=1 and upper belt at Y=8.
  for(const y of [1,8]){
    const placement=result.placements.find(p=>p.faceId===`4,${y},8|PZ`)!;
    const geometry=buildCraftedGeometry(placement.faceAssetKey!),mesh=new Mesh(geometry,materials);
    expect(geometry.groups.some(g=>g.materialIndex===2)).toBe(false);
    for(const v of [-.49,0,.49]){
      const hit=new Raycaster(new Vector3(.2,v,1),new Vector3(0,0,-1)).intersectObject(mesh,false)[0];
      expect(hit.face!.materialIndex).toBe(1);
    }
    geometry.dispose();
  }
  materials.forEach(m=>m.dispose());
  expect(result.environment!.entrances![0].entrances).toHaveLength(1);
});

it('B puts thin white pillars only on convex tile ends, including short returns',()=>{
  for(const width of [1,2,6]){
    const doc=createDocument(box(width,6,4),42,'office'),result=generateDocument(doc);
    const tileById=new Map(doc.catalog.tiles.map(t=>[t.tileId,t.assetKey]));
    for(let x=0;x<width;x++){
      const p=result.placements.find(p=>p.faceId===`${x},2,3|PZ`)!;
      const asset=CURTAIN_B_ASSETS[tileById.get(p.tileId)! as CurtainBKey];
      const expected=x===0&&x===width-1?'both':x===0?'left':x===width-1?'right':undefined;
      expect(asset.reliefCorner).toBe(expected);
      if(x===0)expect(asset.reliefBoxes16).toContainEqual({min:[-8,-8,0],max:[-7,8,.375]});
      if(x===width-1)expect(asset.reliefBoxes16).toContainEqual({min:[7,-8,0],max:[8,8,.375]});
    }
    expect(generateDocument({...doc,grid:[...doc.grid].reverse()},{cache:false})).toEqual(result);
  }
  const concave=generateDocument(createDocument(box(6,6,4).filter(([x,,z])=>x<3||z<2),42,'office'));
  expect(concave.placements.find(p=>p.faceId==='2,2,2|PX')!.tileId).not.toContain('-edge-');
});

it('catalog 9 B documents upgrade corner prototypes while retaining authored style and doors',()=>{
  const old=createDocument(box(6,6,4),42,'office');old.catalog.version=9;
  old.catalog.tiles=old.catalog.tiles.filter(t=>!isCurtainBCornerV10(t.assetKey));
  const loaded=loadDocument(JSON.stringify(old));expect(loaded.catalog.version).toBe(10);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  const result=generateDocument(loaded);
  expect(result.placements.some(p=>p.tileId.includes('-edge-'))).toBe(true);
  expect(generateDocument(loadDocument(exportDocument(loaded)))).toEqual(result);
});
