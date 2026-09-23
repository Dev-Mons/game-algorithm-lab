import {digest,fingerprint,meaningfulResult} from './concept-preservation-contract';
import {readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createDocument,exportDocument,loadDocument,replaceGrid,type GenerationDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {EnvironmentCache} from '../src/core/environment-cache';
import {DocumentHistory} from '../src/editor';
import {buildCraftedGeometry} from '../src/crafted-geometry';
import {box} from '../src/fixtures';
import type {Vec3} from '../src/core/generate';
import {CONCEPTS,conceptPreservationCases} from './concept-preservation-fixtures';

it('preserves the pre-refactor A–D placements, ownership, proportions, materials, access and complete geometry',()=>{
  const cases=conceptPreservationCases(),rows:Record<string,ReturnType<typeof fingerprint>>={},assets=new Set<string>();
  for(const {id,document} of cases){
    const result=generateDocument(document,{cache:false});
    rows[id]=fingerprint(document,result);
    for(const p of result.placements)if(p.faceAssetKey)assets.add(p.faceAssetKey);
    expect(new Set(result.placements.map(p=>p.faceId)).size,id).toBe(result.surfaces.length);
  }
  const geometry:Record<string,string>={};
  for(const key of [...assets].sort()){
    const g=buildCraftedGeometry(key);
    geometry[key]=digest({groups:g.groups,index:Array.from(g.index!.array),attributes:Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,{itemSize:a.itemSize,array:Array.from(a.array)}]))});
    g.dispose();
  }
  const actual={rows,geometry},path=new URL('../benchmarks/concept-preservation-baseline.json',import.meta.url);
  if(process.env.CAPTURE_CONCEPT_BASELINE==='1'){
    writeFileSync(path,JSON.stringify({sourceCommit:'0254855612632472645d360bfc77ec18eeb931d4',seed:42,additionalSeeds:[0,17,43],projection:'semantic-v1',...actual},null,2)+'\n');
  }else{
    const baseline=JSON.parse(readFileSync(path,'utf8'));
    expect(Object.keys(rows)).toEqual(Object.keys(baseline.rows));
    for(const [id,row] of Object.entries(rows))expect(row,id).toEqual(baseline.rows[id]);
    expect(geometry).toEqual(baseline.geometry);
  }
},120_000);

it.each(CONCEPTS)('%s edits, component splits, Undo/Redo and restoration match uncached full generation',(_label,profile)=>{
  const cache=new EnvironmentCache(),base=createDocument(box(12,16,10),42,profile),history=new DocumentHistory(base);
  const states:GenerationDocument[]=[base];
  const check=(document:GenerationDocument)=>{
    const actual=generateDocument(document,{cache}),fresh=generateDocument(document,{cache:false});
    expect(digest(meaningfulResult(actual))).toBe(digest(meaningfulResult(fresh)));
    expect(digest(meaningfulResult(generateDocument(loadDocument(exportDocument(document)),{cache})))).toBe(digest(meaningfulResult(fresh)));
  };
  check(base);
  const additions=box(12,1,10).map(([x,,z])=>[x,16,z] as Vec3);
  const added=replaceGrid(base,[...base.grid,...additions]);history.commit(added);states.push(added);check(added);
  const removed=replaceGrid(added,added.grid.filter(([x,y,z])=>y<16||x<3||x>8||z<2||z>7));history.commit(removed);states.push(removed);check(removed);
  // Removing a complete column can split ownership and requires component-wide evaluation.
  const split=replaceGrid(removed,removed.grid.filter(([x])=>x!==5));history.commit(split);states.push(split);check(split);
  for(let index=states.length-2;index>=0;index--){const restored=history.undo()!;expect(exportDocument(restored)).toBe(exportDocument(states[index]));check(restored);}
  for(let index=1;index<states.length;index++){const restored=history.redo()!;expect(exportDocument(restored)).toBe(exportDocument(states[index]));check(restored);}
  expect(cache.stats().bytes).toBeLessThanOrEqual(cache.maxBytes);
},120_000);
