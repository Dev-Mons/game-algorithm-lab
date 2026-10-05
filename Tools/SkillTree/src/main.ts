import './style.css';
import './graph.css';
import './settings.css';
import { connect, createNode, createProject, DEFAULT_SIZE, deleteNode, demoProject, exportRows, GRID, History, machineGunProject, nextId, parseProject, renameNode, deletePreset, placePreset, presetFromNode, setNodePreset, updatePreset, withLibrary, type Project, type SkillNode } from './model';
import { connectionEndpoints, nodeBoundary, skillIcon, symbols } from './appearance';
import rowHeader from './unreal/SkillTreeRow.h?raw';
import { configureEffect, descriptionStyles, getDescriptionStyle } from './effect-settings';
import { addTarget, renameTargets, removeTarget, targetsFor, targetUsage } from './target-catalog';
import previewHeader from './unreal/SkillTreePreview.h?raw';

const icons: Record<string, string> = {
  tree: '<path d="M12 3v7M5 14v-4h14v4M5 18v3m14-3v3"/><rect x="9" y="1" width="6" height="5" rx="1"/><rect x="2" y="14" width="6" height="5" rx="1"/><rect x="16" y="14" width="6" height="5" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0)"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  folder: '<path d="M3 7V4h6l2 3h10v13H3z"/>',
  undo: '<path d="m9 4-5 5 5 5M4 9h10a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
  fit: '<path d="M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 7z"/>',
  diamond: '<path d="m12 2 9 10-9 10L3 12zM7 12h10M12 7v10"/>',
  fire: '<path d="M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-6 4-8 0 5 3 5 3-5Z"/><path d="M12 13c-5 5 3 8 3 3"/>',
  snow: '<path d="M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4m15 9-4 1 1 4M3 14l4 1-1 4m15-9-4-1 1-4"/>',
  bolt: '<path d="m14 2-10 12h7l-1 8 10-13h-7z"/>',
};
function icon(name: string): string { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.diamond}</svg>`; }
function escape(value: string): string { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
const $ = <T extends Element = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const STORAGE = 'skill-tree-studio.v1';
let startupWarning = '';
let restored = false;
let initial = withLibrary(machineGunProject());
try { const saved = localStorage.getItem(STORAGE); if (saved) { initial = withLibrary(parseProject(saved)); restored = true; } }
catch { startupWarning = '저장된 작업을 복원하지 못했습니다. 샘플을 표시합니다. 기존 저장본은 다음 편집 전까지 유지됩니다.'; }
const history = new History(initial);
let selected = initial.nodes[0]?.Name ?? '';
let editingPreset = '';
let settingsTab: 'presets' | 'targets' = 'presets';
let settingsQuery = '';
let lastSettingsPreset = '';
let settingsOpener = 'open-settings';
let activePreset = initial.presets?.[0]?.Name ?? '';
let selectedEdge: { from: string; to: string } | null = null;
type Edge = { from: string; to: string };
type ConnectionDrag = {
  pointerId: number; fixed: string; moving: 'from' | 'to'; original: Edge | null;
  sx: number; sy: number; x: number; y: number; candidate: string; moved: boolean;
};
let connectionDrag: ConnectionDrag | null = null;
let suppressClick = false;
let query = '';
let dirty = false;
let snap = true;
let palette: 'fantasy' | 'neon' = 'fantasy';
let showLabels = initial.nodes.some(node => node.Category === '머신건');
let view = { x: 60, y: 60, zoom: 1 };
let drag: { pointerId: number; kind: 'node' | 'pan'; id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number; moved: boolean } | null = null;
let noticeTimer: ReturnType<typeof setTimeout>;

$('#app').innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">${icon('tree')}</span><div>SKILL TREE <b>STUDIO</b><small>VISUAL AUTHORING WORKSPACE</small></div></div>
    <div class="project-heading"><span class="project-dot"></span><input id="project-title" aria-label="프로젝트 이름" maxlength="100"><span class="version">LOCAL</span></div>
    <nav class="file-actions" aria-label="파일"><details id="file-menu" class="file-menu"><summary>${icon('folder')} 파일</summary><div class="file-menu-items"><button id="open">프로젝트 열기</button><button id="new">새 프로젝트</button><span>예제 불러오기</span><button id="machinegun">머신건 스킬</button><button id="demo">아틀라스 예제</button></div></details><button id="save">${icon('download')} 작업 저장</button><button id="open-settings" class="settings-launch">설정</button><button id="export" class="primary">${icon('download')} JSON 내보내기</button></nav>
  </header>
  <main class="workspace">
    <aside class="sidebar"><div class="sidebar-top"><span class="eyebrow">PLACE SKILLS</span><h2>배치할 스킬 <span id="preset-count" class="count"></span></h2><p class="palette-help">드래그하거나 + 버튼으로 배치하세요.</p><label class="search">${icon('search')}<input id="search" placeholder="스킬 찾기" aria-label="스킬 검색"></label></div><div id="preset-list" class="preset-list"></div><button id="add" class="place-active">선택 스킬 배치 <kbd>N</kbd></button><details id="placed-nodes"><summary class="placed-heading">배치된 노드 <span id="node-count" class="count"></span></summary><div id="node-list" class="node-list"></div></details><div class="palette-footer">스킬 정의·효과 대상은 <button id="palette-settings">설정</button>에서 관리합니다.</div></aside>
    <section class="editor" aria-label="스킬 트리 편집기">
      <div class="toolbar"><div class="tool-group"><button id="undo" class="icon-button" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소">${icon('undo')}</button><button id="redo" class="icon-button" title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">${icon('redo')}</button></div><span class="interaction-help">본체: 이동 · + 핀: 연결 · 우클릭 드래그: 화면 이동</span><div class="tool-group"><label class="snap"><input id="snap" type="checkbox" checked> 그리드 스냅</label><span class="divider"></span><button id="fit" title="전체 보기 (F)">${icon('fit')} 전체 보기</button></div></div>
      <div id="canvas" class="canvas" tabindex="0" aria-label="노드 캔버스. 빈 공간을 드래그해 이동하고 휠로 확대합니다."><div class="canvas-caption"><span class="eyebrow">SKILL GRAPH</span><span>선행 스킬에서 다음 스킬로</span></div><svg id="edges" class="edges" aria-label="노드 연결"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs><g id="edge-world"></g><g id="connection-preview"></g></svg><div id="node-world"></div><div id="connection-world"></div><div id="empty" class="empty"><span>${icon('tree')}</span><h2>정의한 스킬을 배치해 보세요</h2><p>왼쪽 프리셋을 드래그하거나 배치 버튼을 누르세요.</p><button id="empty-add" class="primary">${icon('plus')} 선택 스킬 배치</button></div><div id="connection-hint" class="connection-hint" hidden></div></div>
      <div class="canvas-bottom"><div class="view-settings"><select id="palette" aria-label="캔버스 테마"><option value="fantasy">판타지</option><option value="neon">네온</option></select><label><input id="show-labels" type="checkbox"> 이름 표시</label><button id="focus-view" title="패널 접기/펼치기" aria-label="캔버스 넓게 보기">${icon('fit')}</button></div><div><button id="zoom-out" aria-label="축소">−</button><span id="zoom-label">100%</span><button id="zoom-in" aria-label="확대">+</button></div></div>
    </section>
    <aside class="inspector"><div class="inspector-heading"><span class="eyebrow">INSPECTOR</span><h2>배치 속성 <span id="inspector-status">NODE</span></h2></div><div id="inspector-body"></div></aside>
  </main>
  <footer class="statusbar"><span id="save-status"><span class="ready-dot"></span> 로컬 작업 복원됨</span><span id="graph-status"></span><span>좌표: 좌측 상단 · UMG 단위</span></footer>
  <div id="notice" role="status" hidden></div>
  <input id="file" type="file" accept=".json,application/json" hidden>
  <dialog id="export-dialog"><div class="dialog-heading"><div><span class="eyebrow">EXPORT TO UNREAL ENGINE</span><h2>데이터 테이블 JSON</h2></div><button id="close-export" aria-label="닫기">✕</button></div><p class="export-help">각 노드는 하나의 Row입니다. <code>Name</code>은 Row Name, <code>Prerequisites</code>는 선행 노드 ID 배열입니다.</p><div id="export-summary"></div><pre id="json-preview" tabindex="0"></pre><div class="export-note">언리얼의 Row Struct 필드가 아래 계약과 같아야 합니다. 제공하는 C++ 구조체 예시를 사용하거나 README의 필드 표를 참고하세요.</div><div class="dialog-actions"><button id="download-header">구조체 예시 (.h)</button><button id="download-preview-header">수치 계산 예시 (.h)</button><button id="copy-json">JSON 복사</button><button id="download-json" class="primary">${icon('download')} JSON 다운로드</button></div></dialog>
`;


