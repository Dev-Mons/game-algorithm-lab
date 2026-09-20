import {expect,it} from 'vitest';
import {RIBBON_A_ASSETS} from '../src/core/ribbon-a-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {BUILDING_PROFILES,createDocument,exportDocument,loadDocument} from '../src/core/document';
import {LEGACY_SHOP_STYLE} from '../src/core/building-style';
import {generateDocument} from '../src/core/generate-document';
import {box} from '../src/fixtures';

it('A slabs meet across window/pier module boundaries without vertical pilaster breaks',()=>{
  const seam=(key:string,edge:number)=>{
    const g=buildCraftedGeometry(key),p=g.getAttribute('position'),idx=g.index!,points=new Set<string>();
    for(const group of g.groups.filter(g=>g.materialIndex===1))for(let j=group.start;j<group.start+group.count;j++){
      const i=idx.getX(j);if(Math.abs(p.getX(i)-edge)<1e-6)points.add([p.getY(i),p.getZ(i)].map(n=>n.toFixed(5)).join(','));
    }
    g.dispose();return [...points].sort();
  };
  for(const band of ['base','body','crown'])for(const row of ['foot','repeat','head','single','single-cap']){
    const reference=seam(`facade.ribbon-a-${band}-${row}-single`,.5);expect(reference.length).toBeGreaterThan(0);
    for(const part of ['single','left','right','pier'])for(const edge of [-.5,.5])expect(seam(`facade.ribbon-a-${band}-${row}-${part}`,edge)).toEqual(reference);
  }
  expect(Object.keys(RIBBON_A_ASSETS).length).toBeGreaterThan(0);
});

it('new A geometry round-trips while existing A documents and B–E retain their own modules',()=>{
  const doc=createDocument(box(8,8,4),42,'shop'),a=generateDocument(doc);
  expect(a.placements.some(p=>p.tileId.includes('ribbon-a-'))).toBe(true);
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(a);
  for(const [id,style] of Object.entries(BUILDING_PROFILES))if(id!=='shop')expect(style.modules.some(m=>m.assetId.includes('ribbon-a-'))).toBe(false);
  const old=createDocument(box(8,8,4),42,'shop',LEGACY_SHOP_STYLE);
  old.catalog.version=5;old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.startsWith('facade.tower11-d-')&&!t.assetKey.startsWith('facade.city-')&&!t.assetKey.includes('streamline-c-')&&!t.assetKey.includes('curtain-b-')&&!t.assetKey.includes('ribbon-a-'));
  const loaded=loadDocument(JSON.stringify(old));expect(loaded.catalog.version).toBe(13);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(generateDocument(loaded).placements.some(p=>p.tileId.includes('ribbon-a-'))).toBe(false);
});
