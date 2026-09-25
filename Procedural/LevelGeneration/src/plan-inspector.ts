import type {GenerationDocument} from './core/document';
import type {GenerationResult} from './core/generate';
import type {SourceRef} from './core/environment-contract';
const same=(a:SourceRef,b:SourceRef)=>a.kind===b.kind&&a.id===b.id;
export function renderPlanInspector(host:HTMLElement,document:GenerationDocument,result:GenerationResult,source?:SourceRef){
  host.replaceChildren();
  if(!source){host.textContent='원본 입력을 선택하면 설정·계획·생성 근거를 확인할 수 있습니다.';return;}
  const sourceInput=source.kind==='building'?document.buildings.find(b=>b.componentId===source.id):source.kind==='parking'?document.sceneInputs.parkingAreas.find(p=>p.id===source.id):source.kind==='object'?document.sceneInputs.objects.find(o=>o.id===source.id):document.sceneInputs.roads;
  const environment=result.environment;
  const matching=(refs:readonly SourceRef[])=>refs.some(r=>same(r,source));
  const sections:[string,unknown][]=[
    ['원본 입력 · 수동 설정',sourceInput],['실행 단계',environment?.stages],
    ['지지 · 경계 · 도로 관계',{
      supports:environment?.relations?.supports.filter(r=>matching(r.sourceRefs)),
      boundaries:environment?.spatial?.buildingRuns.filter(r=>same(r.owner,source)),
      roads:environment?.relations?.roads.filter(r=>source.kind==='road'||environment.traces.some(t=>matching(t.sourceRefs)&&t.relationIds?.includes(r.module.id))),
      installationProof:'설치 지지이며 하중·이동 증명이 아닙니다. 실제 접근 상태는 선택·탈락 근거에서 확인합니다.',
    }],
    ['분석 · 계획',{wallFacilities:environment?.wallFacilities?.groups.filter(g=>g.objectId===source.id),columns:environment?.columns?.filter(p=>p.buildingId===source.id),facades:environment?.facades?.filter(p=>p.buildingId===source.id),fixtureCounters:environment?.fixtures?.counters,parking:environment?.parking?.filter(a=>a.areaId===source.id),entrances:environment?.entrances?.filter(e=>e.buildingId===source.id),parkingCirculation:environment?.parkingCirculation?.filter(a=>a.areaId===source.id),vertical:environment?.vertical?.filter(v=>v.buildingId===source.id),relations:environment?.spatial?.relations.filter(r=>same(r.from,source)||same(r.to,source)),diagnostics:environment?.spatial?.diagnostics.filter(d=>d.ownerId===source.id)}],
    ['예약 · 실제 경로',{reservations:environment?.reservations.filter(r=>matching(r.sourceRefs)),paths:environment?.overlays?.filter(o=>matching(o.sourceRefs)&&o.path)}],
    ['선택 · 탈락 근거',environment?.traces.filter(t=>matching(t.sourceRefs))],
    ['생성 결과',(result.scenePlacements??[]).filter(p=>matching(p.sourceRefs??[]))],
  ];
  for(const [title,value] of sections){
    const details=host.ownerDocument.createElement('details'),summary=host.ownerDocument.createElement('summary');summary.textContent=title;details.append(summary);
    let rendered=false;details.addEventListener('toggle',()=>{if(details.open&&!rendered){const pre=host.ownerDocument.createElement('pre');pre.textContent=JSON.stringify(value??null,null,2);details.append(pre);rendered=true;}});host.append(details);
  }
}