$('#app').insertAdjacentHTML('beforeend', `<dialog id="settings-dialog" aria-labelledby="settings-title"><header class="settings-header"><div><span class="eyebrow">PROJECT SETTINGS</span><h2 id="settings-title">프로젝트 설정</h2><p>스킬의 공통 속성과 효과 대상을 한곳에서 관리합니다.</p></div><button id="close-settings" aria-label="설정 닫기">✕</button></header><div class="settings-layout"><nav class="settings-nav" role="tablist" aria-label="설정 분류" aria-orientation="vertical"><button id="settings-presets" role="tab" aria-controls="settings-presets-panel" aria-selected="true">스킬 프리셋 <span id="settings-preset-count"></span></button><button id="manage-targets" role="tab" aria-controls="settings-targets-panel" aria-selected="false" tabindex="-1">효과 대상 <span id="settings-target-count"></span></button><p>설정은 프로젝트와 함께 저장됩니다.</p></nav><section id="settings-presets-panel" role="tabpanel" aria-labelledby="settings-presets"><aside class="settings-library"><div class="settings-library-tools"><label class="search">${icon('search')}<input id="settings-search" placeholder="프리셋 검색" aria-label="프리셋 검색"></label><button id="new-preset" class="add-button">${icon('plus')} 새 프리셋 정의</button></div><div id="settings-preset-list"></div></aside><div id="preset-editor" class="settings-preset-editor"></div></section><section id="settings-targets-panel" role="tabpanel" aria-labelledby="manage-targets" hidden><div class="settings-section-title"><h3>효과 대상</h3><p>태그 ID만 등록합니다. 변경하면 이 프로젝트의 프리셋과 배치 참조도 함께 갱신됩니다. 사용 중인 태그는 삭제할 수 없습니다.</p></div><form id="add-target-form"><label class="field">새 효과 태그<input id="new-target-tag" aria-label="새 효과 태그" maxlength="128" required spellcheck="false" placeholder="예: MachineGun.ReloadSpeed"></label><button class="primary" type="submit">대상 추가</button></form><p id="target-message" role="alert"></p><div id="target-list"></div></section></div><footer class="settings-footer"><div id="settings-message" role="status"></div><button id="settings-discard">입력 취소</button><button id="settings-done" class="primary">완료</button></footer></dialog>`);

function theme(node: SkillNode): { color: string; symbol: string } {
  return { color: node.NodeColor, symbol: node.IconSymbol };
}
function renderTargetManager() {
  $('#target-list').innerHTML = targetsFor(history.current).map(target => {
    const usage = targetUsage(history.current, target.id);
    const used = usage.presets > 0 || usage.nodes > 0;
    return `<form class="target-row" data-target-row="${escape(target.id)}"><label class="field">태그 ID<input name="tag" aria-label="${escape(target.id)} 태그 ID" value="${escape(target.id)}" maxlength="128" spellcheck="false" required></label><button type="submit">태그 적용</button><button type="button" class="danger" data-delete-target="${escape(target.id)}" ${used ? 'disabled title="프리셋 또는 배치에서 사용 중입니다."' : ''}>삭제</button><div class="target-metadata"><button type="button" data-copy-target="${escape(target.id)}">태그 복사</button><span>프리셋 ${usage.presets} · 배치 ${usage.nodes}${used ? ' · 사용 중' : ''}</span></div></form>`;
  }).join('') || '<p class="muted">등록된 효과 대상이 없습니다. 위에서 태그 ID를 입력해 추가하세요.</p>';
}
function openTargetManager() { openSettings('targets'); }
function targetDrafts() {
  return [...document.querySelectorAll<HTMLFormElement>('#target-list [data-target-row]')].map(form => ({ id: form.dataset.targetRow!, tag: (form.querySelector('input') as HTMLInputElement).value }))
    .filter(draft => targetsFor(history.current).find(target => target.id === draft.id)?.id !== draft.tag.trim());
}
function applyTargetDrafts() {
  const drafts = targetDrafts();
  if (!drafts.length) return true;
  return targetAction(() => {}, '효과 태그를 적용하고 프리셋·배치 참조를 갱신했습니다.');
}
function renderSettingsList() {
  $('#settings-preset-list').innerHTML = (history.current.presets ?? []).filter(preset => `${preset.DisplayName} ${preset.Name}`.toLowerCase().includes(settingsQuery.toLowerCase())).map(preset => `<button class="settings-preset ${editingPreset === preset.Name ? 'selected' : ''}" data-preset="${escape(preset.Name)}" aria-pressed="${editingPreset === preset.Name}"><span class="list-symbol" style="color:${preset.NodeColor}">${skillIcon(preset.IconSymbol)}</span><span><strong>${escape(preset.DisplayName)}</strong><small>${escape(preset.Category || '미분류')} · 최대 ${preset.MaxLevel}회</small></span></button>`).join('') || '<p class="list-empty muted">프리셋이 없습니다.</p>';
}
function renderSettings() {
  const dialog = $<HTMLDialogElement>('#settings-dialog');
  if (!dialog.open) { $('#preset-editor').innerHTML = ''; return; }
  $('#settings-preset-count').textContent = String(history.current.presets?.length ?? 0);
  $('#settings-target-count').textContent = String(targetsFor(history.current).length);
  $('#settings-presets-panel').toggleAttribute('hidden', settingsTab !== 'presets');
  $('#settings-targets-panel').toggleAttribute('hidden', settingsTab !== 'targets');
  for (const [id, page] of [['settings-presets', 'presets'], ['manage-targets', 'targets']]) {
    const tab = $( '#' + id ); tab.setAttribute('aria-selected', String(settingsTab === page)); tab.setAttribute('tabindex', settingsTab === page ? '0' : '-1');
  }
  if (settingsTab === 'presets') {
    if (!history.current.presets?.some(preset => preset.Name === editingPreset)) editingPreset = history.current.presets?.[0]?.Name ?? '';
    renderSettingsList(); renderPresetEditor();
  } else { $('#preset-editor').innerHTML = ''; renderTargetManager(); }
}
function openSettings(page: typeof settingsTab = 'presets', presetId?: string) {
  const dialog = $<HTMLDialogElement>('#settings-dialog');
  if (!applyInspector() || (dialog.open && settingsTab === 'targets' && !applyTargetDrafts())) return;
  if (!dialog.open) settingsOpener = (document.activeElement as HTMLElement)?.id || 'open-settings';
  if (editingPreset) lastSettingsPreset = editingPreset;
  settingsTab = page;
  editingPreset = page === 'presets' ? presetId || lastSettingsPreset || history.current.nodes.find(node => node.Name === selected)?.SkillId || activePreset : '';
  $('#settings-message').textContent = ''; $('#target-message').textContent = '';
  if (!dialog.open) dialog.showModal();
  render();
}
function closeSettings() {
  if (!applyInspector() || (settingsTab === 'targets' && !applyTargetDrafts())) return;
  if (editingPreset) lastSettingsPreset = editingPreset;
  editingPreset = ''; $<HTMLDialogElement>('#settings-dialog').close();
  $('#preset-editor').innerHTML = ''; render();
  (document.getElementById(settingsOpener) ?? $<HTMLElement>('#open-settings')).focus({ preventScroll: true });
}

