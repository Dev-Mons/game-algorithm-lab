import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.cwd(),output=resolve(root,'artifacts/parking-audit');await mkdir(output,{recursive:true});
const loader=await createServer({root,configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false}});
try{
  const {parkingFixture}=await loader.ssrLoadModule('/src/parking-fixtures.ts');
  const {createDocument,replaceSceneInputs,setBuildingRule}=await loader.ssrLoadModule('/src/core/document.ts');
  const {generateDocument}=await loader.ssrLoadModule('/src/core/generate-document.ts');
  const {validateStallProof}=await loader.ssrLoadModule('/src/core/parking-stalls.ts');
  const rect=(w,d,x=0,z=0)=>Array.from({length:w*d},(_,i)=>[x+i%w,0,z+Math.floor(i/w)]);
  const make=(cells,w,roadWidth=4)=>createDocument([],42,'office',undefined,undefined,{version:2,roads:rect(w,roadWidth,0,-roadWidth),objects:[],parkingAreas:[{id:'lot',anchor:[0,0,0],cells}]});
  const cases=['R12','R30','L16','O30','D12','boundary'].map(id=>({id,document:parkingFixture(id)}));
  for(const n of [6,8,10,14,16])cases.push({id:`square-${n}`,document:make(rect(n,n),n)});
  for(const [w,d] of [[6,16],[8,16],[10,16],[16,6],[16,8]])cases.push({id:`rect-${w}x${d}`,document:make(rect(w,d),w)});
  cases.push({id:'U16-arms6',document:make(rect(16,16).filter(([x,,z])=>x<6||x>=10||z<6),16)});
  cases.push({id:'neck-two-rooms',document:make([...rect(10,12),...rect(10,12,14,0),...rect(4,2,10,5)],24)});
  for(const width of [1,2,3])cases.push({id:`R12-road-width${width}`,document:make(rect(12,12),12,width)});
  const original=parkingFixture('R12'),noRoad=structuredClone(original);noRoad.sceneInputs.roads=[];cases.push({id:'R12-no-road',document:noRoad});
  const edits=[[0,0,11],[5,0,11],[11,0,11],[5,0,5],[11,0,5]];
  for(const c of edits){const doc=structuredClone(original);doc.sceneInputs.parkingAreas[0].cells=doc.sceneInputs.parkingAreas[0].cells.filter(p=>String(p)!==String(c));cases.push({id:`R12-minus-${c[0]}-${c[2]}`,document:doc});}
  const rows=[],plans={};
  for(const {id,document} of cases){
    const started=performance.now(),stages={},begins={};
    const result=generateDocument(document,{cache:false,stageHook(stage,edge){if(edge==='start')begins[stage]=performance.now();else stages[stage]=performance.now()-begins[stage];}});
    const elapsed=performance.now()-started,areas=result.environment.parking??[],q=areas[0]?.quality;
    let proofChecks=0;
    for(const area of areas)for(const p of area.plans){const mask=new Set([...document.sceneInputs.roads,...p.circulation.aisleCells,...p.circulation.gates.flatMap(g=>[...g.openingCells,...g.connectorCells])].map(String));for(const stall of p.stalls)proofChecks+=validateStallProof(stall,mask);}
    const components=areas.flatMap(a=>a.plans.map(p=>({key:p.circulation.componentKey,status:p.circulation.status,axis:p.circulation.axis,offset:p.circulation.offset,stalls:p.stalls.length,potential:p.quality.potentialStalls,reasonCodes:p.circulation.reasonCodes,gates:p.circulation.gates.map(g=>({opening:g.openingCells,heading:g.inwardHeading})),counters:p.circulation.counters,rejections:p.quality.primaryRejectionCounts,candidateReasons:Object.fromEntries([...new Set(p.circulation.traces.flatMap(t=>t.candidates.flatMap(c=>c.reasonCodes)))].map(code=>[code,p.circulation.traces.flatMap(t=>t.candidates).filter(c=>c.reasonCodes.includes(code)).length]))})));
    const row={id,elapsedMs:Math.round(elapsed*10)/10,stages,quality:q,components,proofChecks,stallKeys:areas.flatMap(a=>a.plans.flatMap(p=>p.stalls.map(s=>`${s.rear}|${s.heading}`)))};rows.push(row);plans[id]={document,areas};
    console.log(JSON.stringify({id,ms:row.elapsedMs,stalls:q?.acceptedStalls,potential:q?.potentialStalls,aisle:q?.vehicleCellsInArea,walk:q?.walkOnlyCellsInArea,remainder:q?.unallocatedCells,eligible:q?.eligibleCells,components:components.map(c=>({axis:c.axis,offset:c.offset,stalls:c.stalls,potential:c.potential,reasons:c.reasonCodes,rejections:c.rejections,candidateReasons:c.candidateReasons}))}));
    if(['R12','L16','U16-arms6','rect-6x16','boundary','R12-minus-5-5'].includes(id))await writeFile(resolve(output,`${id}.json`),JSON.stringify(document));
  }
  const baseKeys=new Set(rows.find(r=>r.id==='R12').stallKeys);
  const editChanges=rows.filter(r=>r.id.startsWith('R12-minus')).map(r=>({id:r.id,before:baseKeys.size,after:r.stallKeys.length,retained:r.stallKeys.filter(k=>baseKeys.has(k)).length,removed:[...baseKeys].filter(k=>!r.stallKeys.includes(k)),added:r.stallKeys.filter(k=>!baseKeys.has(k))}));
  console.log(JSON.stringify({editChanges}));
  // The multi-storey building rule is separate from ground parking proof.
  const grid=Array.from({length:4*3*4},(_,i)=>[i%4,Math.floor(i/16),Math.floor(i/4)%4]);
  const building=setBuildingRule(createDocument(grid,42,'office'),'0,0,0','parking'),buildingResult=generateDocument(building,{cache:false});
  const buildingSummary={cells:grid.length,parkingAreas:building.sceneInputs.parkingAreas.length,provenStalls:buildingResult.environment.parking?.flatMap(a=>a.plans.flatMap(p=>p.stalls)).length??0,assets:Object.fromEntries([...new Set(buildingResult.scenePlacements.map(p=>p.asset))].map(a=>[a,buildingResult.scenePlacements.filter(p=>p.asset===a).length]))};
  await writeFile(resolve(output,'parking-building.json'),JSON.stringify(building));
  await writeFile(resolve(output,'report.json'),JSON.stringify({sourceCommit:'abb1d0318226b4913c78679db8c8008289ddf0c2',scope:'Single uncached sample per scenario; core time, not browser latency. No optimality or real vehicle-physics claim.',rows,editChanges,buildingSummary},null,2));
  await writeFile(resolve(output,'plans.json'),JSON.stringify(plans));
  console.log(JSON.stringify({buildingSummary}));
}finally{await loader.close();}
