import {expect,it} from 'vitest';
import {createDocument,exportDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {TOWER11_D_ASSETS} from '../src/core/tower11-d-assets';
import {TOWER11_D_STYLE} from '../src/core/building-style';
import {verticalCounts} from '../src/core/vertical-design';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {facadeColors} from '../src/facade-finishes';
import {box,FIXTURES} from '../src/fixtures';

it.each([1,2,10,29,32])('D at height %i has one storefront floor and a uniform upper facade',height=>{
  expect(verticalCounts(height,TOWER11_D_STYLE)).toMatchObject({base:1,body:height-1,crown:0});
  const doc=createDocument(box(3,height,2),42,'tower11-d'),result=generateDocument(doc);
  expect(result.status).toBe('ok');expect(result.modules).toEqual([]);
  expect(new Set(result.placements.map(p=>p.faceId)).size).toBe(result.surfaces.length);
  const surfaces=new Map(result.surfaces.map(s=>[s.faceId,s]));
  for(const p of result.placements){
    const s=surfaces.get(p.faceId)!;
    if(s.role!=='wall')continue;
    expect(p.tileId).toContain('tower11-d-');
    if(s.cell[1]===0&&!p.tileId.includes('portal'))expect(p.tileId).toContain('-ground');
    if(s.cell[1]>0)expect(p.tileId).toContain('-window');
  }
  expect(result.environment!.entrances![0].entrances).toHaveLength(1);
});

it('D prototypes fit declared envelopes and the finish is white for every seed palette',()=>{
  for(const [key,asset] of Object.entries(TOWER11_D_ASSETS)){
    const geometry=buildCraftedGeometry(key),p=geometry.getAttribute('position');
    for(let axis=0;axis<3;axis++){
      const values=Array.from({length:p.count},(_,i)=>p.getComponent(i,axis)*16);
      expect(Math.min(...values),key).toBeGreaterThanOrEqual(asset.bounds16.min[axis]-.00001);
      expect(Math.max(...values),key).toBeLessThanOrEqual(asset.bounds16.max[axis]+.00001);
    }
    geometry.dispose();
  }
  for(const palette of ['clay','sage','sand'] as const)expect(facadeColors('tower11-d',palette)).toEqual(facadeColors('tower11-d','clay'));
  expect(facadeColors('tower11-d','clay').wall).toBe('#e5e5e2');
});

it('Tower11 setbacks keep local roof parapets, access and save/restore deterministic',()=>{
  const f=FIXTURES.cityD,doc=createDocument(f.cells,42,'tower11-d',undefined,undefined,f.sceneInputs);
  const result=generateDocument(doc);
  for(const y of [14,21,28])expect(result.placements.some(p=>p.faceId.split('|')[0].split(',')[1]===String(y)&&p.tileId.includes('-rooftop'))).toBe(true);
  expect(generateDocument(loadDocument(exportDocument(doc)))).toEqual(result);
  expect(result.environment!.entrances![0].entrances.length).toBeGreaterThan(0);
  expect(doc).not.toHaveProperty('environment');expect(doc.buildingDefinition).not.toHaveProperty('bandPolicy');
});

it('catalog 12 A–C files upgrade without changing their designs or generated faces',()=>{
  const doc=createDocument(box(4,5,3),42,'office'),before=generateDocument(doc);
  doc.catalog.version=12;doc.catalog.tiles=doc.catalog.tiles.filter(t=>!t.assetKey.startsWith('facade.tower11-d-'));
  const loaded=loadDocument(JSON.stringify(doc));
  expect(loaded.catalog.version).toBe(13);expect(loaded.buildingDefinition).toEqual(doc.buildingDefinition);
  expect(generateDocument(loaded).placements).toEqual(before.placements);
});
