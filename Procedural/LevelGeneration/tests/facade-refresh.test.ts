import {expect,it} from 'vitest';
import {LEGACY_URBAN_SHOP_STYLE} from '../src/core/building-style';
import {FACADE_ASSETS} from '../src/core/facade-assets';
import {FRAME_ASSETS,frameAssetKey} from '../src/core/urban-facade-assets';
import {createDocument,exportDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {box} from '../src/fixtures';
import {boxesOverlap} from '../src/core/placement-bounds';

it('all refreshed meshes fit reserved bounds, preserve door clearance and have bounded detail',()=>{
  for(const [key,asset] of Object.entries(FACADE_ASSETS)){
    if(!('structural' in asset)||!asset.structural)continue;
    const geometry=buildCraftedGeometry(key),p=geometry.getAttribute('position');
    // Check every vertex, but aggregate extrema before asserting: the catalog
    // now contains corner variants for every C module, not just piers.
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<p.count;i++)for(let axis=0;axis<3;axis++){
      const value=p.getComponent(i,axis)*16;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
    }
    for(let axis=0;axis<3;axis++){
      expect(min[axis],key).toBeGreaterThanOrEqual(asset.bounds16.min[axis]-1e-5);
      expect(max[axis],key).toBeLessThanOrEqual(asset.bounds16.max[axis]+1e-5);
    }
    expect(geometry.index!.count/3,key).toBeLessThan(400);
    if(asset.portalClearance16){
      const o=asset.opening16!;
      for(const b of [...asset.reliefBoxes16,...(asset.accentBoxes16??[])])expect(boxesOverlap(b,{min:[o.minU,o.minV,0],max:[o.maxU,o.maxV,2]}),key).toBe(false);
    }
    geometry.dispose();
  }
});

it.each(['urban-shop','urban-office'] as const)('%s uses its own continuous glass mesh family and round-trips',style=>{
  const doc=createDocument(box(10,8,4),17,style,style==='urban-shop'?LEGACY_URBAN_SHOP_STYLE:undefined),result=generateDocument(doc);
  const plan=result.environment!.facades![0];
  expect(plan.faces.length).toBeGreaterThan(0);
  const placements=new Map(result.placements.map(p=>[p.faceId,p]));
  const faces=new Map(plan.faces.map(f=>[`${f.panelId}:${f.u}:${f.v}`,f]));
  for(const f of plan.faces){
    expect(f.assetKey).toContain(`${style}-frame-`);
    expect(placements.get(f.faceId)!.faceAssetKey).toContain(f.assetKey);
    const a=FRAME_ASSETS[f.assetKey].opening16!;
    for(const [du,dv] of [[1,0],[0,1]]){
      const next=faces.get(`${f.panelId}:${f.u+du}:${f.v+dv}`);if(!next)continue;
      const b=FRAME_ASSETS[next.assetKey].opening16!;
      if(du){expect(a.maxU).toBe(8);expect(b.minU).toBe(-8);expect([a.minV,a.maxV]).toEqual([b.minV,b.maxV]);}
      else{expect(a.maxV).toBe(8);expect(b.minV).toBe(-8);expect([a.minU,a.maxU]).toEqual([b.minU,b.maxU]);}
    }
  }
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
});

it('catalog 4 documents keep authored legacy frame selections while upgrading',()=>{
  const old=createDocument(box(8,6,4),17,'urban-office');
  delete old.buildingDefinition.facadeGrammar!.frameStyle;
  for(let i=0;i<16;i++)old.buildingDefinition.modules.find(m=>m.id===`frame-${i}`)!.assetId=frameAssetKey(i);
  old.catalog.version=4;
  old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.includes('streamline-c-')&&!t.assetKey.includes('curtain-b-')&&!t.assetKey.includes('ribbon-a-')&&!/^facade\.urban-(shop|office)-frame-/.test(t.assetKey));
  const loaded=loadDocument(JSON.stringify(old));
  expect(loaded.catalog.version).toBe(10);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(generateDocument(loaded).environment!.facades![0].faces.every(f=>f.assetKey.startsWith('facade.urban-frame-'))).toBe(true);
});
