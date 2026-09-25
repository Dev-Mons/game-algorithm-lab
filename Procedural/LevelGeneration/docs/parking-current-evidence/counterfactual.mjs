import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('src/core/parking-circulation.ts','utf8');
if(!source.includes('.slice(0,4);'))throw new Error('Unexpected gate cap source');
for(const cap of [4,8,16,64]){
  const text=source.replace('.slice(0,4);',`.slice(0,${cap});`).replace(/from (['"])\.\//g,'from $1/src/core/');
  await writeFile(`artifacts/parking-audit/circulation-${cap}.ts`,text+'\nexport {gateCandidates,stripDescriptor,evaluate};\n');
}
const loader=await createServer({root:process.cwd(),configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false}});
try{
 const {analyzeVolume}=await loader.ssrLoadModule('/src/core/regions.ts');
 const {analyzeSpatial}=await loader.ssrLoadModule('/src/core/spatial-analysis.ts');
 const {planParkingStalls}=await loader.ssrLoadModule('/src/core/parking-stalls.ts');
 const plans=JSON.parse(await readFile('artifacts/parking-audit/plans.json','utf8')),comparisons=[];
 for(const id of ['R12-minus-5-5','U16-arms6','neck-two-rooms','rect-6x16'])for(const cap of [4,8,16,64]){
   const {planParkingCirculation}=await loader.ssrLoadModule(`/artifacts/parking-audit/circulation-${cap}.ts`),document=plans[id].document;
   const spatial=analyzeSpatial(document,analyzeVolume(document.grid,'region-context-v1'),[]),started=performance.now();
   const circulation=planParkingCirculation(document,spatial.spatial,spatial.book,spatial.solidIndex);
   const output=planParkingStalls(document,circulation.areas,spatial.spatial,circulation.book,spatial.solidIndex,circulation.domains);
   const row={id,gateCandidateCap:cap,acceptedStalls:output[0].quality.acceptedStalls,potential:output[0].quality.potentialStalls,ms:Math.round(performance.now()-started),components:circulation.areas[0].components.map(c=>({axis:c.axis,offset:c.offset,reasons:c.reasonCodes,trials:c.counters.layoutCandidates,expansions:c.counters.stateExpansions,gates:c.gates.map(g=>g.openingCells)}))};
   comparisons.push(row);console.log(JSON.stringify(row));
 }
 await writeFile('artifacts/parking-audit/gate-counterfactual.json',JSON.stringify({scope:'Diagnostic copies only; production files unchanged. Only the early gate candidate cap was changed. Original reservation/vehicle/stall validation remains active. Extra candidates may also allow more trials within the same production budgets.',comparisons},null,2));
}finally{await loader.close();}
