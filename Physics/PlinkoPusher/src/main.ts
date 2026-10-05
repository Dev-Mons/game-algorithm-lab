import './style.css';
import { PEG_KINDS, type PegKind } from './core/config';
import { PLACEMENTS, type PlacementId } from './core/frame';
import type { Peg } from './core/layout';
import { createScenario, PRESETS, type PresetId, type Quality } from './lab/scenario';
import { liveBackends, type PlinkoBackendId, type PusherBackendId } from './physics/contracts';
import { PLINKO_BACKENDS, PUSHER_BACKENDS } from './physics/registry';
import { Runner } from './app/runner';
import { DeviceView, type CameraPreset } from './view/device-view';
import { bindControls } from './app/controls';
import { createBenchPanel } from './app/bench-panel';
import { renderStats } from './app/stats-panel';
import { $, row } from './app/dom';

const opts = (rec: Record<string, { label: string }>) => Object.entries(rec).map(([id, v]) => `<option value="${id}">${v.label}</option>`).join('');
document.querySelector('#app')!.innerHTML = `
<div id="scene"></div>
<header class="topbar">
  <div class="brand"><b>Tiny<span>Dead</span></b><small>RESOURCE WORKS / 01</small></div>
  <div class="flow" id="flow"></div>
</header>
<nav class="workbench-tools"><button id="lab-toggle" aria-expanded="false">실험 설정</button><button id="stats-toggle" aria-expanded="false">생산 · 검증</button><button id="presentation-add">원재료 +10</button><button id="stock-add">저장통 +100</button><button id="presentation-pause">일시정지</button><button data-cam="all">전체</button><button data-cam="transfer">연결부</button><button data-cam="pusher">푸셔</button></nav>
<aside class="panel left" id="left">
  <section><h3>실행</h3>
    <div class="grid3" id="presets">${(Object.keys(PRESETS) as PresetId[]).map(id => `<button data-preset="${id}" title="${PRESETS[id].description}">${PRESETS[id].label}</button>`).join('')}<button id="demo" title="카메라 순회 + 주기적 묶음 투입">자동 데모</button></div>
    <p class="hint" id="preset-desc"></p>
    <div class="row"><button id="pause">일시정지</button><button id="reset">초기화</button>
      <select id="speed" title="배속">${[0.25, 0.5, 1, 2, 4].map(v => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v}×</option>`).join('')}</select>
      <label class="seed">시드 <input id="seed" type="number" value="1234" min="1" step="1"></label></div>
    <div class="row"><button id="add1">원재료 +1</button><button id="add10">묶음 +10</button><label><input type="checkbox" id="auto"> 자동 공급</label></div>
  </section>
  <section><h3>물리 백엔드 <small>변경 시 동일 초기 상태로 재시작</small></h3>
    <label class="field">플링코 <select id="plinko-backend">${opts(PLINKO_BACKENDS)}</select></label>
    <label class="field">푸셔 <select id="pusher-backend">${opts(PUSHER_BACKENDS)}</select></label>
    <p class="hint" id="backend-note"></p>
    <label class="toggle"><input type="checkbox" id="offscreen"> 화면 밖 처리(처리량 근사)</label>
  </section>
  <section><h3>보드 배치 <small>로컬 2D 계산은 그대로</small></h3>
    <div class="grid3" id="placements">${(Object.keys(PLACEMENTS) as PlacementId[]).map(id => `<button data-placement="${id}" title="${PLACEMENTS[id].description}">${PLACEMENTS[id].label}</button>`).join('')}</div>
    <p class="hint" id="placement-desc"></p>
  </section>
  <section><h3>카메라</h3>
    <div class="row"><button data-cam="all">전체</button><button data-cam="plinko">플링코</button><button data-cam="pusher">푸셔</button><button data-cam="transfer">연결부</button><button data-cam="side">측면</button><button data-cam="rear">후면</button><button data-cam="reset">초기화</button></div>
    <div class="row"><label><input type="checkbox" id="labels"> 공정 라벨</label>
      <label class="field inline">품질 <select id="quality"><option value="low">낮음</option><option value="medium">보통</option><option value="high">높음</option></select></label></div>
  </section>
  <details><summary>설정</summary><div id="sliders"></div>
    <label class="field">페그 종류 배치 <select id="peg-pattern"><option value="mixed">혼합</option><option value="basic">기본만</option><option value="byproduct">부산물 위주</option></select></label>
    <p class="hint">페그 클릭: 개별 종류·레벨 변경. "(재시작)" 항목은 놓으면 재시작한다.</p>
  </details>
