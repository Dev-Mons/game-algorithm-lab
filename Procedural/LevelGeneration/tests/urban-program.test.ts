import {expect,it} from 'vitest';
import {createDocument,replaceGrid,exportDocument,loadDocument,canonicalJSON} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {allocateProgram} from '../src/core/architectural-program';
import {URBAN_SHOP_STYLE,LEGACY_SHOP_STYLE,validateBuildingStyle} from '../src/core/building-style';
import {FACADE_ASSETS} from '../src/core/facade-assets';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {DocumentHistory} from '../src/editor';
import {applyEnvironmentEdit} from '../src/environment-editor';
import {box} from '../src/fixtures';

it('priority 1: all heights 1–32, both urban styles and seeds generate complete nonoverlapping floors and faces',()=>{
  const profiles=new Set<string>(),assets=new Set<string>();
  for(const style of ['urban-shop','urban-office'] as const)for(const seed of [0,17])for(let h=1;h<=32;h++){
    const doc=createDocument(box(6,h,2),seed,style),r=generateDocument(doc,{cache:false}),v=r.environment!.vertical![0];
    expect(r.status).toBe('ok');expect(r.environment!.stages.every(s=>s.state==='ready'||s.state==='not-applicable')).toBe(true);
    expect(v.bands.reduce((n,b)=>n+b.yMaxExclusive-b.yMin,0)).toBe(h);
    for(let y=0;y<h;y++)expect(v.bands.filter(b=>y>=b.yMin&&y<b.yMaxExclusive)).toHaveLength(1);
    expect(new Set(v.faceBands.map(f=>f.faceId)).size).toBe(r.surfaces.filter(s=>s.role==='wall').length);
    expect(new Set(r.placements.map(p=>p.faceId)).size).toBe(r.surfaces.length);
    profiles.add(canonicalJSON(v.profile));r.placements.forEach(p=>assets.add(doc.catalog.tiles.find(t=>t.tileId===p.tileId)!.assetKey));
    if(h===1)expect(v.bands.map(b=>b.band)).toEqual(['retail']);
    if(h>=12)expect(v.bands.map(b=>b.band)).toEqual(['retail','office','upper','mechanical']);
  }
  expect(profiles.size).toBeGreaterThan(2);expect(assets.has('facade.urban-louver')).toBe(true);
  for(const key of assets){const geometry=buildCraftedGeometry(key);expect(geometry.getAttribute('position').count).toBeGreaterThan(0);geometry.dispose();}
},60000);

it('priority 1: arbitrary semantic IDs, invalid style rejection and predictable required fallback',()=>{
  const program=URBAN_SHOP_STYLE.programs![0];expect(allocateProgram(1,program)).toEqual({sections:[{id:'retail',count:1}],reasons:['PROGRAM_FALLBACK']});
  const s=structuredClone(URBAN_SHOP_STYLE);s.programs![0].sections[0].max=0;expect(()=>validateBuildingStyle(s)).toThrow('INVALID_ARCHITECTURAL_PROGRAM');
  const valid=structuredClone(URBAN_SHOP_STYLE);valid.bands.work=valid.bands.office;delete valid.bands.office;
  if(valid.facadeGrammar)valid.facadeGrammar.sections=['work'];
  valid.programs!.forEach(p=>p.sections.forEach(s=>{if(s.id==='office')s.id='work';}));valid.patterns.forEach(p=>p.roles=p.roles.map(r=>r==='office'?'work':r));valid.alignedFamilies.forEach(f=>{f.patterns.work=f.patterns.office;delete f.patterns.office;});
  expect(generateDocument(createDocument(box(4,6,2),4,'urban-shop',valid)).environment!.vertical![0].bands.some(b=>b.band==='work')).toBe(true);
  const openings=['base','body','crown'].map(b=>FACADE_ASSETS[`facade.banded-shop-${b as 'base'|'body'|'crown'}-repeat-single`].opening16);
  expect(new Set(openings.map(o=>JSON.stringify(o))).size).toBe(3);
});

it('priority 1: design intent survives root changes, merge/split, save, cache and undo/redo',()=>{
  const doc=createDocument(box(6,8,2),17,'urban-shop');doc.buildings[0].design.overrides={programId:'mixed-2',familyId:'bay-4',palette:'sage'};
  const next=replaceGrid(doc,[...doc.grid,[-1,0,0]]),profile=generateDocument(doc).environment!.vertical![0].profile;
  expect(generateDocument(next).environment!.vertical![0].profile).toEqual(profile);
  expect(generateDocument(loadDocument(exportDocument(next)),{cache:false})).toEqual(generateDocument(next));
  const history=new DocumentHistory(doc);history.commit(next);expect(history.undo()).toEqual(doc);expect(history.redo()).toEqual(next);
  const split=replaceGrid(next,next.grid.filter(c=>c[0]!==2));expect(split.buildings.every(b=>canonicalJSON(b.design)===canonicalJSON(doc.buildings[0].design))).toBe(true);
  expect(replaceGrid(split,next.grid).buildings[0].design).toEqual(doc.buildings[0].design);
  const shuffled={...next,grid:[...next.grid].reverse()};expect(generateDocument(shuffled,{cache:false})).toEqual(generateDocument(next));
});
it('saved catalog 3 designs without a designSeed keep their original intent, and new overrides are validated',()=>{
  const doc=createDocument(box(4,6,3),17,'shop',LEGACY_SHOP_STYLE),raw=JSON.parse(exportDocument(doc));raw.catalog.version=3;raw.catalog.tiles=raw.catalog.tiles.filter((t:{assetKey:string})=>!t.assetKey.includes('streamline-c-')&&!t.assetKey.includes('curtain-b-')&&!t.assetKey.includes('ribbon-a-')&&!t.assetKey.startsWith('facade.urban-'));delete raw.buildings[0].design.designSeed;
  const loaded=loadDocument(JSON.stringify(raw));expect(loaded.buildings[0].design.designSeed).toBeUndefined();expect(generateDocument(loaded).placements).toEqual(generateDocument(doc).placements);
  const urban=createDocument(box(6,6,3),17,'urban-shop'),edited=applyEnvironmentEdit(urban,{kind:'building-design',targetId:'0,0,0',settingPath:'overrides.palette',value:'sage'}).document;
  expect(generateDocument(edited).placements.every(p=>p.tileId.endsWith('.sage'))).toBe(true);
  const bad=JSON.parse(exportDocument(urban));bad.buildings[0].design.overrides=null;expect(()=>loadDocument(JSON.stringify(bad))).toThrow('INVALID_FIELDS');
});
