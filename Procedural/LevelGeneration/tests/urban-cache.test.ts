import {expect,it} from 'vitest';
import {replaceGrid,replaceSceneInputs} from '../src/core/document';
import {createDocument} from '../tests/custom-frame-document';
import {generateDocument} from '../src/core/generate-document';
import {EnvironmentCache} from '../src/core/environment-cache';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';

it('32³ urban plans do not evict document/analysis for irrelevant panel-template cache data',()=>{
  const cache=new EnvironmentCache(),doc=createDocument(box(32,32,32),17,'urban-office'),cold=generateDocument(doc,{cache}),before=cache.stats(),warm=generateDocument(doc,{cache});
  expect(warm).toEqual(cold);expect(cache.stats().evictions).toBe(0);expect(cache.stats().writes).toBe(before.writes);expect(cache.stats().hits).toBeGreaterThan(before.hits);expect(cache.stats().bytes).toBeLessThan(16*1024*1024);
},15000);
it('template reuse retains palette, row, geometry and approved constraint dependency correctness',()=>{
  const cache=new EnvironmentCache(),doc=createDocument(box(8,10,4),17,'urban-office');generateDocument(doc,{cache});
  const palette=structuredClone(doc);palette.seed=43;
  const cut=replaceGrid(palette,palette.grid.filter(c=>c.join(',')!=='4,5,3'));
  const facility=replaceSceneInputs(cut,{...emptySceneInputs(),objects:[{id:'attachment',category:'facility',facilityKind:'balcony',facadeRequest:'solid',direction:'PZ',cells:[[2,2,4]]}]});
  for(const input of [palette,cut,facility,doc])expect(generateDocument(input,{cache})).toEqual(generateDocument(input,{cache:false}));
});