</aside>
<aside class="panel right" id="right">
  <section><h3>생산 현황</h3><div class="stats" id="economy"></div></section>
  <section id="peg-panel" hidden><h3>선택한 페그</h3><div id="peg-info" class="stats"></div>
    <div class="row"><select id="peg-kind">${Object.entries(PEG_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select><button id="peg-down">−</button><button id="peg-up">＋</button></div></section>
  <section><h3>검증</h3><div class="stats" id="checks"></div></section>
  <section><h3>성능 <small id="perf-note"></small></h3><div class="stats" id="perf"></div></section>
</aside>
<div class="bench" id="bench">
  <div class="bench-bar"><b>순차 비교</b><button id="bench-run" class="accent">측정 실행</button><span id="bench-status"></span>
    <button id="save-a">결과 → A</button><button id="save-b">결과 → B</button><button id="bench-export">JSON 저장</button><button id="bench-toggle">▾</button></div>
  <div class="bench-body" id="bench-body"></div>
</div>
<div class="overlay" id="offscreen-overlay" hidden><b>화면 밖 처리 중</b><span>물리 월드는 정지·보존되고, 대기열만 처리량 기반 배치 모델로 정산합니다. 측정 대상이 아닙니다.</span></div>
<div id="toast"></div>`;

const view = new DeviceView($('#scene'));
const runner = new Runner(view);
let selected: Peg | null = null;
const benchPanel = createBenchPanel(runner, toast);
(window as unknown as { __lab: unknown }).__lab = { runner, view, liveBackends, slots: benchPanel.slots };
let toastTimer = 0, statsTimer = 0, disposed = false;

function toast(msg: string) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), 3800);
}
runner.onToast = toast;

for (const [id, cls] of [['lab-toggle', 'controls-open'], ['stats-toggle', 'stats-open']]) {
  $(`#${id}`).addEventListener('click', () => { const open = document.body.classList.toggle(cls); $(`#${id}`).setAttribute('aria-expanded', String(open)); });
}
$('#presentation-add').addEventListener('click', () => runner.addRaw(10));
$('#presentation-pause').addEventListener('click', () => { runner.setPaused(!runner.paused); $('#presentation-pause').textContent = $('#pause').textContent = runner.paused ? '재개' : '일시정지'; });
const syncControls = bindControls(runner, view, () => view.showSelection(selected));

// 페그 선택: 클릭(드래그 아님) 위치를 보드 로컬 좌표로 바꿔 판정한다.
let down: { x: number; y: number } | null = null;
const canvas = view.renderer.domElement;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
  down = null;
  const hit = view.pick(e.clientX, e.clientY);
  selected = hit?.peg ?? null;
  view.showSelection(selected);
  renderPeg(hit ? { u: hit.u, v: hit.v } : null);
});
function renderPeg(click: { u: number; v: number } | null) {
  $('#peg-panel').hidden = !selected;
  if (!selected) return;
  const p = selected;
  $('#peg-info').innerHTML = row('번호 / 행·열', `#${p.index} / ${p.row}·${p.col}`) + row('로컬 (u, v)', `${p.u.toFixed(2)}, ${p.v.toFixed(2)}`)
    + (click ? row('클릭 로컬', `${click.u.toFixed(2)}, ${click.v.toFixed(2)}`) : '') + row('종류 · 레벨', `${PEG_KINDS[p.kind].label} · Lv${p.level}`)
    + row('접촉 1회 점수', `가공 ${PEG_KINDS[p.kind].process * p.level} / 부산물 ${PEG_KINDS[p.kind].byproduct * p.level}`);
  $<HTMLSelectElement>('#peg-kind').value = p.kind;
}
const editPeg = (kind: PegKind, level: number) => { if (!selected) return; runner.editPeg(selected.index, kind, level); renderPeg(null); };
$<HTMLSelectElement>('#peg-kind').addEventListener('change', e => selected && editPeg((e.target as HTMLSelectElement).value as PegKind, selected.level));
$('#peg-up').addEventListener('click', () => selected && editPeg(selected.kind, selected.level + 1));
$('#peg-down').addEventListener('click', () => selected && editPeg(selected.kind, selected.level - 1));

runner.onRebuilt = () => { selected = null; view.showSelection(null); renderPeg(null); syncControls(); };

// URL 예: ?preset=stress&plinko=rapier2d&pusher=rapier3d-planar&placement=yaw&paused=1&seedTokens=150
const params = new URLSearchParams(location.search);
const init = async () => {
  const preset = (params.get('preset') as PresetId) ?? 'basic';
  const s = createScenario(PRESETS[preset] ? preset : 'basic', Number(params.get('seed')) || 1234);
  if (params.get('plinko') && params.get('plinko')! in PLINKO_BACKENDS) s.backends.plinko = params.get('plinko') as PlinkoBackendId;
  if (params.get('pusher') && params.get('pusher')! in PUSHER_BACKENDS) s.backends.pusher = params.get('pusher') as PusherBackendId;
  if (params.get('placement') && params.get('placement')! in PLACEMENTS) s.placement = params.get('placement') as PlacementId;
  if (params.get('quality')) s.quality = params.get('quality') as Quality;
  if (params.get('seedTokens') !== null && Number.isFinite(Number(params.get('seedTokens')))) s.initialTokens = Math.max(0, Math.floor(Number(params.get('seedTokens'))));
  await runner.restart(s);
  if (disposed) return;
  view.setCamera((params.get('camera') as CameraPreset) ?? 'all', false);
  runner.paused = params.get('paused') === '1';
  $('#pause').textContent = $('#presentation-pause').textContent = runner.paused ? '재개' : '일시정지';
  runner.start();
  statsTimer = window.setInterval(() => renderStats(runner, benchPanel.lastResult), 250);
  renderStats(runner, benchPanel.lastResult);
  document.body.dataset.ready = '1';
};
init().catch(err => { console.error(err); $('#scene').innerHTML = `<p class="error">초기화 실패: ${String(err)}</p>`; });

import.meta.hot?.dispose(() => {
  disposed = true;
  window.clearInterval(statsTimer); window.clearTimeout(toastTimer);
  runner.dispose(); view.dispose();
});
