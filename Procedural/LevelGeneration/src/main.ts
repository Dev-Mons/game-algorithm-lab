import "./style.css";
import { type Vec3, type GenerationResult } from "./core/generate";
import {
  createDocument,
  exportDocument,
  loadDocument,
  replaceGrid,
  type Profile,
} from "./core/document";
import { FIXTURES } from "./fixtures";
import { Viewer, type Layer } from "./viewer";
import { DocumentHistory } from "./editor";
import { stepSurface, type SurfaceSelection } from "./surface-edit";
import { generateCity } from "./core/city";
import {
  measuredGeneration,
  benchmark,
  type BenchmarkReport,
} from "./measurement";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header><a class="brand" href="./"><span class="brand-icon">▧</span> FORM <i>&</i> FIELD</a><span class="header-note">PROCEDURAL CITY LAB <b> / </b> 002</span><span class="tag" id="version-tag">ARCHITECTURE V1</span></header>
  <main>
    <aside class="left-panel">
      <div class="section-heading"><span class="eyebrow">01 / VOLUME</span><span class="live-dot"></span></div>
      <h1>형태에서 도시로.</h1><p class="intro">부피를 쌓으면 외벽과 지붕,<br>테라스가 스스로 자리를 찾습니다.</p>
      <label class="field-label" for="fixture">시작 형태 <span>FIXTURES</span></label>
      <select id="fixture"></select>
      <details class="city-tools"><summary>도시 부피 생성</summary><div class="coordinates"><label>블록 수<input id="city-blocks" type="number" value="3" min="1" max="4"></label><label>필지 폭<input id="city-lot" type="number" value="4" min="3" max="6"></label><label>도로 폭<input id="city-street" type="number" value="2" min="1" max="4"></label></div><div class="coordinates"><label>최대 높이<input id="city-height" type="number" value="6" min="1" max="8"></label><label>밀도 %<input id="city-density" type="number" value="100" min="0" max="100"></label></div><label class="field-label" for="city-layout">도시 배치</label><select id="city-layout"><option value="grid">격자 거리</option><option value="courtyard">중앙 광장</option></select><button id="city-generate" class="wide-button primary">현재 Seed로 도시 생성</button><p class="edit-note">생성 후 표면 드래그로 편집하세요. 파일에는 완성된 부피 전체를 저장합니다.</p></details>
      <div id="editor-slot"></div>
      <details class="layers"><summary>표시 레이어 · 분석</summary><div class="section-heading"><span class="eyebrow">02 / LAYERS</span><span class="muted">독립 표시</span></div>
        <label class="toggle"><input id="layer-voxels" type="checkbox" data-layer="voxels"><span>원본 부피</span><small>VOXELS</small></label>
        <label class="toggle"><input id="layer-surfaces" type="checkbox" data-layer="surfaces"><span>분석된 표면</span><small>SURFACES</small></label>
        <label class="toggle"><input id="layer-placements" type="checkbox" data-layer="placements" checked><span>배치된 타일</span><small>TILES</small></label>
        <label class="toggle"><input id="layer-edges" type="checkbox" data-layer="edges" checked><span>모서리</span><small>EDGES</small></label>
        <label class="toggle"><input id="layer-normals" type="checkbox" data-layer="normals"><span>외향 법선</span><small>NORMALS</small></label>
        <label class="toggle"><input id="layer-regions" type="checkbox" data-layer="regions"><span>선택 영역 경계</span><small>REGION</small></label>
        <label class="toggle"><input id="ground-visible" type="checkbox" checked><span>표시용 지면·그림자</span><small>GROUND</small></label>
      </details>
      <p class="edit-note">분석 표면 색상</p><div class="legend"><span><i class="wall"></i>외벽</span><span><i class="roof"></i>지붕</span><span><i class="terrace"></i>테라스</span><span><i class="underside"></i>하부면</span></div>
      <p class="footnote">1 CELL = 1 UNIT<br>입력 범위 32 × 32 × 32 · 면 공유 연결</p>
    </aside>
    <section class="stage" aria-label="생성 결과">
      <div class="stage-top"><span class="breadcrumb">WORKSPACE <b>/</b> <span id="scene-name">Village quarter</span></span><span id="status" class="status" role="status">READY</span></div>
      <div id="viewport"></div>
      <div id="error" class="error" role="alert" hidden></div>
      <div class="camera-bar" aria-label="카메라"><button data-camera="iso" class="active">↗ 전체</button><button data-camera="top">↓ 상부</button><button data-camera="below">↥ 하부</button><label>기준면 Y <input id="ground" type="number" value="0" step="1" aria-label="표시용 기준면 높이"></label></div>
      <div id="selection-status" class="selection-status" role="status">좌·우 드래그로 영역을 선택하세요.</div><div class="stage-bottom"><span>가운데 드래그 회전 · Shift + 가운데 드래그 이동 · 휠 확대</span></div>
    </section>
    <aside class="right-panel">
      <div class="section-heading"><span class="eyebrow">03 / INSPECT</span><span class="muted">LIVE</span></div>
      <h2>생성 결과</h2><div id="stats" class="stats"></div>
      <div id="timings"></div>
      <details class="inspect-details"><summary>표면 분석 · 생성 근거</summary><div class="section-heading inspector-heading"><span class="eyebrow">FACE INSPECTOR</span></div>
      <label class="field-label" for="region">표면 영역</label><select id="region"></select><div id="region-info"></div>
      <label class="field-label" for="face">선택한 표면</label><select id="face"></select><label class="field-label" for="attachment">구조면 / 부착 모듈</label><select id="attachment" disabled></select><div id="inspector"></div>
      <details><summary>선택 Trace · 전체 근거</summary><pre id="trace"></pre></details>
      <div id="diagnostics"></div><div id="benchmark-slot"></div></details>
    </aside>
  </main>
  <footer><span><i class="live-dot"></i> LOCAL GENERATION</span><span>VOLUME → REGION → FACADE → TILE</span><span>SHARED MODULAR PANELS</span></footer>`;

export const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const viewer = new Viewer(
  el("viewport"),
  selectFace,
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
fixture.value = "quarter";
export let currentDocument = createDocument(
  FIXTURES.quarter.cells,
  42,
  "crafted-hip",
);
const history = new DocumentHistory(currentDocument);
export let currentResult: GenerationResult;
let valid = true;
let busy = false;
export function showError(error: unknown) {
  valid = false;
  el<HTMLButtonElement>("save").disabled = true;
  el("error").hidden = false;
  el("error").textContent =
    error instanceof Error ? error.message : String(error);
  el("status").textContent = "ERROR";
  el("status").className = "status error-status";
  viewer.clearEditSelection();
  viewer.clear();
  el("stats").textContent = "생성 실패 · 이전 결과를 표시하지 않습니다.";
  faceSelect.replaceChildren();
  el("attachment").replaceChildren();
  el<HTMLSelectElement>("attachment").disabled = true;
  el("region").replaceChildren();
  el("region-info").textContent = "";
  el("inspector").replaceChildren();
  el("trace").textContent = "";
  el("diagnostics").replaceChildren();
  el("timings").replaceChildren();
}
export function showResult(result: GenerationResult) {
  valid = true;
  el<HTMLButtonElement>("save").disabled = false;
  currentResult = result;
  el("version-tag").textContent =
    currentDocument.algorithmVersion.toUpperCase();
  el("error").hidden = true;
  el("status").textContent = result.status.toUpperCase();
  el("status").className = `status ${result.status}`;
  el("stats").innerHTML =
    `<div><strong>${result.cells.length}</strong><span>점유 셀</span></div><div><strong>${result.surfaces.length}</strong><span>외부 표면</span></div><div><strong>${result.placements.length + (result.counters.moduleCount ?? 0)}</strong><span>구조 모듈</span></div><div><strong>${result.counters.componentCount}</strong><span>독립 성분</span></div>`;
  faceSelect.replaceChildren(
    ...result.surfaces.map(
      (s) => new Option(`${s.faceId} · ${s.role}`, s.faceId),
    ),
  );
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
  if (result.surfaces.length)
    selectFace(
      result.placements.find(
        (p) => p.ruleId === "facade.entry" || p.ruleId === "building.entrance",
      )?.faceId ?? result.surfaces[0].faceId,
    );
  else {
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
      '<p class="all-clear">✓ 외피 누락·중복 0 · fallback 0</p>';
}
export function selectFace(id: string, attachmentId?: string) {
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
      : undefined);
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
  el("inspector").innerHTML =
    `<div class="role-badge ${trace.role}">${trace.role.toUpperCase()}</div><dl><dt>Tile</dt><dd>${p.tileId}</dd><dt>Rule</dt><dd>${p.ruleId}</dd><dt>Component</dt><dd>${trace.componentId}</dd><dt>Position × 2</dt><dd>${p.position2.join(" / ")}</dd><dt>Orientation</dt><dd>${p.orientationId}</dd><dt>Policy</dt><dd>${trace.policy}</dd>${trace.undersideKind ? `<dt>Underside</dt><dd>${trace.undersideKind}</dd>` : ""}${trace.architecture ? `<dt>Facade</dt><dd>${trace.architecture.facadeElement}</dd><dt>Column / Row</dt><dd>${trace.architecture.column} / ${trace.architecture.row}</dd><dt>Palette</dt><dd>${trace.architecture.palette}</dd>` : ""}</dl>`;
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
    info.textContent = `스타일 ${f.styleId} v${f.styleVersion} · 층 ${f.level} · ${f.facade}\n패턴 ${f.patternId} · 모듈 ${f.moduleId}\n묶음 ${f.groupId ?? "없음"} · 조각 ${f.part ?? "없음"}\n상단 마감 ${f.topBoundary ? "있음" : "없음"}\n${f.reason}\n${f.candidates.map((c) => `${c.id}: ${c.reason}`).join("\n")}`;
    if (f.entranceSpan)
      info.textContent += `\n출입구 ${f.entranceSpan}칸 · 중앙 대칭 배치`;
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
    const { result, timings } = measuredGeneration(currentDocument, viewer);
    showResult(result);
    el("timings").innerHTML =
      `CPU 전체 <strong>${timings.total.toFixed(2)} ms</strong><br>분석 ${timings.analysis.toFixed(2)} · 선택 ${timings.selection.toFixed(2)} · 표시 동기화 ${timings.rendererSync.toFixed(2)} ms<br>탐색 범위 ${result.counters.paddedCells} cells · Rule 평가 ${result.counters.ruleEvaluations}회${result.regions ? `<br>표면 영역 ${result.regions.length}개 · 출입구 ${result.placements.filter((p) => p.ruleId === "facade.entry" || p.ruleId === "building.entrance").length}개` : ""}`;
    if (fit) {
      viewer.setCamera("iso");
      document
        .querySelectorAll<HTMLButtonElement>("[data-camera]")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.camera === "iso"),
        );
    }
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
  const previous = currentDocument;
  currentDocument = next;
  if (!regenerate(fit)) {
    currentDocument = previous;
    return false;
  }
  history.commit(next);
  el<HTMLInputElement>("seed").value = String(next.seed);
  el<HTMLSelectElement>("profile").value = next.catalog.id;
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
      currentDocument.catalog.id,
      currentDocument.buildingDefinition,
    ),
    true,
  );
  el("scene-name").textContent = FIXTURES[fixture.value].label.split(" · ")[0];
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
  .forEach((input) =>
    input.addEventListener("change", () =>
      viewer.setLayer(input.dataset.layer as Layer, input.checked),
    ),
  );
document
  .querySelectorAll<HTMLButtonElement>("[data-camera]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      viewer.setCamera(button.dataset.camera as "iso" | "below" | "top");
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
viewer.setGroundVisible(true);
el("editor-slot").innerHTML = `
  <div class="editor-title"><span>직접 편집</span><button id="new" class="text-button">새 부피</button></div>
  <div class="interaction-guide"><p><b>왼쪽 드래그</b><span>영역 선택 후 블록 추가</span></p><p><b>오른쪽 드래그</b><span>영역 선택 후 블록 제거</span></p><p><b>선택 중 좌 / 우 클릭</b><span>같은 영역 한 층 추가 / 제거</span></p><p><b>Esc</b><span>선택 해제</span></p></div>
  <div class="seed-row"><label for="seed">Seed<input id="seed" type="number" value="42" min="0" max="4294967295" step="1" required></label><label for="profile">건축 스타일<select id="profile"><option value="shop">상가형 · 층/연결 창문</option><option value="office">업무형 · 층/연결 창문</option><option value="crafted-hip">입체 · 우진각</option><option value="crafted-gable">입체 · 박공</option><option value="crafted-flat">입체 · 평지붕</option><option value="village">마을 건축 v2</option><option value="reference">기본 패널 v1</option><option value="variants">2종 변형 v1</option></select></label></div>
  <div class="button-row"><button id="save">↓ JSON 저장</button><button id="load">↑ 불러오기</button></div><input id="file" type="file" accept=".json,application/json" hidden>
  <button id="retry" class="text-button">현재 입력 다시 생성</button><p id="edit-note" role="status" class="edit-note">표면이나 빈 바닥을 드래그하세요.