function targetAction(action: (project: Project) => void, message: string) {
  const drafts = targetDrafts();
  const success = mutate(project => { renameTargets(project, drafts); action(project); });
  if (success) renderTargetManager();
  $('#target-message').textContent = success ? message : $('#settings-message').textContent;
  $('#target-message').classList.toggle('error', !success);
  return success;
}
function notify(message: string, error = false) {
  if ($<HTMLDialogElement>('#settings-dialog').open) { $('#settings-message').textContent = message; $('#settings-message').classList.toggle('error', error); return; }
  clearTimeout(noticeTimer);
  const element = $('#notice');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  noticeTimer = setTimeout(() => { element.hidden = true; }, error ? 9000 : 4000);
}
function persist() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(history.current));
    $('#save-status').innerHTML = '<span class="ready-dot"></span> 브라우저에 자동 저장됨';
  } catch { $('#save-status').textContent = '자동 저장 실패 · 작업 저장으로 파일을 보관하세요'; }
}
function mutate(fn: (project: Project) => void): boolean {
  try {
    const next = structuredClone(history.current);
    fn(next);
    history.commit(next);
    persist();
    render();
    return true;
  } catch (error) { notify((error as Error).message, true); return false; }
}
function render() {
  if (!history.current.nodes.some(node => node.Name === selected)) selected = '';
  $('#project-title').setAttribute('title', history.current.title);
  $<HTMLInputElement>('#project-title').value = history.current.title;
  $('#node-count').textContent = String(history.current.nodes.length).padStart(2, '0');
  $('#graph-status').textContent = `${history.current.nodes.length} 노드 · ${history.current.nodes.reduce((sum, node) => sum + node.Prerequisites.length, 0)} 연결 · 순환 없음`;
  $<HTMLButtonElement>('#undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('#redo').disabled = !history.canRedo;
  if (!history.current.presets?.some(preset => preset.Name === activePreset)) activePreset = history.current.presets?.[0]?.Name ?? '';
  $('#preset-count').textContent = String(history.current.presets?.length ?? 0);
  renderPresets();
  renderList();
  renderGraph();
  renderInspector();
  renderSettings();
}
function renderList() {
  const nodes = history.current.nodes.filter(node => `${node.Name} ${node.DisplayName}`.toLowerCase().includes(query.toLowerCase()));
  const categories = [...new Set(nodes.map(node => node.Category))];
  $('#node-list').innerHTML = categories.map(category => `<div class="category-heading">${escape(category || '미분류')}<span>${nodes.filter(node => node.Category === category).length}</span></div>${nodes.filter(node => node.Category === category).map(node => `<button class="list-node ${node.Name === selected ? 'selected' : ''}" data-select="${escape(node.Name)}"><span class="list-symbol" style="color:${theme(node).color}">${skillIcon(node.IconSymbol)}</span><span><strong>${escape(node.DisplayName)}</strong><small>${escape(node.Name)}</small></span><span class="list-level" title="최대 투자 횟수">${node.MaxLevel}회</span></button>`).join('')}`).join('') || '<p class="muted list-empty">표시할 스킬이 없습니다.</p>';
}
function renderPresets() {
  const presets = (history.current.presets ?? []).filter(preset => `${preset.Name} ${preset.DisplayName}`.toLowerCase().includes(query.toLowerCase()));
  $('#preset-list').innerHTML = presets.map(preset => `<div class="preset-card ${activePreset === preset.Name ? 'active' : ''}" draggable="true" data-preset-id="${escape(preset.Name)}" title="캔버스로 드래그해 배치"><button class="preset-definition" data-choose-preset="${escape(preset.Name)}" aria-label="${escape(preset.DisplayName)} 선택"><span class="list-symbol" style="color:${preset.NodeColor}">${skillIcon(preset.IconSymbol)}</span><span><strong>${escape(preset.DisplayName)}</strong><small>최대 ${preset.MaxLevel}회 · ${history.current.nodes.filter(node => node.SkillId === preset.Name).length}개 배치</small></span></button><button class="preset-place" data-place="${escape(preset.Name)}" aria-label="${escape(preset.DisplayName)} 배치" title="이 스킬 배치">${icon('plus')}</button></div>`).join('') || '<p class="muted list-empty">먼저 새 프리셋을 정의하세요.</p>';
  $<HTMLButtonElement>('#add').disabled = !activePreset;
}
function selectPreset(id: string) {
  const previous = editingPreset;
  if (!applyInspector()) return;
  if (id === previous) id = editingPreset;
  if (!history.current.presets?.some(preset => preset.Name === id)) return;
  editingPreset = id; lastSettingsPreset = id; activePreset = id; render();
}
function createPreset() {
  if (!applyInspector()) return;
  let index = 1;
  const ids = new Set(history.current.presets?.map(preset => preset.Name.toLowerCase()));
  while (ids.has(`preset_${String(index).padStart(3, '0')}`)) index++;
  const id = `Preset_${String(index).padStart(3, '0')}`;
  const preset = presetFromNode(createNode(id, 0, 0));
  preset.DisplayName = '새 스킬 프리셋';
  if (mutate(project => { (project.presets ??= []).push(preset); })) {
    editingPreset = id; lastSettingsPreset = id; activePreset = id; render();
  }
}
function renderPlacementInspector(node: SkillNode) {
  $('#inspector-body').innerHTML = `<div class="selected-summary"><span style="color:${node.NodeColor}">${skillIcon(node.IconSymbol)}</span><div><strong>${escape(node.DisplayName)}</strong><small>${escape(node.Name)}</small></div><button id="duplicate" class="icon-button" title="같은 프리셋으로 복제" aria-label="스킬 복제">${icon('copy')}</button></div>
    <div class="placement-summary"><span>최대 ${node.MaxLevel}회</span><span>${node.Cost} SP</span><button id="edit-preset">프리셋 설정 ↗</button></div>
    <form id="node-form"><section class="form-section"><h3>배치 정보 <span>INSTANCE</span></h3>${field('노드 ID <span>Row Name</span>', 'Name', node.Name, 'text', 'required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" maxlength="64"')}<label class="field">사용할 스킬 프리셋<select name="SkillId">${(history.current.presets ?? []).map(preset => `<option value="${escape(preset.Name)}" ${node.SkillId === preset.Name ? 'selected' : ''}>${escape(preset.DisplayName)} (${escape(preset.Name)})</option>`).join('')}</select></label><div class="field-row">${field('X', 'X', node.X, 'number', 'required step="any" min="-1000000" max="1000000"')}${field('Y', 'Y', node.Y, 'number', 'required step="any" min="-1000000" max="1000000"')}</div></section><div class="apply-row"><button class="primary" type="submit" id="apply">배치 적용</button><span id="draft-status">모든 변경 적용됨</span></div></form>
    <section class="form-section prerequisites"><h3>선행 노드 <span>${node.Prerequisites.length}</span></h3><p class="field-help">연결은 프리셋과 별개로 각 배치에 저장됩니다.</p>${node.Prerequisites.map(id => `<div class="prerequisite"><span>${escape(history.current.nodes.find(item => item.Name === id)!.DisplayName)}<small>${escape(id)}</small></span><button data-remove-parent="${escape(id)}" aria-label="${escape(id)} 선행 연결 삭제">✕</button></div>`).join('') || '<p class="no-parents">선행 조건 없음 · 시작 노드</p>'}<div class="parent-add"><select id="parent-select" aria-label="추가할 선행 스킬"><option value="">선행 노드 선택</option>${history.current.nodes.filter(item => item.Name !== node.Name && !node.Prerequisites.includes(item.Name)).map(item => `<option value="${escape(item.Name)}">${escape(item.DisplayName)} (${escape(item.Name)})</option>`).join('')}</select><button id="add-parent" aria-label="선행 연결 추가">${icon('plus')}</button></div></section><div class="inspector-delete"><button id="delete-node" class="danger">${icon('trash')} 배치 삭제</button><span>프리셋은 유지됩니다.</span></div>`;
}


function point(node: SkillNode) {
  return drag?.kind === 'node' && drag.id === node.Name ? { x: drag.x, y: drag.y } : { x: node.X, y: node.Y };
}
function renderGraph() {
  const nodes = history.current.nodes;
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  $('#node-world').style.transform = transform;
  $('#edge-world').setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.zoom})`);
  $('#canvas').style.backgroundSize = `${GRID * view.zoom}px ${GRID * view.zoom}px`;
  $('#canvas').style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
  $('#canvas').dataset.palette = palette;
  $('#canvas').classList.toggle('show-labels', showLabels);
  $('#canvas').classList.toggle('dragging-connection', !!connectionDrag);
  $('#empty').hidden = nodes.length > 0;
  $('#connection-hint').hidden = !connectionDrag;
  $('#connection-hint').textContent = connectionDrag
    ? `${connectionDrag.original ? '연결 변경' : '새 연결'} · 다른 노드에 놓기 · 빈 곳 / Esc: 취소`
    : '+ 핀: 새 연결 · 선 끝점: 재연결 · Alt+끝점: 연결 해제';
  const byId = new Map(nodes.map(node => [node.Name, node]));
  const handles: string[] = [];
  $('#edge-world').innerHTML = nodes.flatMap(node => node.Prerequisites.map(from => {
    const parent = byId.get(from)!;
    const p = point(parent), n = point(node);
    const endpoints = connectionEndpoints(parent, node, p, n);
    const d = `M${endpoints.from.x},${endpoints.from.y} L${endpoints.to.x},${endpoints.to.y}`;
    const active = selectedEdge?.from === from && selectedEdge.to === node.Name;
    const related = selected === from || selected === node.Name;
    const pending = connectionDrag?.original?.from === from && connectionDrag.original.to === node.Name;
    if (!pending) {
      for (const endpoint of ['from', 'to'] as const) {
        const position = endpoints[endpoint];
        const owner = endpoint === 'from' ? from : node.Name;
        handles.push(`<button class="connection-point ${endpoint}" data-endpoint="${endpoint}" data-endpoint-node="${escape(owner)}" data-from="${escape(from)}" data-to="${escape(node.Name)}" style="left:${position.x}px;top:${position.y}px;width:${16 / view.zoom}px;height:${16 / view.zoom}px" aria-label="${escape(from)} → ${escape(node.Name)} ${endpoint === 'from' ? '시작' : '도착'} 연결 포인트" title="드래그: ${endpoint === 'from' ? '선행' : '후행'} 노드 변경 · Alt+클릭: 이 연결 해제"></button>`);
      }
    }
    return `<g class="edge ${active ? 'selected' : ''} ${related ? 'related' : ''} ${pending ? 'rewiring' : ''}" data-from="${escape(from)}" data-to="${escape(node.Name)}"><path class="edge-hit" d="${d}"/><path class="edge-line" d="${d}" ${active || related ? 'marker-end="url(#arrow)"' : ''}/></g>`;
  })).join('');
  for (const node of nodes) {
    const p = point(node);
    handles.push(`<button class="new-connection-pin" data-connect-node="${escape(node.Name)}" style="left:${p.x + node.NodeSize + 9 / view.zoom}px;top:${p.y - 9 / view.zoom}px;width:${18 / view.zoom}px;height:${18 / view.zoom}px;font-size:${13 / view.zoom}px" aria-label="${escape(node.DisplayName)} 새 연결" title="드래그해서 후행 스킬에 연결">+</button>`);
  }
  $('#connection-world').style.transform = transform;
  $('#connection-world').innerHTML = handles.join('');
  renderConnectionPreview();
  $('#node-world').innerHTML = nodes.map(node => {
    const p = point(node), style = theme(node);
    return `<div class="skill-node shape-${node.NodeShape.toLowerCase()} ${node.NodeSize >= 48 ? 'keystone' : ''} ${selected === node.Name ? 'selected' : ''} ${connectionDrag?.candidate === node.Name ? 'drop-target' : ''}" data-node="${escape(node.Name)}" style="left:${p.x}px;top:${p.y}px;width:${node.NodeSize}px;height:${node.NodeSize}px;--node-color:${style.color}" role="button" tabindex="0" aria-label="${escape(node.DisplayName)} 노드" aria-pressed="${selected === node.Name}" title="${escape(node.DisplayName)} · ${node.Cost} SP · 최대 ${node.MaxLevel}회 투자"><span class="node-frame"></span><span class="node-symbol">${skillIcon(node.IconSymbol)}</span><span class="node-label">${escape(node.DisplayName)}</span><span class="investment-limit" aria-hidden="true">×${node.MaxLevel}</span></div>`;
  }).join('');
}
function field(label: string, name: string, value: string | number, type = 'text', extra = '') {
  return `<label class="field">${label}<input name="${name}" type="${type}" value="${escape(String(value))}" ${extra}></label>`;
}

function renderConnectionPreview() {
  const layer = $('#connection-preview');
  layer.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.zoom})`);
  layer.innerHTML = '';
  if (!connectionDrag?.moved) return;
  const state = connectionDrag;
  const fixed = history.current.nodes.find(node => node.Name === state.fixed)!;
  const candidate = history.current.nodes.find(node => node.Name === state.candidate && node.Name !== state.fixed);
  let start = nodeBoundary(fixed, { x: state.x, y: state.y });
  let end = { x: state.x, y: state.y };
  if (candidate) {
    const snapped = connectionEndpoints(fixed, candidate);
    start = snapped.from; end = snapped.to;
  }
  if (state.moving === 'from') [start, end] = [end, start];
  layer.innerHTML = `<path class="connection-preview" d="M${start.x},${start.y} L${end.x},${end.y}" marker-end="url(#arrow)"/><circle class="preview-point" cx="${start.x}" cy="${start.y}" r="${4 / view.zoom}"/><circle class="preview-point" cx="${end.x}" cy="${end.y}" r="${4 / view.zoom}"/>`;
}
function worldPoint(clientX: number, clientY: number) {
  const bounds = $('#canvas').getBoundingClientRect();
  return { x: (clientX - bounds.left - view.x) / view.zoom, y: (clientY - bounds.top - view.y) / view.zoom };
}
function nodeAt(clientX: number, clientY: number): string {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target || !$('#canvas').contains(target)) return '';
  const node = target.closest<HTMLElement>('[data-node], [data-endpoint-node], [data-connect-node]');
  return node?.dataset.node ?? node?.dataset.endpointNode ?? node?.dataset.connectNode ?? '';
}
function cancelConnection() {
  if (!connectionDrag) return;
  const { pointerId } = connectionDrag;
  connectionDrag = null;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  renderGraph();
}
function disconnect(edge: Edge) {
  selectedEdge = null;
  if (mutate(project => {
    const target = project.nodes.find(node => node.Name === edge.to)!;
    target.Prerequisites = target.Prerequisites.filter(id => id !== edge.from);
  })) notify('연결을 해제했습니다. Ctrl+Z로 복구할 수 있습니다.');
}
function finishConnection(event: PointerEvent) {
  const state = connectionDrag!;
  const target = nodeAt(event.clientX, event.clientY);
  connectionDrag = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!state.moved || !target) { renderGraph(); return; }
  const next: Edge = state.moving === 'to' ? { from: state.fixed, to: target } : { from: target, to: state.fixed };
  if (state.original?.from === next.from && state.original.to === next.to) { renderGraph(); return; }
  // The old connection stays in history until the replacement passes validation.
  const success = mutate(project => {
    if (state.original) {
      const originalTarget = project.nodes.find(node => node.Name === state.original!.to)!;
      originalTarget.Prerequisites = originalTarget.Prerequisites.filter(id => id !== state.original!.from);
    }
    connect(project, next.from, next.to);
  });
  if (success) {
    selected = next.to; selectedEdge = null;
    notify(state.original ? '연결 대상을 변경했습니다.' : '선행 스킬을 연결했습니다.');
  }
  render();
}
function renderInspector() {
  dirty = false;
  const node = history.current.nodes.find(item => item.Name === selected);
  if ($<HTMLDialogElement>('#settings-dialog').open) { $('#inspector-body').innerHTML = '<div class="inspector-empty">프로젝트 설정에서 공통 데이터를 편집 중입니다.</div>'; return; }
  if (selectedEdge) {
    $('#inspector-status').textContent = 'EDGE';
    $('#inspector-body').innerHTML = `<div class="inspector-empty">${icon('link')}<h3>선행 스킬 연결</h3><p>${escape(selectedEdge.from)}<br>↓<br>${escape(selectedEdge.to)}</p><button id="remove-edge" class="danger">${icon('trash')} 연결 삭제</button></div>`;
    return;
  }
  $('#inspector-status').textContent = 'NODE';
  if (!node) {
    $('#inspector-body').innerHTML = `<div class="inspector-empty">${icon('cursor')}<h3>스킬을 선택하세요</h3><p>노드를 클릭하면 정보와<br>선행 조건을 편집할 수 있습니다.</p></div>`;
    return;
  }
  renderPlacementInspector(node);
}
function renderPresetEditor() {
  const definition = history.current.presets?.find(preset => preset.Name === editingPreset);
  if (!definition) { $('#preset-editor').innerHTML = '<div class="inspector-empty"><h3>프리셋을 선택하세요</h3><p>새 프리셋을 정의한 뒤 트리에 배치할 수 있습니다.</p></div>'; return; }
  const node: SkillNode = { ...definition, X: 0, Y: 0, Prerequisites: [] };
  const style = theme(node);
  $('#preset-editor').innerHTML = `
    <div class="selected-summary"><span style="color:${style.color}">${skillIcon(node.IconSymbol)}</span><div><strong>${escape(node.DisplayName)}</strong><small>${escape(node.Name)}</small></div></div>
    <p class="preset-scope">이 프리셋을 사용하는 ${history.current.nodes.filter(item => item.SkillId === node.Name).length}개 노드에 함께 적용됩니다.</p>
    <form id="node-form">    <section class="form-section"><h3>기본 정보</h3>${field('프리셋 ID <span>Skill ID</span>', 'Name', node.Name, 'text', 'required pattern="[A-Za-z_][A-Za-z0-9_]{0,63}" maxlength="64"')}${field('표시 이름', 'DisplayName', node.DisplayName, 'text', 'required')}<label class="field">설명<textarea name="Description" rows="3">${escape(node.Description)}</textarea></label>${field('분류', 'Category', node.Category, 'text', 'list="categories"')}<datalist id="categories"><option value="기본"><option value="화염"><option value="냉기"><option value="번개"><option value="전투"><option value="생명"><option value="제작"></datalist></section>
<section class="form-section investment-section"><h3>투자 횟수 <span>SKILL RANKS</span></h3>${field('최대 투자 횟수', 'MaxLevel', node.MaxLevel, 'number', 'required min="1" max="2147483647" step="1"')}<p class="field-help">이 스킬을 찍을 수 있는 총 횟수입니다.<br>1이면 한 번만 습득할 수 있습니다.</p></section><section class="form-section effect-section"><h3>효과 설정 <button type="button" id="edit-targets">대상 관리</button></h3><label class="field">효과 대상<select name="StatId"><option value="" ${!node.StatId ? 'selected' : ''}>효과 없음</option>${node.StatId && !targetsFor(history.current).some(target => target.id.toLowerCase() === node.StatId.toLowerCase()) ? `<option value="${escape(node.StatId)}" selected disabled>기존 효과 대상 유지</option>` : ''}${targetsFor(history.current).map(target => `<option value="${escape(target.id)}" ${node.StatId.toLowerCase() === target.id.toLowerCase() ? 'selected' : ''}>${escape(target.id)}</option>`).join('')}</select></label><div class="field-row"><label class="field">적용 방식<select name="ModifierOp"><option value="Add" ${node.ModifierOp === 'Add' ? 'selected' : ''}>고정값 증가</option><option value="AddPercent" ${node.ModifierOp === 'AddPercent' ? 'selected' : ''}>비율 증가 (%)</option></select></label>${field('1회 투자 증가량', 'ValuePerRank', node.ValuePerRank, 'number', 'required step="any" min="-1000000" max="1000000"')}</div><p id="effect-setting-summary" class="effect-summary"></p><label class="field">설명 표시 방식<select name="DescriptionStyle">${getDescriptionStyle(node) === 'legacy' ? '<option value="legacy" selected disabled>기존 설명 유지 · 변경하려면 방식 선택</option>' : ''}${Object.entries(descriptionStyles).map(([id, style]) => `<option value="${id}" ${getDescriptionStyle(node) === id ? 'selected' : ''}>${style.label}</option>`).join('')}</select></label><div id="description-structure" class="description-structure"></div><p class="field-help">수치는 언리얼에서 현재 투자 상태로 계산합니다.<br>최대 투자 시에는 자동으로 완료 문구를 표시합니다.</p></section><section class="form-section appearance-section"><h3>노드 디자인 <span>APPEARANCE</span></h3><div class="field-row"><label class="field">모양<select name="NodeShape"><option value="Square" ${node.NodeShape === 'Square' ? 'selected' : ''}>정사각형</option><option value="Diamond" ${node.NodeShape === 'Diamond' ? 'selected' : ''}>마름모</option><option value="Circle" ${node.NodeShape === 'Circle' ? 'selected' : ''}>원형</option></select></label>${field('크기', 'NodeSize', node.NodeSize, 'number', 'required min="24" max="96" step="1"')}</div><div class="field-row">${field('분기 색상', 'NodeColor', node.NodeColor, 'color')}<div class="field">선택 아이콘<div id="symbol-preview" style="color:${style.color}">${skillIcon(node.IconSymbol)}</div></div></div><label class="field">스킬 아이콘<select name="IconSymbol">${Object.keys(symbols).includes(node.IconSymbol) ? '' : `<option value="${escape(node.IconSymbol)}" selected disabled>이전 아이콘 · 머신건으로 표시</option>`}${Object.entries(symbols).map(([id, label]) => `<option value="${id}" ${node.IconSymbol === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="symbol-picker">${Object.entries(symbols).map(([id, label]) => `<button type="button" data-symbol="${id}" class="${node.IconSymbol === id ? 'active' : ''}" title="${label}" aria-label="${label} 아이콘" aria-pressed="${node.IconSymbol === id}">${skillIcon(id)}</button>`).join('')}</div><p class="field-help">디자인 변경 후 속성 적용 · 에셋 경로는 아래에서 설정</p></section>
    <section class="form-section"><h3>스킬 설정</h3><div class="field-row">${field('습득 비용', 'Cost', node.Cost, 'number', 'required min="0" max="2147483647" step="1"')}</div>${field('아이콘 에셋 경로', 'Icon', node.Icon, 'text', 'placeholder="/Game/UI/Icons/T_Flame.T_Flame"')}<p class="field-help">언리얼 에셋 경로를 문자열로 보관합니다.</p>${field('태그 <span>쉼표로 구분</span>', 'Tags', node.Tags.join(', '))}<label class="field">추가 데이터 <span>JSON 객체</span><textarea name="CustomData" class="code-input" rows="3" spellcheck="false">${escape(node.CustomData)}</textarea></label></section>
    <div class="apply-row"><button class="primary" type="submit" id="apply">속성 적용</button><span id="draft-status">모든 변경 적용됨</span></div></form>
    <div class="inspector-delete"><button id="delete-preset" class="danger">${icon('trash')} 프리셋 삭제</button><span>미배치 프리셋만 삭제 가능</span></div>`;
  updateEffectSummary();
}

function applyInspector(): boolean {
  if (!dirty) return true;
  const form = $<HTMLFormElement>('#node-form');
  if (!form || !form.reportValidity()) return false;
  const data = new FormData(form);
  const oldName = editingPreset || selected;
  const name = String(data.get('Name')).trim();
  const wasPreset = !!editingPreset;
  const success = mutate(project => {
    if (wasPreset) {
      const preset = structuredClone(project.presets!.find(item => item.Name === oldName)!);
      preset.Name = name;
      for (const key of ['DisplayName', 'Description', 'Category', 'Icon', 'IconSymbol', 'NodeColor', 'CustomData'] as const) preset[key] = String(data.get(key) ?? preset[key]);
      Object.assign(preset, configureEffect(preset, { target: $<HTMLSelectElement>('[name=StatId]').value, operation: String(data.get('ModifierOp')), amount: Number(data.get('ValuePerRank')), description: $<HTMLSelectElement>('[name=DescriptionStyle]').value }, targetsFor(project)));
      preset.NodeShape = String(data.get('NodeShape')) as SkillNode['NodeShape'];
      for (const key of ['Cost', 'MaxLevel', 'NodeSize'] as const) preset[key] = Number(data.get(key));
      preset.Tags = String(data.get('Tags')).split(',').map(tag => tag.trim()).filter(Boolean);
      updatePreset(project, oldName, preset);
    } else {
      renameNode(project, oldName, name);
      const node = project.nodes.find(item => item.Name === name)!;
      node.X = Number(data.get('X')); node.Y = Number(data.get('Y'));
      setNodePreset(project, node, String(data.get('SkillId')));
    }
  });
  if (success) {
    if (wasPreset) { editingPreset = name; lastSettingsPreset = name; activePreset = name; }
    else selected = name;
    render();
    if ($<HTMLDialogElement>('#settings-dialog').open) { $('#settings-message').textContent = '변경 내용을 저장했습니다.'; $('#settings-message').classList.remove('error'); }
  }
  return success;
}

function updateEffectSummary() {
  const target = document.querySelector<HTMLSelectElement>('[name=StatId]');
  if (!target) return;
  const operation = $<HTMLSelectElement>('[name=ModifierOp]').value;
  const amount = $<HTMLInputElement>('[name=ValuePerRank]');
  const style = $<HTMLSelectElement>('[name=DescriptionStyle]').value;
  const label = targetsFor(history.current).find(item => item.id.toLowerCase() === target.value.toLowerCase())?.id ?? target.value;
  $('#effect-setting-summary').textContent = !target.value ? '효과 없음 · 입력한 기본 설명을 사용합니다.'
    : !amount.checkValidity() ? '올바른 1회 투자 증가량을 입력하세요.'
    : operation === 'AddPercent' ? `투자 1회마다 ${label} 기본값의 ${amount.value}%를 더합니다. 같은 효과의 비율은 합산됩니다.`
    : `투자 1회마다 ${label}에 ${amount.value}을 더합니다. 같은 효과의 증가량은 합산됩니다.`;
  const parts = !target.value ? ['기본 설명 사용'] : Object.hasOwn(descriptionStyles, style)
    ? descriptionStyles[style as keyof typeof descriptionStyles].parts : ['이전에 저장한 설명 유지'];
  $('#description-structure').innerHTML = parts.map(part => `<span>${escape(part)}</span>`).join('');
}
function selectNode(id: string, focus = false) {
  const previous = selected;
  if (!applyInspector()) return;
  if (id === previous) id = selected;
  if (!history.current.nodes.some(node => node.Name === id)) return;
  editingPreset = '';
  selected = id;
  selectedEdge = null;
  if (focus) {
    const node = history.current.nodes.find(item => item.Name === id)!;
    const bounds = $('#canvas').getBoundingClientRect();
    view.x = bounds.width / 2 - (node.X + node.NodeSize / 2) * view.zoom;
    view.y = bounds.height / 2 - (node.Y + node.NodeSize / 2) * view.zoom;
  }
  render();
}
function addNode(x?: number, y?: number, presetId = activePreset) {
  const previousPreset = editingPreset;
  if (!applyInspector()) return;
  if (previousPreset && presetId === previousPreset) presetId = editingPreset;
  const preset = history.current.presets?.find(item => item.Name === presetId);
  if (!preset) { notify('먼저 스킬 프리셋을 정의하고 선택하세요.', true); return; }
  const bounds = $('#canvas').getBoundingClientRect();
  const px = x ?? (bounds.width / 2 - view.x) / view.zoom - preset.NodeSize / 2;
  const py = y ?? (bounds.height / 2 - view.y) / view.zoom - preset.NodeSize / 2;
  let id = '';
  if (mutate(project => { id = placePreset(project, presetId, quantize(px), quantize(py)); })) {
    editingPreset = ''; activePreset = presetId; selected = id; selectedEdge = null; render();
  }
}
function quantize(value: number) { return snap ? Math.round(value / GRID) * GRID : Math.round(value); }
function fit() {
  const nodes = history.current.nodes, bounds = $('#canvas').getBoundingClientRect();
  if (!nodes.length) { view = { x: 60, y: 60, zoom: 1 }; renderGraph(); return; }
  const minX = Math.min(...nodes.map(node => node.X)), minY = Math.min(...nodes.map(node => node.Y));
  const maxX = Math.max(...nodes.map(node => node.X + node.NodeSize)), maxY = Math.max(...nodes.map(node => node.Y + node.NodeSize));
  const zoom = Math.max(0.15, Math.min(1.15, (bounds.width - 100) / (maxX - minX), (bounds.height - 120) / (maxY - minY)));
  view = { zoom, x: (bounds.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (bounds.height - (maxY - minY) * zoom) / 2 - minY * zoom };
  renderGraph();
}
function zoom(factor: number, x = $('#canvas').clientWidth / 2, y = $('#canvas').clientHeight / 2) {
  const next = Math.min(2, Math.max(0.15, view.zoom * factor));
  const ratio = next / view.zoom;
  view = { x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio, zoom: next };
  renderGraph();
}
function link(from: string, to: string) {
  const previous = selected;
  if (!applyInspector()) return;
  if (previous && selected !== previous) {
    if (from === previous) from = selected;
    if (to === previous) to = selected;
  }
  if (mutate(project => connect(project, from, to))) {
    selected = to; selectedEdge = null; render(); notify('선행 스킬을 연결했습니다.');
  }
}
function removeSelected() {
  if (!applyInspector()) return;
  if (selectedEdge) {
    const { from, to } = selectedEdge;
    if (mutate(project => { const node = project.nodes.find(item => item.Name === to)!; node.Prerequisites = node.Prerequisites.filter(id => id !== from); })) { selectedEdge = null; render(); }
  } else if (selected) {
    if (mutate(project => deleteNode(project, selected))) { render(); notify('스킬과 연결을 삭제했습니다. Ctrl+Z로 복구할 수 있습니다.'); }
  }
}
function duplicate() {
  if (!applyInspector() || !selected) return;
  const id = nextId(history.current);
  const source = history.current.nodes.find(node => node.Name === selected)!;
  if (mutate(project => project.nodes.push({ ...structuredClone(source), Name: id, X: source.X + GRID * 2, Y: source.Y + GRID * 2, Prerequisites: [] }))) { selected = id; render(); }
}
function travel(direction: 'undo' | 'redo') {
  cancelConnection();
  // Undo first discards a pending form draft; committed graph history stays intact.
  if (dirty) { renderInspector(); notify('적용 전 속성 변경을 취소했습니다.'); return; }
  history[direction](); if (!history.current.presets?.some(preset => preset.Name === editingPreset)) editingPreset = ''; selectedEdge = null; persist(); render();
}
function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename() { return history.current.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'SkillTree'; }
function save() {
  if (!applyInspector()) return;
  download(`${filename()}.skilltree.json`, JSON.stringify(history.current, null, 2));
  notify('편집용 프로젝트를 저장했습니다. 열기로 다시 편집할 수 있습니다.');
}
function openExport() {
  if (!applyInspector()) return;
  try {
    $('#json-preview').textContent = exportRows(history.current);
    $('#export-summary').textContent = `${history.current.nodes.length} ROWS  /  UTF-8  /  FSkillTreeRow`;
    $<HTMLDialogElement>('#export-dialog').showModal();
  } catch (error) { notify((error as Error).message, true); }
}
function replaceProject(project: Project) {
  if (!applyInspector()) return;
  project = withLibrary(project);
  editingPreset = ''; activePreset = project.presets?.[0]?.Name ?? '';
  if (mutate(next => Object.assign(next, project))) {
    selected = project.nodes[0]?.Name ?? ''; selectedEdge = null; render(); fit();
    notify('프로젝트를 열었습니다. 이전 작업은 실행 취소로 복구할 수 있습니다.');
  }
}

$('#add').addEventListener('click', () => addNode());
$('#open-settings').addEventListener('click', () => openSettings());
$('#palette-settings').addEventListener('click', () => openSettings());
$('#settings-presets').addEventListener('click', () => openSettings('presets'));
$('#close-settings').addEventListener('click', closeSettings);
$('#settings-done').addEventListener('click', closeSettings);
$('#settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
$('#settings-discard').addEventListener('click', () => { dirty = false; renderSettings(); $('#settings-message').textContent = '적용 전 입력을 취소했습니다.'; });
$('#settings-search').addEventListener('input', () => { settingsQuery = $<HTMLInputElement>('#settings-search').value; renderSettingsList(); });
$('#settings-preset-list').addEventListener('click', event => { const button = (event.target as Element).closest<HTMLElement>('[data-preset]'); if (button) selectPreset(button.dataset.preset!); });
$('.settings-nav').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'presets' : event.key === 'End' ? 'targets' : settingsTab === 'presets' ? 'targets' : 'presets';
  openSettings(next);
  if (settingsTab === next) $(next === 'presets' ? '#settings-presets' : '#manage-targets').focus();
});
$('#file-menu').addEventListener('click', event => { if ((event.target as Element).closest('button')) $<HTMLDetailsElement>('#file-menu').open = false; });
document.addEventListener('click', event => { if (!(event.target as Element).closest('#file-menu')) $<HTMLDetailsElement>('#file-menu').open = false; });
$('#manage-targets').addEventListener('click', openTargetManager);
$('#add-target-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#new-target-tag');
  if (targetAction(project => { addTarget(project, input.value); }, '효과 대상을 추가했습니다. 프리셋의 효과 대상 목록에서 선택할 수 있습니다.')) input.value = '';
});
$('#target-list').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  if (form.matches('[data-target-row]')) applyTargetDrafts();
});
$('#target-list').addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLElement>('button');
  if (button?.dataset.deleteTarget) targetAction(project => removeTarget(project, (button.closest('form')!.querySelector('input') as HTMLInputElement).value.trim()), '사용하지 않는 효과 대상을 삭제했습니다. 실행 취소로 복구할 수 있습니다.');
  if (button?.dataset.copyTarget) {
    const tag = (button.closest('form')!.querySelector('input') as HTMLInputElement).value.trim();
    if (!applyTargetDrafts()) return;
    try { await navigator.clipboard.writeText(tag); $('#target-message').textContent = '효과 태그를 복사했습니다.'; }
    catch { $('#target-message').textContent = '복사하지 못했습니다. 표시된 ID를 선택해 복사하세요.'; }
  }
});
$('#empty-add').addEventListener('click', () => addNode());
$('#new').addEventListener('click', () => { if (!applyInspector()) return; replaceProject({ ...createProject(), presets: structuredClone(history.current.presets ?? []), effectTargets: structuredClone([...targetsFor(history.current)]) }); });
$('#new-preset').addEventListener('click', createPreset);
$('#demo').addEventListener('click', () => replaceProject(demoProject()));
$('#machinegun').addEventListener('click', () => { if (!applyInspector()) return; showLabels = true; $<HTMLInputElement>('#show-labels').checked = true; replaceProject(machineGunProject()); });
$('#save').addEventListener('click', save);
$('#export').addEventListener('click', openExport);
$('#open').addEventListener('click', () => { if (applyInspector()) $<HTMLInputElement>('#file').click(); });
$('#file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#file'), file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('10MB 이하의 JSON 파일을 선택하세요.');
    replaceProject(parseProject(await file.text()));
  } catch (error) { notify((error as Error).message, true); }
  input.value = '';
});
$('#project-title').addEventListener('change', () => {
  const title = $<HTMLInputElement>('#project-title').value.trim();
  if (applyInspector() && !mutate(project => { project.title = title; })) $<HTMLInputElement>('#project-title').value = history.current.title;
});
$('#search').addEventListener('input', () => { query = $<HTMLInputElement>('#search').value; renderPresets(); renderList(); });
$('#node-list').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLElement>('[data-select]');
  if (button) selectNode(button.dataset.select!, true);
});
$('#preset-list').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLElement>('button');
  if (button?.dataset.choosePreset && applyInspector()) { activePreset = button.dataset.choosePreset; renderPresets(); }
  if (button?.dataset.place) addNode(undefined, undefined, button.dataset.place);
});
$('#preset-list').addEventListener('dragstart', event => {
  const card = (event.target as Element).closest<HTMLElement>('[data-preset-id]');
  if (!card || !event.dataTransfer) return;
  if (dirty) { event.preventDefault(); notify('입력한 속성을 적용한 뒤 드래그하세요.'); return; }
  event.dataTransfer.setData('application/x-skill-preset', card.dataset.presetId!);
  event.dataTransfer.effectAllowed = 'copy';
});
$('#app').addEventListener('input', event => {
  if ((event.target as Element).closest('#node-form')) {
    dirty = true; $('#draft-status').textContent = '변경 사항 적용 대기';
    if (!editingPreset) return;
    updateEffectSummary();
    const symbol = $<HTMLSelectElement>('[name=IconSymbol]').value;
    $('#symbol-preview').innerHTML = skillIcon(symbol);
    $('#symbol-preview').style.color = $<HTMLInputElement>('[name=NodeColor]').value;
    document.querySelectorAll<HTMLButtonElement>('[data-symbol]').forEach(button => { button.classList.toggle('active', button.dataset.symbol === symbol); button.setAttribute('aria-pressed', String(button.dataset.symbol === symbol)); });
  }
});
$('#app').addEventListener('submit', event => { if ((event.target as Element).id === 'node-form') { event.preventDefault(); applyInspector(); } });
$('#app').addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('button');
  if (!target) return;
  if (target.dataset.symbol) {
    $<HTMLSelectElement>('[name=IconSymbol]').value = target.dataset.symbol;
    $<HTMLSelectElement>('[name=IconSymbol]').dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (target.id === 'delete-node' || target.id === 'remove-edge') removeSelected();
  if (target.id === 'duplicate') duplicate();
  if (target.id === 'edit-targets') openTargetManager();
  if (target.id === 'edit-preset' && applyInspector()) { const presetId = history.current.nodes.find(node => node.Name === selected)?.SkillId; if (presetId) openSettings('presets', presetId); }
  if (target.id === 'delete-preset' && applyInspector()) { if (mutate(project => deletePreset(project, editingPreset))) { editingPreset = ''; render(); } }
  if (target.dataset.removeParent) {
    const parent = target.dataset.removeParent;
    if (applyInspector()) mutate(project => { const node = project.nodes.find(item => item.Name === selected)!; node.Prerequisites = node.Prerequisites.filter(id => id !== parent); });
  }
  if (target.id === 'add-parent') { const parent = $<HTMLSelectElement>('#parent-select').value; if (parent) link(parent, selected); }
});
$('#undo').addEventListener('click', () => travel('undo'));
$('#redo').addEventListener('click', () => travel('redo'));
$('#snap').addEventListener('change', () => { snap = $<HTMLInputElement>('#snap').checked; });
$('#fit').addEventListener('click', fit);
$('#zoom-in').addEventListener('click', () => zoom(1.2));
$('#zoom-out').addEventListener('click', () => zoom(1 / 1.2));
$('#palette').addEventListener('change', () => { palette = $<HTMLSelectElement>('#palette').value as typeof palette; renderGraph(); });
$('#show-labels').addEventListener('change', () => { showLabels = $<HTMLInputElement>('#show-labels').checked; renderGraph(); });
$('#focus-view').addEventListener('click', () => { $('.workspace').classList.toggle('focus-view'); requestAnimationFrame(fit); });
$('#close-export').addEventListener('click', () => $<HTMLDialogElement>('#export-dialog').close());
$('#download-json').addEventListener('click', () => download(`${filename()}.datatable.json`, exportRows(history.current)));
$('#download-preview-header').addEventListener('click', () => download('SkillTreePreview.h', previewHeader, 'text/plain'));
$('#download-header').addEventListener('click', () => download('SkillTreeRow.h', rowHeader, 'text/plain'));
$('#copy-json').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(exportRows(history.current)); $('#copy-json').textContent = '복사 완료'; }
  catch { $('#copy-json').textContent = '복사 실패 · 다운로드를 이용하세요'; }
});

const canvas = $('#canvas');
canvas.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('application/x-skill-preset')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
canvas.addEventListener('drop', event => {
  const id = event.dataTransfer?.getData('application/x-skill-preset');
  if (!id) return;
  event.preventDefault();
  const preset = history.current.presets?.find(item => item.Name === id);
  if (!preset) { notify('이 프로젝트에 없는 프리셋입니다.', true); return; }
  const point = worldPoint(event.clientX, event.clientY);
  addNode(point.x - preset.NodeSize / 2, point.y - preset.NodeSize / 2, id);
});
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || drag || connectionDrag || (event.button !== 0 && event.button !== 1 && event.button !== 2)) return;
  suppressClick = false;
  const target = event.target as Element;
  const nodeElement = target.closest<HTMLElement>('[data-node]');
  const handle = target.closest<HTMLElement>('[data-endpoint]');
  const pin = target.closest<HTMLElement>('[data-connect-node]');
  if (target.closest('button') && !handle && !pin) return;
  let edge = handle ? { from: handle.dataset.from!, to: handle.dataset.to! } : null;
  const previous = selected;
  if (!applyInspector()) return;
  if (edge && selected !== previous) {
    edge = { from: edge.from === previous ? selected : edge.from, to: edge.to === previous ? selected : edge.to };
  }
  let id = nodeElement?.dataset.node ?? pin?.dataset.connectNode ?? '';
  if (id && id === previous) id = selected;
  if (event.button === 0 && (pin || edge)) {
    event.preventDefault();
    suppressClick = true;
    canvas.focus({ preventScroll: true });
    if (event.altKey) { if (edge) disconnect(edge); return; }
    const moving = handle?.dataset.endpoint === 'from' ? 'from' : 'to';
    const fixed = edge ? (moving === 'from' ? edge.to : edge.from) : id;
    const pointer = worldPoint(event.clientX, event.clientY);
    connectionDrag = { pointerId: event.pointerId, fixed, moving, original: edge,
      sx: event.clientX, sy: event.clientY, ...pointer, candidate: '', moved: false };
    editingPreset = '';
    selectedEdge = edge;
    selected = edge ? '' : id;
    canvas.setPointerCapture(event.pointerId);
    render();
    return;
  }
  if (target.closest('.edge') && event.button === 0) return;
  if (id && event.button === 0) {
    selectNode(id);
    const node = history.current.nodes.find(item => item.Name === id)!;
    drag = { pointerId: event.pointerId, kind: 'node', id, sx: event.clientX, sy: event.clientY, ox: node.X, oy: node.Y, x: node.X, y: node.Y, moved: false };
  } else {
    drag = { pointerId: event.pointerId, kind: 'pan', id: '', sx: event.clientX, sy: event.clientY, ox: view.x, oy: view.y, x: view.x, y: view.y, moved: false };
  }
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (connectionDrag) {
    if (connectionDrag.pointerId !== event.pointerId) return;
    const state = connectionDrag;
    state.moved ||= Math.hypot(event.clientX - state.sx, event.clientY - state.sy) >= 3;
    Object.assign(state, worldPoint(event.clientX, event.clientY));
    state.candidate = nodeAt(event.clientX, event.clientY);
    renderGraph();
    return;
  }
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy;
  if (Math.hypot(dx, dy) < 3 && !drag.moved) return;
  drag.moved = true;
  if (drag.kind === 'node') { drag.x = quantize(drag.ox + dx / view.zoom); drag.y = quantize(drag.oy + dy / view.zoom); }
  else { view.x = drag.ox + dx; view.y = drag.oy + dy; }
  renderGraph();
});
canvas.addEventListener('pointerup', event => {
  if (connectionDrag) {
    if (connectionDrag.pointerId === event.pointerId) finishConnection(event);
    return;
  }
  if (!drag || drag.pointerId !== event.pointerId) return;
  const completed = drag; drag = null;
  suppressClick = completed.moved || event.button !== 0;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (completed.kind === 'node' && completed.moved) {
    mutate(project => { const node = project.nodes.find(item => item.Name === completed.id)!; node.X = completed.x; node.Y = completed.y; });
    renderGraph();
  } else if (completed.kind === 'pan' && !completed.moved && event.button === 0) { selected = ''; selectedEdge = null; render(); }
});
function cancelMove() {
  if (!drag) return;
  const cancelled = drag; drag = null;
  if (cancelled.kind === 'pan') { view.x = cancelled.ox; view.y = cancelled.oy; }
  suppressClick = true;
  if (canvas.hasPointerCapture(cancelled.pointerId)) canvas.releasePointerCapture(cancelled.pointerId);
  renderGraph();
}
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointercancel', () => { cancelConnection(); cancelMove(); });
canvas.addEventListener('lostpointercapture', () => { cancelConnection(); cancelMove(); });
window.addEventListener('blur', () => { cancelConnection(); cancelMove(); });
canvas.addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; return; }
  const target = event.target as Element;
  const handle = target.closest<HTMLElement>('[data-endpoint]');
  if (handle && applyInspector()) {
    const edge = { from: handle.dataset.from!, to: handle.dataset.to! };
    if (event.altKey) disconnect(edge);
    else { editingPreset = ''; selected = ''; selectedEdge = edge; render(); }
    return;
  }
  const edge = target.closest<SVGElement>('.edge');
  if (edge && applyInspector()) { editingPreset = ''; selected = ''; selectedEdge = { from: edge.dataset.from!, to: edge.dataset.to! }; render(); }
});
canvas.addEventListener('dblclick', event => {
  if ((event.target as Element).closest('[data-node], .edge, button')) return;
  const bounds = canvas.getBoundingClientRect();
  addNode((event.clientX - bounds.left - view.x) / view.zoom - DEFAULT_SIZE / 2, (event.clientY - bounds.top - view.y) / view.zoom - DEFAULT_SIZE / 2);
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  if (connectionDrag || drag) return;
  const bounds = canvas.getBoundingClientRect();
  zoom(Math.exp(-event.deltaY * 0.001), event.clientX - bounds.left, event.clientY - bounds.top);
}, { passive: false });
document.addEventListener('keydown', event => {
  if ($<HTMLDialogElement>('#settings-dialog').open && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (applyInspector() && (settingsTab !== 'targets' || applyTargetDrafts())) save();
    return;
  }
  if ($<HTMLDialogElement>('#export-dialog').open || $<HTMLDialogElement>('#settings-dialog').open) return;
  if (connectionDrag) {
    event.preventDefault();
    if (event.key === 'Escape') cancelConnection();
    return;
  }
  if (drag) {
    if (event.key === 'Escape') { event.preventDefault(); cancelMove(); }
    return;
  }
  const typing = (event.target as Element).closest('input, textarea, select, [contenteditable]');
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
  if (typing) return;
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(event.shiftKey ? 'redo' : 'undo'); }
  else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); travel('redo'); }
  else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
  else if (event.key === 'Escape') { selected = ''; selectedEdge = null; render(); }
  else if (event.key.toLowerCase() === 'n') addNode();
  else if (event.key.toLowerCase() === 'f') fit();
  else if (event.key === 'Enter' || event.key === ' ') {
    const element = (event.target as Element).closest<HTMLElement>('[data-node]');
    if (element && !(event.target as Element).closest('button')) { event.preventDefault(); selectNode(element.dataset.node!); }
  }
});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
render();
$<HTMLInputElement>('#show-labels').checked = showLabels;
$('#save-status').innerHTML = `<span class="ready-dot"></span> ${restored ? '로컬 작업 복원됨' : '예제 프로젝트 · 편집 시 자동 저장'}`;
requestAnimationFrame(fit);
if (startupWarning) notify(startupWarning, true);
