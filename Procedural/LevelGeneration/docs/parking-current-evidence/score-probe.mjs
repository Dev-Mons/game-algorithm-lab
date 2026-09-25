import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const loader=await createServer({root:process.cwd(),configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false}});
try{
 const {gateCandidates,stripDescriptor,evaluate}=await loader.ssrLoadModule('/artifacts/parking-audit/circulation-4.ts');
 const {analyzeVolume}=await loader.ssrLoadModule('/src/core/regions.ts');
 const {analyzeSpatial}=await loader.ssrLoadModule('/src/core/spatial-analysis.ts');
 const {AccessSearch}=await loader.ssrLoadModule('/src/core/access-graph.ts');
 const {ParkingCharge}=await loader.ssrLoadModule('/src/core/parking-budget.ts');
 const {VehicleDomain}=await loader.ssrLoadModule('/src/core/vehicle-domain.ts');
 const {planParkingStalls}=await loader.ssrLoadModule('/src/core/parking-stalls.ts');
 const plans=JSON.parse(await readFile('artifacts/parking-audit/plans.json','utf8')),report=[];
 for(const id of ['R12','U16-arms6','L16','square-16']){
  const {document,areas}=plans[id],area=document.sceneInputs.parkingAreas[0],existing=areas[0].plans[0],cells=existing.circulation.eligibleCells,allocation=existing.circulation.budget;
  const spatial=analyzeSpatial(document,analyzeVolume(document.grid,'region-context-v1'),[]),gates=gateCandidates(area,cells,document,spatial.solidIndex,[]);
  const domain=new VehicleDomain([...cells,...document.sceneInputs.roads,...gates.flatMap(g=>g.gate.connectorCells)],4),search=new AccessSearch(spatial.spatial,document,spatial.book,spatial.solidIndex),rows=[];
  for(const gate of gates)for(const axis of ['X','Z'])for(let offset=0;offset<9;offset++){
   const candidateId=`${gate.gate.id}:${axis}:${offset}`,charge=new ParkingCharge(allocation),descriptor=stripDescriptor(area,cells,axis,offset,4);
   try{
    const trial=evaluate(area,cells,gate,descriptor,document,spatial.spatial,spatial.book,spatial.solidIndex,[],charge,domain,search);if(!trial)continue;
    const circulation={areaId:area.id,components:[trial.plan],ledger:areas[0].ledger,excludedRoadCells:[],excludedSolidCells:[]};
    const [checked]=planParkingStalls(document,[circulation],spatial.spatial,trial.book,spatial.solidIndex,new Map([[`${area.id}:${trial.plan.componentKey}`,domain]]));
    const originalTrace=existing.circulation.traces.flatMap(t=>t.candidates).find(c=>c.candidateId===candidateId);
    rows.push({candidateId,axis,offset,potential:trial.potential,accepted:checked.quality.acceptedStalls,aisle:checked.quality.vehicleCellsInArea,reasonsInOriginal:originalTrace?.reasonCodes??['NOT_EVALUATED']});
   }catch(error){if(!['LayoutRejected','ParkingBudgetExceeded'].includes(error.constructor.name))throw error;}
  }
  const best=[...rows].sort((a,b)=>b.accepted-a.accepted||a.aisle-b.aisle)[0];
  const item={id,current:{accepted:existing.stalls.length,potential:existing.quality.potentialStalls,axis:existing.circulation.axis,offset:existing.circulation.offset},bestAfterStallProof:best,rows};report.push(item);console.log(JSON.stringify({...item,rows:rows.length}));
 }
 await writeFile('artifacts/parking-audit/score-counterfactual.json',JSON.stringify({scope:'Audit all 72 combinations of the existing four gate candidates and 18 fixed strip patterns; score each with the unchanged production stall validator. This offline comparison does not claim the runtime aggregate budget or a globally optimal layout.',report},null,2));
}finally{await loader.close();}