실행 취소 Ctrl+Z · 다시 실행 Ctrl+Shift+Z</p>`;
el("benchmark-slot").innerHTML =
  '<button id="measure" class="wide-button">생성 성능 측정 ↗</button><p id="measure-status" role="status" class="edit-note"></p><button id="save-measure" class="wide-button" hidden>측정 JSON 저장</button><pre id="measure-report" hidden></pre>';
function inputSettings() {
  return {
    seed: el<HTMLInputElement>("seed").valueAsNumber,
    profile: el<HTMLSelectElement>("profile").value as Profile,
  };
}
function applyGrid(grid: Vec3[], fit = false) {
  if (busy) return;
  try {
    const { seed, profile } = inputSettings();
    acceptDocument(
      createDocument(
        grid,
        seed,
        profile,
        profile === currentDocument.catalog.id
          ? currentDocument.buildingDefinition
          : undefined,
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
  if (busy || !valid) return undefined;
  try {
    const next = stepSurface(currentDocument.grid, selection, mode);
    if (!next.changed) {
      el("edit-note").textContent =
        mode === "add"
          ? "추가할 층이 다른 블록과 겹칩니다. 영역을 다시 선택하세요."
          : "제거할 층이 비어 있습니다. 영역을 유지합니다.";
      return undefined;
    }
    if (!acceptDocument(replaceGrid(currentDocument, next.grid), false, true))
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
  }
}
el("new").addEventListener("click", () => applyGrid([], true));
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
    applyGrid(city.cells, true);
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
  const doc = history[direction]();
  if (!doc) return;
  viewer.clearEditSelection();
  currentDocument = doc;
  el<HTMLInputElement>("seed").value = String(doc.seed);
  el<HTMLSelectElement>("profile").value = doc.catalog.id;
  fixture.selectedIndex = -1;
  el("scene-name").textContent = "Restored volume";
  regenerate(true);
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
for (const id of ["seed", "profile"])
  el(id).addEventListener("change", () => applyGrid(currentDocument.grid));
el("retry").addEventListener("click", () => {
  el<HTMLInputElement>("seed").value = String(currentDocument.seed);
  el<HTMLSelectElement>("profile").value = currentDocument.catalog.id;
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
    const loaded = loadDocument(await file.text());
    acceptDocument(loaded, true);
    el<HTMLInputElement>("seed").value = String(loaded.seed);
    el<HTMLSelectElement>("profile").value = loaded.catalog.id;
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
      viewer,
      (text) => (el("measure-status").textContent = text),
    );
    el("measure-status").textContent = report.rows
      .map(
        (r) =>
          `${r.input.catalog.id}/${r.name}: p95 ${r.timings.total.p95.toFixed(1)} ms`,
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
el<HTMLSelectElement>("profile").value = currentDocument.catalog.id;
regenerate(true);
if (import.meta.hot) import.meta.hot.dispose(() => viewer.dispose());
