import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {createDocument,documentOptions,type Profile} from '../src/core/document';
import {analyzeVolume} from '../src/core/regions';
import {selectTiles} from '../src/core/selection';
import {planVertical} from '../src/core/vertical-design';
import {applyFacadeStyle} from '../src/core/facade-patterns';
import {box} from '../src/fixtures';

// Deliberately isolated from analysis, spatial/access planning and rendering. No
// generation cache is used; the editor benchmark measures the complete path.
it('measures full vertical and facade evaluation without cached rule results',()=>{
  const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1),meanMs:values.reduce((a,b)=>a+b,0)/values.length};};
  const rows=[];
  for(const profile of ['shop','office','urban-shop','tower11-d'] as Profile[]){
    const grid=box(24,24,24),doc=createDocument(grid,17,profile),analysis=analyzeVolume(doc.grid,'region-context-v1'),building=doc.buildings[0];
    const base=selectTiles(analysis,{...documentOptions(doc),architecture:undefined});
    const verticalMs:number[]=[],facadeMs:number[]=[];
    for(let i=0;i<41;i++){
      let start=performance.now();
      const vertical=planVertical(building.componentId,doc.grid,analysis.surfaces,building.design,doc.buildingDefinition,doc.seed);
      verticalMs.push(performance.now()-start);
      const options={...documentOptions(doc),context:{design:building.design,sourceRefs:[],reservations:[],envelope:{version:1 as const,requiredBoxes16:[],deferredAttachmentBounds16:[],supportedAssetKeys:[],diagnostics:[]},verticalBands:vertical,entrances:{buildingId:building.componentId,entrances:[],frontages:[],desiredCount:0,unmetCount:0,reservations:[],traces:[]}}};
      start=performance.now();const result=applyFacadeStyle(base,options);facadeMs.push(performance.now()-start);
      expect(result.placements.length).toBe(analysis.surfaces.length);
    }
    rows.push({profile,dimensions:[24,24,24],faces:analysis.surfaces.length,first:{verticalMs:verticalMs[0],facadeMs:facadeMs[0]},repeated:{vertical:summary(verticalMs.slice(1)),facade:summary(facadeMs.slice(1))},samples:{verticalMs,facadeMs}});
  }
  const report={measuredAt:new Date().toISOString(),runtime:process.version,description:'24x24x24, seed 17, immutable analysis/base outside timing, no entrance claims, no cache, 1 first + 40 repeated rule evaluations per style',rows};
  if(process.env.FACADE_BENCH_REPORT)writeFileSync(process.env.FACADE_BENCH_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.rows.map(({samples,...row})=>row)));
},120000);
