import {expect,it} from 'vitest';
import {BUILDING_PROFILES,createDocument,exportDocument,loadDocument,type Profile} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {CITY_FACADE_ASSETS} from '../src/core/city-facade-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {FIXTURES,box} from '../src/fixtures';
import {roadPlacements} from '../src/core/roads';
import {LEGACY_SHOP_STYLE} from '../src/core/building-style';

it('registers concepts A through D in order',()=>{
  expect(Object.values(BUILDING_PROFILES).map(s=>s.label)).toEqual(Array.from({length:4},(_,i)=>String.fromCharCode(65+i)));
  expect(Object.keys(FIXTURES).filter(k=>/^city[A-Z]$/.test(k))).toEqual(['cityA','cityB','cityC','cityD']);
  for(const profile of ['urban-office',...Array.from('efghijklmnopqrstuvwx',c=>`style-${c}`)])
    expect(()=>createDocument([],42,profile as Profile)).toThrow('Unknown current building profile');
});
it.each(Object.entries(BUILDING_PROFILES))('%s generates doors, roof plant, complete surfaces and round-trips',(id,style)=>{
    const fixture=FIXTURES[`city${style.label}`];
    const doc=createDocument(fixture.cells,42,id as Profile,undefined,undefined,fixture.sceneInputs);
    const result=generateDocument(doc);
    expect(result.placements.length,id).toBeGreaterThan(0);
    expect(result.placements.every(p=>p.faceAssetKey),id).toBe(true);
    expect(result.environment!.entrances![0].entrances.length,id).toBeGreaterThan(0);
    expect(result.scenePlacements!.some(p=>p.asset.includes('air-conditioner')),id).toBe(true);
    expect(loadDocument(exportDocument(doc)),id).toEqual(doc);
});

it('new prototypes keep actual vertices inside their declared facade/roof envelope',()=>{
  for(const [key,asset] of Object.entries(CITY_FACADE_ASSETS)){
    const g=buildCraftedGeometry(key),p=g.getAttribute('position');
    for(let axis=0;axis<3;axis++){
      const values=Array.from({length:p.count},(_,i)=>p.getComponent(i,axis)*16);
      expect(Math.min(...values),key).toBeGreaterThanOrEqual(asset.bounds16.min[axis]-.00001);
      expect(Math.max(...values),key).toBeLessThanOrEqual(asset.bounds16.max[axis]+.00001);
    }
    expect(g.groups.every(group=>group.materialIndex!>=0&&group.materialIndex!<=3),key).toBe(true);
    g.dispose();
  }
});

it('catalog 10 upgrades without replacing a saved design and rejects altered metadata',()=>{
  const old=createDocument(box(3,3,3),42,'shop',LEGACY_SHOP_STYLE);
  old.catalog.version=10;old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.startsWith('facade.tower11-d-')&&!t.assetKey.startsWith('facade.city-'));
  const loaded=loadDocument(JSON.stringify(old));
  expect(loaded.catalog.version).toBe(13);expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(generateDocument(loaded).placements).toEqual(generateDocument(createDocument(old.grid,42,'shop',LEGACY_SHOP_STYLE)).placements);
  old.catalog.tiles[0].roles=['roof'];expect(()=>loadDocument(JSON.stringify(old))).toThrow();
});

it('loads an A–D catalog 11 document, discards retired metadata and rejects tampering',()=>{
  const old=createDocument(box(2,3,2),42,'office');old.catalog.version=11;old.catalog.tiles=old.catalog.tiles.filter(t=>!t.assetKey.startsWith('facade.tower11-d-'));
  const template=old.catalog.tiles.find(t=>t.assetKey==='facade.curtain-b-wall'&&t.palette==='clay')!;
  for(const letter of 'fghijklmnopqrstuvwx')for(const part of ['base','body','crown','pier','wall','portal-single','portal-left','portal-right'])
    for(const rooftop of [false,true])for(const palette of ['clay','sage','sand'] as const){
      const assetKey=`facade.city-${letter}-${part}${rooftop?'-rooftop':''}` as typeof template.assetKey;
      old.catalog.tiles.push({...template,assetKey,tileId:`${assetKey}.${palette}`,palette});
    }
  const loaded=loadDocument(JSON.stringify(old));
  expect(loaded.catalog.version).toBe(13);
  expect(loaded.buildingDefinition).toEqual(old.buildingDefinition);
  expect(loaded.catalog.tiles.some(t=>t.assetKey.startsWith('facade.city-f-'))).toBe(false);
  old.catalog.tiles.at(-1)!.roles=['roof'];
  expect(()=>loadDocument(JSON.stringify(old))).toThrow();
});

it('street markings remain within authored road cells, with stable identities',()=>{
  const cells=FIXTURES.cityC.sceneInputs!.roads,placements=roadPlacements(cells);
  expect(placements.some(p=>p.asset.startsWith('crosswalk-'))).toBe(true);
  expect(placements.some(p=>p.asset.includes('-dash-'))).toBe(true);
  expect(new Set(placements.map(p=>p.id)).size).toBe(placements.length);
  const occupied=new Set(cells.map(([x,,z])=>`${x},${z}`));
  for(const p of placements)for(const a of [-.4999,.4999])for(const b of [-.4999,.4999])
    expect(occupied.has(`${Math.floor(p.center[0]+p.size[0]*a)},${Math.floor(p.center[2]+p.size[2]*b)}`),p.id).toBe(true);
  expect(roadPlacements([...cells].reverse())).toEqual(placements);
});
