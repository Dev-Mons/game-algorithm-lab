import {FACADE_TILE_ROLES,FACADE_TILE_SETS,type FacadeTileRole,type FacadeTileSet} from './core/facade-tile-settings';
import {environmentCache} from './core/environment-cache';
import {canonicalJSON,immutableJSON} from './core/canonical';
import type {MeasurementSample} from './measurement';
import {applyEnvironmentEdit,inputSignature,type EnvironmentEditCommand,type EnvironmentEditRecord} from "./environment-editor";
import {renderPlanInspector} from "./plan-inspector";

import type {SourceRef,InputDelta} from "./core/environment-contract";
import type { AcceptedEditorState } from "./core/environment-generation";
import type { Timings } from "./measurement";

import { editObjects } from "./scene-editor";
import type { ObjectInput } from "./core/scene-inputs";
import { setBuildingTheme } from "./core/document";
import { buildBarHTML, syncBuildBar, toolFromButton, toolLabel, HUD_ICONS, type BuildTool } from "./build-bar";

import "./style.css";
import { type Vec3, type GenerationResult } from "./core/generate";
import {
  createDocument,
  profileData,
  exportDocument,
  loadDocument,
  replaceGrid,
  type Profile,
} from "./core/document";
import { FIXTURES } from "./fixtures";
import { Viewer, type Layer } from "./viewer";
const entranceFaceCount=(result:GenerationResult)=>result.environment?.entrances?.reduce((n,p)=>n+p.entrances.reduce((m,e)=>m+e.faceIds.length,0),0)??result.placements.filter(p=>p.ruleId==='facade.entry'||p.ruleId==='building.entrance').length;
import { DocumentHistory, themeNewBuildings } from "./editor";
import { stepSurface, type SurfaceSelection } from "./surface-edit";
import { generateCity } from "./core/city";
import {
  measuredGeneration,
  BuildingEditMeasurement,
  benchmark,
  type BenchmarkReport,
} from "./measurement";

const hudButton=(id:string,label:string,icon:string)=>`<button id="${id}" class="hud-button" type="button" title="${label}" aria-label="${label}">${icon}</button>`;
const hudMenu=(menu:string,cls:string,label:string,icon:string,body:string)=>`<details class="hud-menu ${cls}" data-menu="${menu}"><summary class="hud-button" title="${label}" aria-label="${label}">${icon}</summary><div class="hud-popover">${body}</div></details>`;
const guide=(rows:[string,string][])=>rows.map(([k,v])=>`<p><b>${k}</b><span>${v}</span></p>`).join('');
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="workspace">
    <section class="stage" aria-label="생성 결과">
      <div id="viewport"></div>
      <div class="hud hud-left">
        <div class="hud-row"><span class="scene-title"><span id="scene-name">빈 장면</span><span id="status" class="status" role="status">READY</span></span></div>
        <div class="hud-row hud-tools">
          <select id="fixture" aria-label="예제 장면" title="예제 장면"></select>
          ${hudButton('new','새 부피',HUD_ICONS.new)}${hudButton('load','JSON 불러오기',HUD_ICONS.load)}${hudButton('save','JSON 저장 (Ctrl+S)',HUD_ICONS.save)}<input id="file" type="file" accept=".json,application/json" hidden>
          <span class="hud-divider"></span>
          ${hudMenu('generate','generate-menu','생성 · 도시',HUD_ICONS.generate,`<h3>생성</h3>
            <div class="seed-row"><label for="seed">Seed<input id="seed" type="number" value="42" min="0" max="4294967295" step="1" required></label><button id="retry" type="button">현재 입력 다시 생성</button></div>
            <h3>도시 부피 생성</h3>
            <div class="coordinates"><label>블록 수<input id="city-blocks" type="number" value="3" min="1" max="4"></label><label>필지 폭<input id="city-lot" type="number" value="4" min="3" max="6"></label><label>도로 폭<input id="city-street" type="number" value="2" min="1" max="4"></label><label>최대 높이<input id="city-height" type="number" value="6" min="1" max="8"></label><label>밀도 %<input id="city-density" type="number" value="100" min="0" max="100"></label><label>배치<select id="city-layout"><option value="grid">격자 거리</option><option value="courtyard">중앙 광장</option></select></label></div>
            <button id="city-generate" class="wide-button primary">현재 Seed로 도시 생성</button>`)}
          ${hudMenu('layers','layers','표시 레이어 · 분석',HUD_ICONS.layers,`<h3>표시 레이어</h3>
            <label class="toggle"><input id="layer-placements" type="checkbox" data-layer="placements" checked><span>배치된 타일</span></label>
            <label class="toggle"><input id="layer-voxels" type="checkbox" data-layer="voxels"><span>원본 부피</span></label>
            <label class="toggle"><input id="layer-surfaces" type="checkbox" data-layer="surfaces"><span>분석된 표면</span></label>
            <div class="legend"><span><i class="wall"></i>외벽</span><span><i class="roof"></i>지붕</span><span><i class="terrace"></i>테라스</span><span><i class="underside"></i>하부면</span></div>
            <label class="toggle"><input id="layer-edges" type="checkbox" data-layer="edges"><span>모서리</span></label>
            <label class="toggle"><input id="layer-normals" type="checkbox" data-layer="normals"><span>외향 법선</span></label>
            <label class="toggle"><input id="layer-regions" type="checkbox" data-layer="regions"><span>선택 영역 경계</span></label>
            <h3>환경</h3>
            <label class="toggle"><input id="environment-inputs" type="checkbox"><span>환경 원본 입력</span></label><label class="toggle"><input id="environment-plans" type="checkbox"><span>환경 계획·예약</span></label>
            <label class="toggle"><input id="ground-visible" type="checkbox" checked><span>표시용 지면·그림자</span></label>
            <label class="inline-field">기준면 Y<input id="ground" type="number" value="0" step="1" aria-label="표시용 기준면 높이"></label>`)}
          ${hudMenu('help','help-menu','조작법',HUD_ICONS.help,`<h3>편집</h3><div class="interaction-guide">${guide([['왼쪽 드래그','영역 선택 · 마지막 블록 중앙에 정사각뿔 표시'],['정사각뿔 드래그','면 바깥쪽으로 추가 · 안쪽으로 제거 (상부 시점은 위/아래)'],['E / Q','선택 영역 한 층 추가 / 제거'],['Esc','선택 해제'],['Ctrl+Z / Ctrl+Shift+Z','실행 취소 / 다시 실행 · Ctrl+S 저장']])}</div>
            <h3>카메라</h3><div class="interaction-guide">${guide([['오른쪽 드래그','회전 · 가운데 드래그 이동 · 휠 확대'],['W/S · A/D','전후 · 좌우 이동']])}</div>
            <h3>도구</h3><div class="interaction-guide">${guide([['건물 스타일','새로 쌓는 독립 부피에 적용 · 건물을 선택한 채 누르면 그 건물에 적용'],['도로','연결과 차선은 자동으로 바뀝니다.'],['인도','기본 지면이라 건물·오브젝트·주차를 위에 둘 수 있습니다. 도로와는 나중에 칠한 쪽이 칸을 차지하고, 도로에 둘러싸이거나 도로 사이에 좁게 낀 인도는 교통섬이 됩니다.'],['주차장·차고','집 외벽에 붙인 1×2 이상, 최대 4×4 직사각형은 차고, 떨어지거나 큰 영역은 지상 주차장입니다.'],['오브젝트','한 층씩 추가·제거합니다. 시설은 외벽 한 줄이면 발코니(1층은 차양), 여러 높이면 비상계단, 지면까지 이어지면 엘리베이터, 옥상은 높이에 따라 설비·물탱크·철탑·안테나가 됩니다.']])}</div>
            <p class="edit-note">입력 범위 32 × 32 × 32칸</p>`)}
        </div>
        <div id="parking-tools" class="context-card" hidden><label class="field-label" for="parking-area">주차·차고 편집 영역</label><select id="parking-area"></select></div>
        <div id="building-selection" class="context-card" hidden><p id="building-id"></p><p class="edit-note">하단 스타일을 누르면 이 건물에 적용 · Esc 선택 해제</p><details id="facade-tiles"><summary>외벽 타일 설정</summary><p class="edit-note">코너 설정 우선 · 출입구와 옥상 경계는 유지</p>${Object.entries(FACADE_TILE_ROLES).map(([role,label])=>`<label for="tile-${role}">${label}</label><select id="tile-${role}"><option value="">컨셉 기본값</option>${Object.entries(FACADE_TILE_SETS).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select>`).join('')}<button id="tile-reset" class="text-button">타일 기본값 복원</button></details></div>
      </div>
      <div class="hud hud-right">
        <div class="camera-bar" aria-label="카메라"><button data-camera="iso" class="active">↗ 전체</button><button data-camera="front">↗ 입면</button><button data-camera="top">↓ 상부</button><button data-camera="below">↥ 하부</button></div>
        <details class="hud-menu inspect-details" data-menu="inspect"><summary class="hud-button" title="생성 결과 검사" aria-label="생성 결과 검사">${HUD_ICONS.inspect}</summary><div class="hud-popover inspect-panel">
          <h3>생성 결과</h3><div id="stats" class="stats"></div><p id="parking-summary" class="edit-note"></p><div id="diagnostics"></div>
          <label class="field-label" for="source-select">원본 입력</label><select id="source-select"></select><div id="plan-inspector"></div>
          <h3>표면 분석 · 생성 근거</h3>
          <label class="field-label" for="region">표면 영역</label><select id="region"></select><div id="region-info"></div>
          <label class="field-label" for="face">선택한 표면</label><select id="face"></select><label class="field-label" for="attachment">구조면 / 부착 모듈</label><select id="attachment" disabled></select><div id="inspector"></div>
          <details><summary>선택 Trace · 전체 근거</summary><pre id="trace"></pre></details>
          <details class="dev-details"><summary>실행 단계 · 성능</summary><div id="timings"></div><p id="pipeline-state" class="edit-note"></p><div id="stage-reports"></div><button id="measure" class="wide-button">생성 성능 측정 ↗</button><p id="measure-status" role="status" class="edit-note"></p><button id="save-measure" class="wide-button" hidden>측정 JSON 저장</button><pre id="measure-report" hidden></pre></details>
        </div></details>
      </div>
      <div id="error" class="error" role="alert" hidden></div>
      <p id="edit-note" role="status" class="edit-toast"></p>
      <div id="selection-status" class="selection-status" role="status">왼쪽 드래그로 영역 선택 · 정사각뿔 드래그 또는 E 추가 / Q 제거</div>
      <div id="build-bar" class="build-bar"></div>
    </section>
  </main>`;

export const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const viewer = new Viewer(
  el("viewport"),
  selectBuildingFace,
  editSelection,
  (message, active) => {
    el("selection-status").textContent = message;
    el("selection-status").classList.toggle("selected", active);
  },
);
const fixture = el<HTMLSelectElement>("fixture"),
  faceSelect = el<HTMLSelectElement>("face");
for (const [id, data] of Object.entries(FIXTURES))
  fixture.add(new Option(data.label, id));
fixture.selectedIndex = -1;
export let currentDocument = createDocument(
  [],
  42,
  "office",
);
const history = new DocumentHistory(currentDocument);
export let currentResult: GenerationResult;
export let acceptedState: AcceptedEditorState | undefined;
export let lastTimings: Timings | undefined;
let selectedBuilding: string | undefined;
let tool: Required<BuildTool> = { mode: "building", style: currentDocument.catalog.id, category: "lighting" };
let selectedSource: SourceRef | undefined;
export let lastEditRecord: EnvironmentEditRecord | undefined;
export let lastInputDelta: InputDelta | undefined;
export let lastEditTotalMs=0;
export let lastMeasurement:MeasurementSample|undefined;
export let startupGenerationCount=0;
const measureMode=new URLSearchParams(location.search).get('measure')==='1';
const buildingEditMeasurement=measureMode?new BuildingEditMeasurement():undefined;
if(buildingEditMeasurement)viewer.onRendered=ms=>buildingEditMeasurement.rendered(ms);
const timeBuildingStep=<T>(stage:string,run:()=>T):T=>buildingEditMeasurement?buildingEditMeasurement.time(stage,run):run();
function initialization(){return {plannerCacheEntries:environmentCache.stats().entries,geometryCacheEntries:viewer.geometryCacheEntries,startupGenerationCount};}
function finishMeasurement(start:number,initializationState:MeasurementSample['initializationState'],before:string,counts:number[],runKind:MeasurementSample['runKind'],operation:MeasurementSample['operation'],editId?:number){
 const inputAfterSignature=inputSignature(history.serializedCurrent),outputSignature=inputSignature(canonicalJSON({placements:currentResult.placements,modules:currentResult.modules,scenePlacements:currentResult.scenePlacements,parking:currentResult.environment?.parking?.map(a=>({quality:a.quality,stalls:a.plans.flatMap(p=>p.stalls)}))}));
 const totalMs=performance.now()-start;
 lastMeasurement={runKind,operation,inputBeforeSignature:before,inputAfterSignature,outputSignature,editId,initializationState,totalMs,commandAndHistoryMs:totalMs-(lastTimings?.total??0),rendererSyncMs:lastTimings?.rendererSync??0,stages:lastTimings?.stages??{},generationCalls:generationCount-counts[0],viewerSyncCalls:viewerSyncCount-counts[1],historyCommitCalls:historyCommitCount-counts[2],telemetry:lastTimings?.telemetry,parkingQuality:currentResult.environment?.parking?.map(p=>p.quality)??[]};return lastMeasurement;
}
function loadAcceptedText(text:string){const doc=loadDocument(text),key='document:'+canonicalJSON(doc),hit=environmentCache.get<typeof doc>(key);if(hit)return hit;environmentCache.putImmutable(key,doc,doc);return doc;}
function measureAcceptance(text?:string){const start=performance.now(),init=initialization(),counts=[generationCount,viewerSyncCount,historyCommitCount],before=inputSignature(history.serializedCurrent);
 if(text!==undefined){if(!acceptDocument(loadAcceptedText(text),true))throw new Error(el('error').textContent??'ACCEPTANCE_FAILED');}else if(!regenerate())throw new Error('REGENERATION_FAILED');
 return finishMeasurement(start,init,before,counts,text===undefined?'warm-repeat':'application-cold','none');
}
let nextEditId=0;
export let generationCount=0,viewerSyncCount=0,historyCommitCount=0;
function refreshEnvironmentSelection(){
  const select=el<HTMLSelectElement>('source-select');
  const sources:SourceRef[]=[...currentDocument.buildings.map(b=>({kind:'building' as const,id:b.componentId})),...currentDocument.sceneInputs.parkingAreas.map(p=>({kind:'parking' as const,id:p.id})),...currentDocument.sceneInputs.objects.map(o=>({kind:'object' as const,id:o.id})),...(currentDocument.sceneInputs.roads.length?[{kind:'road' as const,id:'roads'}]:[]),...(currentDocument.sceneInputs.sidewalks.length?[{kind:'sidewalk' as const,id:'sidewalks'}]:[])];
  if(!sources.some(s=>s.kind===selectedSource?.kind&&s.id===selectedSource.id))selectedSource=undefined;
  select.replaceChildren(new Option('선택 없음',''),...sources.map(s=>new Option(`${s.kind} · ${s.id}`,JSON.stringify(s))));
  select.value=selectedSource?JSON.stringify(selectedSource):'';
  viewer.environmentPreview.select(selectedSource);
  if(currentResult)renderPlanInspector(el('plan-inspector'),currentDocument,currentResult,selectedSource);
  const areas=el<HTMLSelectElement>('parking-area');
  if(areas){const previous=areas.value;areas.replaceChildren(new Option('새 주차·차고 영역',''),...currentDocument.sceneInputs.parkingAreas.map(p=>new Option(p.id,p.id)));areas.value=currentDocument.sceneInputs.parkingAreas.some(p=>p.id===previous)?previous:selectedSource?.kind==='parking'?selectedSource.id:'';}

}
function selectSource(source?:SourceRef){selectedSource=source;refreshEnvironmentSelection();if(source?.kind==='building'){selectedBuilding=source.id;refreshBuildingSelection();}else if(source?.kind==='parking')el<HTMLSelectElement>('parking-area').value=source.id;}
viewer.onSourceSelect=sources=>selectSource(sources[0]);
export function commitEnvironmentEdit(command:EnvironmentEditCommand,start=performance.now()){
  lastMeasurement=undefined;
  const init=initialization(),counts=[generationCount,viewerSyncCount,historyCommitCount],editId=++nextEditId,beforeSignature=inputSignature(history.serializedCurrent);
  try{
    const edit=applyEnvironmentEdit(currentDocument,command);lastInputDelta=edit.delta;
    if(edit.changed&&!acceptDocument(edit.document,false,true))throw new Error(el('error').textContent??'GENERATION_FAILED');
    lastEditRecord={editId,command,beforeSignature:edit.beforeSignature,afterSignature:edit.afterSignature,outcome:'accepted',changed:edit.changed};
    if(command.kind==='parking-add'&&edit.delta.parkingIds.length){selectedSource={kind:'parking',id:edit.delta.parkingIds[0]};refreshEnvironmentSelection();el<HTMLSelectElement>('parking-area').value=edit.delta.parkingIds[0];}
    if(!edit.changed&&lastTimings)lastTimings={...lastTimings,generationCalls:0,viewerSyncCalls:0,total:0};
    return true;
  }catch(error){lastEditRecord={editId,command,beforeSignature,afterSignature:beforeSignature,outcome:'rejected',changed:false};el('edit-note').textContent=error instanceof Error?error.message:String(error);return false;}
  finally{el('viewport').dataset.editRecord=JSON.stringify(lastEditRecord);el('viewport').dataset.executionCounts=JSON.stringify({generationCount,viewerSyncCount,historyCommitCount});if(lastEditRecord?.outcome==='accepted'&&lastEditRecord.changed&&['road-add','road-remove','parking-remove'].includes(command.kind))finishMeasurement(start,init,beforeSignature,counts,command.kind.startsWith('road')?'first-road-edit':'first-area-edit',command.kind==='road-add'?'road-add':command.kind==='road-remove'?'road-remove':'area-remove',editId);lastEditTotalMs=performance.now()-start;}
}

function selectBuildingFace(id: string, attachmentId?: string) {
  selectFace(id, attachmentId);
  selectedBuilding = currentResult?.surfaces.find(s => s.faceId === id)?.componentId;
  refreshBuildingSelection();
}
function refreshBuildingSelection() {
  if (!currentResult?.surfaces.some(s => s.componentId === selectedBuilding)) selectedBuilding = undefined;
  const panel = el("building-selection");
  if (!panel) return;
  panel.hidden = !selectedBuilding;
  viewer.selectBuilding(selectedBuilding);
  if (selectedBuilding) {

    el("building-id").textContent = `건물 ${selectedBuilding}`;
    const style=currentDocument.buildings.find(b=>b.componentId===selectedBuilding)?.theme??currentDocument.buildingDefinition;
    el('facade-tiles').hidden=style.id.startsWith('residential-');
    for(const role of Object.keys(FACADE_TILE_ROLES) as FacadeTileRole[])
      el<HTMLSelectElement>(`tile-${role}`).value=style.tileSettings?.[role]??'';

    el("building-id").textContent += ` · ${style.label}`;
  }
  refreshBuildBar();
}
document.addEventListener("keydown", e => { if (e.key === "Escape") { selectedBuilding = undefined; refreshBuildingSelection(); } });
let valid = true;
let busy = false;
export function showError(error: unknown) {
  valid = !!acceptedState;
  el<HTMLButtonElement>("save").disabled = !valid;
  el("error").hidden = false;
  el("error").textContent = error instanceof Error ? error.message : String(error);
  el("status").textContent = "ERROR";
  el("status").className = "status error-status";

}
export function showResult(result: GenerationResult) {
  valid = true;
  el<HTMLButtonElement>("save").disabled = false;
  currentResult = result;
  el("error").hidden = true;
  const incomplete=result.environment?.stages.some(s=>s.state==='not-implemented'||s.state==='blocked');
  el("status").textContent = incomplete ? 'PREVIEW' : result.status.toUpperCase();
  el('pipeline-state').textContent=incomplete?'개발 미리보기 · 미구현 단계가 있습니다.':'환경 계획 실행 완료';
  el('stage-reports').replaceChildren(...(result.environment?.stages??[]).map(s=>{const p=document.createElement('p');p.className='edit-note';p.dataset.stage=s.stage;p.dataset.state=s.state;p.textContent=`${s.stage}: ${s.state} ${s.reasonCodes.join(', ')}`;return p;}));
  el("status").className = `status ${result.status}`;
  el("stats").innerHTML =
    `<div><strong>${result.cells.length}</strong><span>점유 셀</span></div><div><strong>${result.surfaces.length}</strong><span>외부 표면</span></div><div><strong>${result.placements.length + (result.counters.moduleCount ?? 0) + (result.scenePlacements?.filter(p => p.kind === "building"||p.context==='attached-garage').length ?? 0)}</strong><span>구조 모듈</span></div><div><strong>${result.counters.componentCount}</strong><span>독립 성분</span></div>`;
  if(document.querySelector<HTMLDetailsElement>('.inspect-details')!.open)refreshFaceOptions();
  el('parking-summary').textContent=[...(result.environment?.attachedGarages??[]).map(g=>`${g.areaId}: 집에 붙인 차고 · ${g.bayCount}칸 입구${g.access==='local'?' · 도로 연결 없음':''}`),...(result.environment?.parking??[]).map(p=>`${p.areaId}: ${p.quality.acceptedStalls?`검증 ${p.quality.acceptedStalls}대`:'사용 가능한 구획 없음'} · 차로 ${p.quality.aisleRatio===null?'해당 없음':(p.quality.aisleRatio*100).toFixed(1)+'%'}${p.plans.some(c=>!c.circulation.search.complete)?' · 탐색 한도 내 결과':''}`)].join('\n');
  const regionSelect = el<HTMLSelectElement>("region");
  regionSelect.replaceChildren(
    ...(result.regions ?? []).map(
      (r) => new Option(`${r.regionId} · ${r.faceIds.length}면`, r.regionId),
    ),
  );
  regionSelect.disabled = !result.regions?.length;
  el("region-info").textContent = result.regions
    ? ""
    : "마을 건축 스타일에서 영역을 분석합니다.";
  if (result.surfaces.length&&document.querySelector<HTMLDetailsElement>('.inspect-details')!.open)
    selectFace(
      result.placements.find(
        (p) => p.ruleId === "facade.entry" || p.ruleId === "building.entrance",
      )?.faceId ?? result.environment?.entrances?.flatMap(p=>p.entrances)[0]?.faceIds[0]??result.surfaces[0].faceId,
    );
  else if(!result.surfaces.length) {
    el("inspector").textContent = "빈 부피입니다. 셀을 추가해 시작하세요.";
    el("trace").textContent = "";
    el("attachment").replaceChildren();
    el<HTMLSelectElement>("attachment").disabled = true;
  }
  const diagnostics = el("diagnostics");
  diagnostics.replaceChildren();
  if (result.diagnostics.length) {
    const title = document.createElement("h3");
    title.textContent = `진단 ${result.diagnostics.length}건`;
    diagnostics.append(title);
    for (const d of result.diagnostics.slice(0, 20)) {
      const p = document.createElement("p");
      p.className = "diagnostic";
      p.textContent = `${d.code} @ ${d.location} — ${d.message}`;
      diagnostics.append(p);
    }
  } else
    diagnostics.innerHTML =
      result.scenePlacements?.some(p=>p.kind==="building") ? '<p class="all-clear">✓ 등록된 생성 규칙으로 구조 생성 완료</p>' : '<p class="all-clear">✓ 외피 누락·중복 0 · fallback 0</p>';
}
let inspectorResult:GenerationResult|undefined;
function refreshFaceOptions(){const result=currentResult;if(!result||inspectorResult===result)return;
  faceSelect.replaceChildren(
    ...result.surfaces.map(
      (s) => new Option(`${s.faceId} · ${s.role}`, s.faceId),
    ),
  );
  inspectorResult=result;
}
export function selectFace(id: string, attachmentId?: string) {
  refreshFaceOptions();
  const trace = currentResult?.traces.find((t) => t.faceId === id);
  const attachment = currentResult?.modules?.find(
    (m) =>
      m.moduleId === attachmentId &&
      m.kind === "attachment" &&
      m.hostFaceId === id,
  );
  const module =
    attachment ??
    currentResult?.modules?.find(
      (m) => m.kind === "structure" && m.faceIds.includes(id),
    );
  const custom = currentResult?.scenePlacements?.find(p => p.kind === "building" && p.faceIds?.includes(id))??currentResult?.scenePlacements?.find(p => p.kind === "building" && p.componentId === trace?.componentId);
  const p =
    (!attachment
      ? currentResult?.placements.find((t) => t.faceId === id)
      : undefined) ??
    (module
      ? {
          tileId: module.assetKey,
          ruleId: module.ruleId,
          position2: module.position2,
          orientationId: module.orientationId,
        }
      : custom ? {tileId:custom.asset,ruleId:custom.context,position2:custom.center.map(n=>n*2),orientationId:"PY"} : undefined);
  if (!trace || !p) return;
  faceSelect.value = id;
  const attachmentSelect = el<HTMLSelectElement>("attachment");
  const attachments =
    currentResult.modules?.filter(
      (m) => m.kind === "attachment" && m.hostFaceId === id,
    ) ?? [];
  attachmentSelect.replaceChildren(
    new Option("구조면 선택", ""),
    ...attachments.map(
      (m) => new Option(`${m.assetKey} · ${m.orientationId}`, m.moduleId),
    ),
  );
  attachmentSelect.disabled = attachments.length === 0;
  attachmentSelect.value = attachment?.moduleId ?? "";
  viewer.select(id);
  const region = currentResult.regions?.find(
    (r) => r.regionId === trace.architecture?.regionId,
  );
  if (region) {
    el<HTMLSelectElement>("region").value = region.regionId;
    const names = {
      "component-roof": "최상부 지붕",
      "annex-roof": "낮은 별동 지붕",
      terrace: "열린 테라스",
      "covered-terrace": "상부가 가려진 테라스",
      facade: "외벽 파사드",
      underside: "외부 하부면",
      unsupported: "해석 보류 · 비다양체",
    };
    el("region-info").innerHTML =
      `<p class="region-title">${names[region.interpretation]}</p><p class="edit-note">${region.width} × ${region.height} · ${region.faceIds.length}면 · ${region.rectangular ? "직사각형" : "비정형"}<br>인접 높은 벽: ${region.tallBoundarySides.join(", ") || "없음"} · 상부 가림 ${region.coveredFaceCount}면</p>`;
  }
  const completeFace = currentResult.placements.find(p => p.faceId === id);
  el("inspector").innerHTML =
    `<div class="role-badge ${trace.role}">${trace.role.toUpperCase()}</div><dl><dt>Tile</dt><dd>${p.tileId}</dd><dt>Rule</dt><dd>${p.ruleId}</dd>${completeFace?.faceAssetKey ? `<dt>Face mesh</dt><dd>${completeFace.faceAssetKey}</dd>` : ""}<dt>Component</dt><dd>${trace.componentId}</dd><dt>Position × 2</dt><dd>${p.position2.join(" / ")}</dd><dt>Orientation</dt><dd>${p.orientationId}</dd><dt>Policy</dt><dd>${trace.policy}</dd>${trace.undersideKind ? `<dt>Underside</dt><dd>${trace.undersideKind}</dd>` : ""}${trace.architecture ? `<dt>Facade</dt><dd>${trace.architecture.facadeElement}</dd><dt>Column / Row</dt><dd>${trace.architecture.column} / ${trace.architecture.row}</dd><dt>Palette</dt><dd>${trace.architecture.palette}</dd>` : ""}</dl>`;
  el("trace").textContent = JSON.stringify(
    attachment ? { face: trace, attachment } : trace,
    null,
    2,
  );
  if (trace.facade) {
    const f = trace.facade;
    const info = document.createElement("p");
    info.className = "edit-note";
    info.id = "facade-info";
    info.textContent = `스타일 ${f.styleId} v${f.styleVersion} · 층 ${f.level} · ${f.facade}\n패턴 ${f.patternId} · 모듈 ${f.moduleId}\n묶음 ${f.groupId ?? "없음"} · 조각 ${f.part ?? "없음"}\n외벽 ${f.wallKind === "rooftop" ? "옥상 외벽" : "일반 외벽"} · 상단 마감 ${f.topBoundary ? "있음" : "없음"}\n${f.reason}\n${f.candidates.map((c) => `${c.id}: ${c.reason}`).join("\n")}`;
    if (f.entranceSpan)
      info.textContent += `\n출입구 ${f.entranceSpan}칸 · ${f.portalAccess==='local'?'1층 출입문 · 도로 연결 미확인':'검증된 접근 경로'}`;
    el("inspector").append(info);
  }
  if (module)
    el("inspector").insertAdjacentHTML(
      "beforeend",
      `<p class="edit-note">${module.faceIds.length}면을 대체하는 공유 입체 모듈<br>Scale × 16: ${module.scale16.join(" / ")}</p>`,
    );
  if (attachment) {
    const note = document.createElement("p");
    note.className = "edit-note";
    note.textContent = `장식 부착 · 구조 소유권 없음. ${attachment.reason} · 빈 공간 확인: ${attachment.clearanceCell?.join(", ")}`;
    el("inspector").append(note);
  }
  if (trace.assemblyNote) {
    const p = document.createElement("p");
    p.className = "edit-note";
    p.textContent = trace.assemblyNote;
    el("inspector").append(p);
  }
}
export function regenerate(fit = false) {
  try {
    const { result, timings, execution } = measuredGeneration(currentDocument, viewer);
    const publicationStarted=buildingEditMeasurement?.active?performance.now():undefined;
    immutableJSON(currentDocument);
    acceptedState = {document:currentDocument,execution};
    lastTimings=timings;generationCount+=timings.generationCalls;viewerSyncCount+=timings.viewerSyncCalls;
    showResult(result);
    refreshBuildingSelection();
    refreshEnvironmentSelection();
    el("timings").innerHTML =
      `CPU 전체 <strong>${timings.total.toFixed(2)} ms</strong><br>분석 ${timings.analysis.toFixed(2)} · 선택 ${timings.selection.toFixed(2)} · 표시 동기화 ${timings.rendererSync.toFixed(2)} ms<br>탐색 범위 ${result.counters.paddedCells} cells · 논리 Rule 판단 ${result.counters.ruleEvaluations}회${result.regions ? `<br>표면 영역 ${result.regions.length}개 · 출입구 ${entranceFaceCount(result)}개` : ""}`;
    if (fit) {
      viewer.setCamera("iso");
      document
        .querySelectorAll<HTMLButtonElement>("[data-camera]")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.camera === "iso"),
        );
    }
    if(publicationStarted!==undefined&&buildingEditMeasurement?.active)buildingEditMeasurement.active.steps.publication=performance.now()-publicationStarted;
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}
function acceptDocument(
  next: typeof currentDocument,
  fit = false,
  keepSelection = false,
) {
  if (busy) return false;
  if (!keepSelection) viewer.clearEditSelection();
  if (acceptedState&&timeBuildingStep('acceptanceComparison',()=>canonicalJSON(next)===canonicalJSON(currentDocument))) {
    // A valid no-op import also recovers from an earlier rejected document.
    if (!el('error').hidden) showResult(acceptedState.execution.result);
    return true;
  }
  const previous = currentDocument;
  currentDocument = next;
  if (!regenerate(fit)) {
    currentDocument = previous;
    return false;
  }
  if(timeBuildingStep('history',()=>history.commitAccepted(next)))historyCommitCount++;
  el<HTMLInputElement>("seed").value = String(next.seed);
  return true;
}
export function setDocument(doc: typeof currentDocument) {
  acceptDocument(doc);
}
fixture.addEventListener("change", () => {
  if (busy) return;
  acceptDocument(
    createDocument(
      FIXTURES[fixture.value].cells,
      currentDocument.seed,
      FIXTURES[fixture.value].profile??tool.style,
      FIXTURES[fixture.value].profile||tool.style!==currentDocument.catalog.id?undefined:currentDocument.buildingDefinition,
      undefined, FIXTURES[fixture.value].sceneInputs,
    ),
    true,
  );
  el("scene-name").textContent = FIXTURES[fixture.value].label.split(" · ")[0];
  setBrushStyle(currentDocument.catalog.id);
});
faceSelect.addEventListener("change", () => selectFace(faceSelect.value));
el<HTMLSelectElement>("attachment").addEventListener("change", () =>
  selectFace(faceSelect.value, el<HTMLSelectElement>("attachment").value),
);
el<HTMLSelectElement>("region").addEventListener("change", () => {
  const region = currentResult.regions?.find(
    (r) => r.regionId === el<HTMLSelectElement>("region").value,
  );
  if (region) selectFace(region.faceIds[0]);
});
document
  .querySelectorAll<HTMLInputElement>("[data-layer]")
  .forEach((input) => {
    const sync = () => viewer.setLayer(input.dataset.layer as Layer, input.checked);
    input.addEventListener("change", sync);
    sync();
  });
document
  .querySelectorAll<HTMLButtonElement>("[data-camera]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      viewer.setCamera(button.dataset.camera as "iso" | "below" | "top" | "front");
      document
        .querySelectorAll("[data-camera]")
        .forEach((b) => b.classList.toggle("active", b === button));
    }),
  );
el<HTMLInputElement>("ground").addEventListener("change", () => {
  const y = el<HTMLInputElement>("ground").valueAsNumber;
  if (Number.isFinite(y)) viewer.setGround(y);
});
el<HTMLInputElement>("ground-visible").addEventListener("change", () =>
  viewer.setGroundVisible(el<HTMLInputElement>("ground-visible").checked),
);
viewer.setGroundVisible(el<HTMLInputElement>("ground-visible").checked);
el("build-bar").innerHTML = buildBarHTML();
const hudMenus=[...document.querySelectorAll<HTMLDetailsElement>('.hud-left .hud-menu')];
for(const menu of hudMenus)menu.addEventListener('toggle',()=>{if(menu.open)for(const other of hudMenus)if(other!==menu)other.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const menu of hudMenus)menu.open=false;});
let noteTimer=0;
new MutationObserver(()=>{const note=el('edit-note');note.classList.add('show');clearTimeout(noteTimer);noteTimer=window.setTimeout(()=>note.classList.remove('show'),5000);}).observe(el('edit-note'),{childList:true,characterData:true,subtree:true});
function selectedStyle() {
  return selectedBuilding ? (currentDocument.buildings.find(b => b.componentId === selectedBuilding)?.theme ?? currentDocument.buildingDefinition).id : undefined;
}
let hoveredTool: BuildTool | undefined;
function refreshBuildBar() {
  syncBuildBar(el("build-bar"), tool, selectedStyle());
  el("build-caption").textContent = hoveredTool ? toolLabel(hoveredTool)
    : tool.mode === "building" && selectedBuilding ? `${toolLabel(tool)} · 스타일을 누르면 선택 건물에 적용` : toolLabel(tool);
}
/** A style is the brush for new buildings; with a building selected it also restyles that building. */
function setTool(next: BuildTool) {
  const restyle = next.mode === "building" && selectedBuilding !== undefined;
  if (next.mode !== tool.mode) {
    viewer.setEditMode(next.mode);
    if (!restyle) selectedBuilding = undefined;
  }
  tool = { mode: next.mode, style: next.style ?? tool.style, category: next.category ?? tool.category };
  const mode = tool.mode;
  el("parking-tools").hidden=mode!=="parking";
  if (restyle && selectedStyle() !== tool.style)
    acceptDocument(setBuildingTheme(currentDocument, selectedBuilding!, profileData(tool.style).architecture), false, true);
  refreshBuildingSelection();
}
/** Opening a document only follows its style with the brush; it never restyles a selected building. */
function setBrushStyle(style: Profile) {
  tool = { ...tool, style };
  refreshBuildBar();
}
for (const b of el("build-bar").querySelectorAll<HTMLButtonElement>(".build-tool")) {
  b.addEventListener("click", () => setTool(toolFromButton(b)));
  b.addEventListener("pointerenter", () => { hoveredTool = { ...tool, ...toolFromButton(b) }; refreshBuildBar(); });
  b.addEventListener("pointerleave", () => { hoveredTool = undefined; refreshBuildBar(); });
}
for(const role of Object.keys(FACADE_TILE_ROLES) as FacadeTileRole[])el(`tile-${role}`).addEventListener('change',()=>{
  if(!selectedBuilding)return;
  const style=structuredClone(currentDocument.buildings.find(b=>b.componentId===selectedBuilding)?.theme??currentDocument.buildingDefinition);
  const value=el<HTMLSelectElement>(`tile-${role}`).value as FacadeTileSet|'';
  const settings={...style.tileSettings};
  if(value)settings[role]=value;else delete settings[role];
  if(Object.keys(settings).length)style.tileSettings=settings;else delete style.tileSettings;
  acceptDocument(setBuildingTheme(currentDocument,selectedBuilding,style));
});
el('tile-reset').addEventListener('click',()=>{
  if(!selectedBuilding)return;
  const style=structuredClone(currentDocument.buildings.find(b=>b.componentId===selectedBuilding)?.theme??currentDocument.buildingDefinition);
  delete style.tileSettings;
  acceptDocument(setBuildingTheme(currentDocument,selectedBuilding,style));
});
function inputSettings() {
  return { seed: el<HTMLInputElement>("seed").valueAsNumber };
}
function applyGrid(grid: Vec3[], fit = false, resetScene = false) {
  if (busy) return;
  try {
    const { seed } = inputSettings(), profile = resetScene ? tool.style : currentDocument.catalog.id;
    acceptDocument(
      createDocument(
        grid,
        seed,
        profile,
        profile === currentDocument.catalog.id
          ? currentDocument.buildingDefinition
          : undefined,
        resetScene ? undefined : replaceGrid(currentDocument, grid).buildings,
        resetScene ? undefined : currentDocument.sceneInputs,
      ),
      fit,
    );
    el("scene-name").textContent = "Custom volume";
    fixture.selectedIndex = -1;
  } catch (error) {
    showError(error);
  }
}
function editSelection(selection: SurfaceSelection, mode: "add" | "remove") {
  const commandStart=performance.now();
  if (busy || !valid) return undefined;
  try {
    const inputMode=tool.mode;
    if(inputMode==='parking'||inputMode==='road'||inputMode==='sidewalk'){
      if(selection.direction!=='PY'||selection.cells.some(c=>c[1]!==-1))throw new Error('GROUND_ONLY');
      const cells=selection.cells.map(([x,,z])=>[x,0,z] as Vec3);
      const command:EnvironmentEditCommand={kind:`${inputMode}-${mode}` as EnvironmentEditCommand['kind'],cells,...(inputMode==='parking'&&el<HTMLSelectElement>('parking-area').value?{targetId:el<HTMLSelectElement>('parking-area').value}:{})};
      return commitEnvironmentEdit(command,commandStart)?selection:undefined;
    }
    if (inputMode === "object") {
      const next = editObjects(currentDocument, selection, tool.category, mode);
      if (!next.changed) {
        el("edit-note").textContent = mode === "add" ? "추가할 층이 다른 오브젝트와 겹칩니다. 영역을 다시 선택하세요." : "제거할 층이 비어 있습니다. 영역을 유지합니다.";
        return undefined;
      }
      if (acceptDocument(next.document, false, true)) {
        el("edit-note").textContent = `오브젝트 ${mode === "add" ? "설치" : "제거"} 완료 · 선택 영역 ${selection.cells.length}칸 한 층 · 건물 부피 유지`;
        return next.selection;
      }
      return undefined;
    }
    buildingEditMeasurement?.begin(mode,selection.cells.length,currentDocument.grid.length,initialization());
    const next = timeBuildingStep('surfaceEdit',()=>stepSurface(currentDocument.grid, selection, mode));
    if (!next.changed) {
      el("edit-note").textContent =
        mode === "add"
          ? "추가할 층이 다른 블록과 겹칩니다. 영역을 다시 선택하세요."
          : "제거할 층이 비어 있습니다. 영역을 유지합니다.";
      return undefined;
    }
    const nextDocument=timeBuildingStep('replaceGrid',()=>themeNewBuildings(currentDocument.grid, replaceGrid(currentDocument, next.grid), tool.style));
    if (!acceptDocument(nextDocument, false, true))
      return undefined;
    fixture.selectedIndex = -1;
    el("scene-name").textContent = "Custom volume";
    el("edit-note").textContent =
      `${selection.cells.length}칸 ${mode === "add" ? "추가" : "제거"} · Ctrl+Z 실행 취소`;
    return next.selection;
  } catch (error) {
    // An out-of-bounds gesture must leave the last valid city and selection intact.
    el("edit-note").textContent =
      error instanceof Error ? error.message : String(error);
    return undefined;
  } finally {
    buildingEditMeasurement?.finish(currentDocument.grid.length,lastTimings);
  }
}
el("new").addEventListener("click", () => applyGrid([], true, true));
el("city-generate").addEventListener("click", () => {
  try {
    const city = generateCity({
      seed: inputSettings().seed,
      blocks: el<HTMLInputElement>("city-blocks").valueAsNumber,
      lotSize: el<HTMLInputElement>("city-lot").valueAsNumber,
      streetWidth: el<HTMLInputElement>("city-street").valueAsNumber,
      maxHeight: el<HTMLInputElement>("city-height").valueAsNumber,
      density: el<HTMLInputElement>("city-density").valueAsNumber,
      layout: el<HTMLSelectElement>("city-layout").value as
        | "grid"
        | "courtyard",
    });
    applyGrid(city.cells, true, true);
    el("scene-name").textContent =
      `Generated city · ${city.lots.length} buildings`;
    el("edit-note").textContent =
      `Seed ${city.settings.seed} · ${city.lots.length}개 건물 부피 생성`;
  } catch (error) {
    showError(error);
  }
});
function restoreHistory(direction: "undo" | "redo") {
  if (busy) return;
  const doc = history.peek(direction);
  if (!doc) return;
  viewer.clearEditSelection();
  const previous=currentDocument;
  currentDocument = doc;
  el<HTMLInputElement>("seed").value = String(doc.seed);
  fixture.selectedIndex = -1;
  el("scene-name").textContent = "Restored volume";
  if(regenerate(true))history[direction]();else currentDocument=previous;
}
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || busy) return;
  const target = event.target as HTMLElement;
  if (target.matches("input,textarea,select") || target.isContentEditable)
    return;
  if (event.key.toLowerCase() === "z") {
    event.preventDefault();
    restoreHistory(event.shiftKey ? "redo" : "undo");
  }
  if (event.key.toLowerCase() === "y") {
    event.preventDefault();
    restoreHistory("redo");
  }
  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    el("save").click();
  }
});
el("seed").addEventListener("change", () => applyGrid(currentDocument.grid));
el("retry").addEventListener("click", () => {
  el<HTMLInputElement>("seed").value = String(currentDocument.seed);
  regenerate();
});
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
el("save").addEventListener("click", () => {
  if (valid && !busy)
    download(exportDocument(currentDocument), "form-field.city.json");
});
el("load").addEventListener("click", () =>
  el<HTMLInputElement>("file").click(),
);
el("file").addEventListener("change", async () => {
  const input = el<HTMLInputElement>("file"),
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 20_000_000)
      throw new Error("JSON 파일은 20 MB 이하만 지원합니다.");
    const loaded = loadAcceptedText(await file.text());
    if (!acceptDocument(loaded, true)) return;
    el<HTMLInputElement>("seed").value = String(loaded.seed);
    setBrushStyle(loaded.catalog.id);
    fixture.selectedIndex = -1;
    el("scene-name").textContent = file.name;
    el("edit-note").textContent =
      "저장된 입력과 버전을 검증하고 다시 생성했습니다.";
  } catch (error) {
    showError(error);
  } finally {
    input.value = "";
  }
});
let report: BenchmarkReport | undefined;
el("measure").addEventListener("click", async () => {
  if (busy) return;
  viewer.clearEditSelection();
  busy = true;
  const controls = [
    ...document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >("input,select,button"),
  ];
  controls.forEach((c) => (c.disabled = true));
  el("measure-status").textContent = "측정 준비 중…";
  try {
    report = await benchmark(
      ()=>measureAcceptance(),
      (text) => (el("measure-status").textContent = text),
    );
    el("measure-status").textContent = report.rows
      .map(
        (r) =>
          `${r.name}: p95 ${r.timings.total.p95.toFixed(1)} ms`,
      )
      .join("\n");
    el("measure-report").textContent = JSON.stringify(report);
    el("save-measure").hidden = false;
  } catch (error) {
    el("measure-status").textContent = String(error);
  } finally {
    busy = false;
    controls.forEach((c) => (c.disabled = false));
    regenerate(true);
  }
});
el("save-measure").addEventListener("click", () => {
  if (report)
    download(
      JSON.stringify(report, null, 2) + "\n",
      "form-field.benchmark.json",
    );
});
setTool(tool);
for(const [id,group] of [['environment-inputs',viewer.environmentPreview.inputs],['environment-plans',viewer.environmentPreview.plans]] as const){
  const input=el<HTMLInputElement>(id),sync=()=>{group.visible=input.checked;};
  input.addEventListener('change',sync);sync();
}
el('source-select').addEventListener('change',()=>selectSource(el<HTMLSelectElement>('source-select').value?JSON.parse(el<HTMLSelectElement>('source-select').value):undefined));
document.querySelector<HTMLDetailsElement>('.inspect-details')!.addEventListener('toggle',event=>{if((event.currentTarget as HTMLDetailsElement).open&&currentResult){refreshFaceOptions();selectFace(faceSelect.value||currentResult.surfaces[0]?.faceId);}});
if(!measureMode){startupGenerationCount++;regenerate(true);}else {
 Object.assign(window,{environmentMeasure:{accept:measureAcceptance,repeat:()=>measureAcceptance(),timings:()=>lastTimings,point:(cell:Vec3)=>viewer.projectCell(cell),buildingEdits:()=>buildingEditMeasurement!.samples,resetBuildingEdits:()=>buildingEditMeasurement!.reset(),snapshot:()=>({document:currentDocument,parking:currentResult?.environment?.parking,parkingPlacements:currentResult?.scenePlacements?.filter(p=>p.kind==='parking'),sample:lastMeasurement,edit:lastEditRecord,delta:lastInputDelta,generationCount,viewerSyncCount,historyCommitCount,initialization:initialization()})}});
}
if (import.meta.hot) import.meta.hot.dispose(() => viewer.dispose());
