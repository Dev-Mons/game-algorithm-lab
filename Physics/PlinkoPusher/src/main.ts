import './style.css';
import { MAX_PEG_LEVEL, PEG_KINDS, type PegKind } from './core/config';
import { PLACEMENTS, type PlacementId } from './core/frame';
import type { Peg } from './core/layout';
import { overview, type BenchResult } from './lab/bench';
import { createScenario, PRESETS, type PresetId, type Quality, type Scenario } from './lab/scenario';
import { liveBackends, type PlinkoBackendId, type PusherBackendId } from './physics/contracts';
import { PLINKO_BACKENDS, PUSHER_BACKENDS } from './physics/registry';
import { Runner } from './app/runner';
import { DeviceView, type CameraPreset } from './view/device-view';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const opts = (rec: Record<string, { label: string }>) => Object.entries(rec).map(([id, v]) => `<option value="${id}">${v.label}</option>`).join('');
type Slider = { key: string; label: string; min: number; max: number; step: number; get: (s: Scenario) => number; set: (s: Scenario, v: number) => void; restart?: boolean; unit?: string };
const SLIDERS: Slider[] = [
  { key: 'supply', label: '공급량', unit: '/s', min: 0, max: 60, step: 0.5, get: s => s.flow.supplyPerSec, set: (s, v) => { s.flow.supplyPerSec = v; } },
  { key: 'release', label: '플링코 처리량', unit: '/s', min: 0.5, max: 60, step: 0.5, get: s => s.flow.plinkoReleasePerSec, set: (s, v) => { s.flow.plinkoReleasePerSec = v; } },
  { key: 'level', label: '페그 레벨', min: 1, max: MAX_PEG_LEVEL, step: 1, get: s => s.pegs.level, set: (s, v) => { s.pegs.level = v; } },
  { key: 'mainBase', label: '본 가치(기본)', min: 1, max: 50, step: 1, get: s => s.economy.mainBase, set: (s, v) => { s.economy.mainBase = v; } },
  { key: 'byCoef', label: '부산물 계수', min: 0, max: 5, step: 0.1, get: s => s.economy.byproductCoef, set: (s, v) => { s.economy.byproductCoef = v; } },
  { key: 'bundle', label: '토큰 묶음 상한', min: 1, max: 6, step: 1, get: s => s.economy.tokenBundleMax, set: (s, v) => { s.economy.tokenBundleMax = v; } },
  { key: 'period', label: '푸셔 왕복 주기', unit: 's', min: 0.8, max: 6, step: 0.1, get: s => s.tray.period, set: (s, v) => { s.tray.period = v; } },
  { key: 'stroke', label: '푸셔 스트로크', min: 0.4, max: 4, step: 0.1, get: s => s.tray.stroke, set: (s, v) => { s.tray.stroke = v; } },
  { key: 'trayMax', label: '트레이 토큰 상한', min: 50, max: 3000, step: 10, get: s => s.flow.trayMaxTokens, set: (s, v) => { s.flow.trayMaxTokens = v; }, restart: true },
  { key: 'seedTokens', label: '초기 적재 토큰', min: 0, max: 2400, step: 10, get: s => s.initialTokens, set: (s, v) => { s.initialTokens = v; }, restart: true },
];

document.querySelector('#app')!.innerHTML = `
<div id="scene"></div>
<header class="topbar">
  <div class="brand"><b>PLINKO</b><span>→</span><b>PUSHER</b><small>가공 장치 실험</small></div>
  <div class="flow" id="flow"></div>
</header>
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
    <div class="row"><button data-cam="all">전체</button><button data-cam="plinko">플링코</button><button data-cam="pusher">푸셔</button><button data-cam="reset">초기화</button></div>
    <div class="row"><label><input type="checkbox" id="labels" checked> 공정 라벨</label>
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
let lastResult: BenchResult | null = null;
const slots: { A: BenchResult | null; B: BenchResult | null } = { A: null, B: null };
(window as unknown as { __lab: unknown }).__lab = { runner, view, liveBackends, slots };

function toast(msg: string) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('visible');
  clearTimeout((toast as unknown as { t: number }).t);
  (toast as unknown as { t: number }).t = window.setTimeout(() => el.classList.remove('visible'), 3800);
}
runner.onToast = toast;

function syncControls() {
  const s = runner.scenario;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === s.preset));
  document.querySelectorAll<HTMLButtonElement>('[data-placement]').forEach(b => b.classList.toggle('active', b.dataset.placement === s.placement));
  $('#preset-desc').textContent = PRESETS[s.preset].description;
  $('#placement-desc').textContent = PLACEMENTS[s.placement].description;
  $<HTMLSelectElement>('#plinko-backend').value = s.backends.plinko;
  $<HTMLSelectElement>('#pusher-backend').value = s.backends.pusher;
  $('#backend-note').textContent = `${PLINKO_BACKENDS[s.backends.plinko].note} / ${PUSHER_BACKENDS[s.backends.pusher].note}`;
  $<HTMLInputElement>('#auto').checked = s.flow.autoSupply;
  $<HTMLInputElement>('#seed').value = String(s.seed);
  $<HTMLSelectElement>('#quality').value = s.quality;
  $<HTMLSelectElement>('#peg-pattern').value = s.pegs.pattern;
  $('#demo').classList.toggle('active', runner.demo.on);
  for (const sl of SLIDERS) {
    const input = $<HTMLInputElement>(`#sl-${sl.key}`), v = sl.get(s);
    input.value = String(v); $(`#out-${sl.key}`).textContent = `${v}${sl.unit ?? ''}`;
  }
}

$('#sliders').innerHTML = SLIDERS.map(sl => `<label class="slider"><span>${sl.label}${sl.restart ? ' <i>(재시작)</i>' : ''}</span><output id="out-${sl.key}"></output>
  <input type="range" id="sl-${sl.key}" min="${sl.min}" max="${sl.max}" step="${sl.step}"></label>`).join('');
for (const sl of SLIDERS) {
  const input = $<HTMLInputElement>(`#sl-${sl.key}`);
  input.addEventListener('input', () => {
    $(`#out-${sl.key}`).textContent = `${input.value}${sl.unit ?? ''}`;
    if (!sl.restart) runner.live(s => sl.set(s, Number(input.value)));
  });
  input.addEventListener('change', () => { if (sl.restart) { sl.set(runner.scenario, Number(input.value)); void runner.restart(); } });
}

document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(b => b.addEventListener('click', () => { runner.demo.on = false; void runner.loadPreset(b.dataset.preset as PresetId, Number($<HTMLInputElement>('#seed').value) || 1234); }));
$('#demo').addEventListener('click', async () => { await runner.loadPreset('basic'); runner.demo.on = true; runner.demo.t = 0; syncControls(); });
$('#pause').addEventListener('click', () => { runner.paused = !runner.paused; $('#pause').textContent = runner.paused ? '재개' : '일시정지'; });
$('#reset').addEventListener('click', () => void runner.restart());
$<HTMLSelectElement>('#speed').addEventListener('change', e => { runner.speed = Number((e.target as HTMLSelectElement).value); });
$<HTMLInputElement>('#seed').addEventListener('change', e => { runner.scenario.seed = Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value) || 1)); void runner.restart(); });
$('#add1').addEventListener('click', () => runner.sim?.addRaw(1));
$('#add10').addEventListener('click', () => runner.sim?.addRaw(10));
$<HTMLInputElement>('#auto').addEventListener('change', e => runner.live(s => { s.flow.autoSupply = (e.target as HTMLInputElement).checked; }));
$<HTMLSelectElement>('#plinko-backend').addEventListener('change', e => { runner.scenario.backends.plinko = (e.target as HTMLSelectElement).value as PlinkoBackendId; void runner.restart(); });
$<HTMLSelectElement>('#pusher-backend').addEventListener('change', e => { runner.scenario.backends.pusher = (e.target as HTMLSelectElement).value as PusherBackendId; void runner.restart(); });
$<HTMLInputElement>('#offscreen').addEventListener('change', e => { const on = (e.target as HTMLInputElement).checked; runner.setOffscreen(on); $('#offscreen-overlay').hidden = !on; });
document.querySelectorAll<HTMLButtonElement>('[data-placement]').forEach(b => b.addEventListener('click', () => {
  const id = b.dataset.placement as PlacementId;
  if (runner.scenario.plinko.gravityMode === 'world-projected') { runner.scenario.placement = id; void runner.restart(); return; }
  runner.scenario.placement = id; runner.sim?.setPlacement(id); view.updatePlacement(); view.showSelection(selected); syncControls();
}));
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach(b => b.addEventListener('click', () => { runner.demo.on = false; view.setCamera(b.dataset.cam === 'reset' ? 'all' : b.dataset.cam as CameraPreset, b.dataset.cam !== 'reset'); syncControls(); }));
$<HTMLInputElement>('#labels').addEventListener('change', e => view.setLabels((e.target as HTMLInputElement).checked));
$<HTMLSelectElement>('#quality').addEventListener('change', e => { runner.scenario.quality = (e.target as HTMLSelectElement).value as Quality; void runner.restart(); });
$<HTMLSelectElement>('#peg-pattern').addEventListener('change', e => runner.live(s => { s.pegs.pattern = (e.target as HTMLSelectElement).value as Scenario['pegs']['pattern']; }));

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
const editPeg = (kind: PegKind, level: number) => { if (!selected || !runner.sim) return; runner.sim.core.setPeg(selected.index, kind, Math.max(1, Math.min(MAX_PEG_LEVEL, level))); view.refreshPegColors(); renderPeg(null); };
$<HTMLSelectElement>('#peg-kind').addEventListener('change', e => selected && editPeg((e.target as HTMLSelectElement).value as PegKind, selected.level));
$('#peg-up').addEventListener('click', () => selected && editPeg(selected.kind, selected.level + 1));
$('#peg-down').addEventListener('click', () => selected && editPeg(selected.kind, selected.level - 1));

// ---------- 표시 ----------
const row = (k: string, v: string, cls = '') => `<div class="${cls}"><span>${k}</span><b>${v}</b></div>`;
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
const ms = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '측정 불가' : v.toFixed(d));

function renderStats() {
  const sim = runner.sim;
  if (!sim) return;
  const c = sim.core, a = c.account(), st = c.stats, rate = c.recentRates(), led = c.ledger;
  $('#flow').innerHTML = [
    ['원재료 대기', n0(a.rawQueue)], ['처리 중', n0(a.inBoard)], ['완료', n0(st.completed)],
    ['본 재화', n0(led.main), 'green'], ['부산물 대기', n0(a.byproductWaiting), 'orange'], ['트레이', `${n0(a.trayCount)}개`],
    ['보너스', n0(led.bonusProduced + led.bonusSeed), 'orange'], ['합계', n0(c.total), 'total'],
  ].map(([k, v, cls]) => `<div class="chip ${cls ?? ''}"><span>${k}</span><b>${v}</b></div>`).join('<i>›</i>');
  $('#economy').innerHTML =
    row('원재료 대기 / 처리 중 / 완료', `${n0(a.rawQueue)} / ${n0(a.inBoard)} / ${n0(st.completed)}`)
    + row('처리 중 예상 본 재화', n0(a.inBoardMain))
    + row('본 재화 (가공)', n0(led.main), 'green')
    + row('부산물: 슈트 · 압축 버퍼', `${n0(a.chuteValue)} · ${n0(a.compressorBuffer)}`)
    + row('컨베이어 · 투입 대기', `${n0(a.beltValue)} (${a.beltCount}) · ${n0(a.feedValue + a.feedSeed)} (${a.feedCount})`)
    + (c.offscreen ? row('화면 밖 트레이 풀', `${n0(a.offProduced + a.offSeed)} (${a.offCount})`) : '')
    + row('트레이 잔존 가치 (생산 / 초기)', `${n0(a.trayProduced)} / ${n0(a.traySeed)}`)
    + row('낙하 수량 (생산 / 초기)', `${n0(st.tokensPaid - st.seedPaid)} / ${n0(st.seedPaid)}`)
    + row('회수 보너스 (생산 / 초기)', `${n0(led.bonusProduced)} / ${n0(led.bonusSeed)}`, 'orange')
    + row('합계 (본 + 보너스)', n0(c.total), 'total')
    + row('최근 10초 완료 · 토큰 · 보너스', `${rate.completedPerSec.toFixed(2)} · ${rate.tokensPerSec.toFixed(2)} · ${rate.bonusPerSec.toFixed(1)} /s`)
    + (c.offscreen && c.estimate ? row('근사 추정치', `가공 ${c.estimate.process.toFixed(1)} · 부산물 ${c.estimate.byproduct.toFixed(1)} · 회수 ${c.estimate.recoveryPerSec.toFixed(1)}/s (${c.estimate.source === 'measured' ? '측정' : '기본값'})`) : '');
  const cons = c.conservationError(), ok = !cons.produced && !cons.seed && !cons.raw;
  $('#checks').innerHTML = row('가치 보존 오차 (부산물/초기/원재료)', `${cons.produced} / ${cons.seed} / ${cons.raw}`, ok ? 'green' : 'red')
    + row('중복 무시 (도착 / 이탈)', `${st.duplicateArrivals} / ${st.duplicateExits}`)
    + row('유실 복구 (원석 / 토큰)', `${st.lostItems} / ${st.lostTokens}`)
    + row('페그 접촉 / 점수 반영', `${n0(st.pegContacts)} / ${n0(st.scoredContacts)}`)
    + row('투입구 막힘(누적 틱)', n0(sim.gateStats.blocked))
    + row('활성 월드 (플링코/푸셔/엔진)', `${liveBackends.plinko} / ${liveBackends.pusher} / ${liveBackends.engineWorlds}`);
  const ps = sim.pusher.stats(), ls = sim.plinko.stats(), fw = runner.frameWork.summary(), fi = runner.frameInterval.summary();
  const pl = runner.plinkoMs.summary(), pu = runner.pusherMs.summary(), tr = runner.transferMs.summary();
  $('#perf-note').textContent = `${ls.label} + ${ps.label}`;
  const corr = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ');
  $('#perf').innerHTML = row('FPS (프레임 간격 중앙값)', Number.isFinite(fi.median) ? `${(1000 / fi.median).toFixed(0)} (${fi.median.toFixed(1)}ms)` : '—')
    + row('프레임 CPU 중앙 / p95', `${ms(fw.median, 2)} / ${ms(fw.p95, 2)} ms`)
    + row('플링코 step 중앙 / p95', `${ms(pl.median)} / ${ms(pl.p95)} ms`)
    + row('푸셔 step 중앙 / p95', `${ms(pu.median)} / ${ms(pu.p95)} ms`)
    + row('상태 전달 중앙 / p95', `${ms(tr.median)} / ${ms(tr.p95)} ms`)
    + row('원석 / 토큰 (실제 물리 수)', `${ls.bodies} / ${ps.bodies}`)
    + row('푸셔 활성 / 휴면', `${ps.active} / ${ps.sleeping ?? '측정 불가'}`)
    + row('초기화 시간 (플링코/푸셔)', `${sim.initMs.plinko.toFixed(1)} / ${sim.initMs.pusher.toFixed(1)} ms`)
    + row('버린 시간(따라잡기 상한)', `${runner.droppedMs.toFixed(0)} ms`)
    + row('메모리', ps.memoryBytes !== null ? `${(((ps.memoryBytes ?? 0) + (ls.memoryBytes ?? 0)) / 1024).toFixed(0)} KB (${ps.memoryNote})` : ps.memoryNote)
    + `<p class="hint">보정: ${corr(ls.corrections)} | ${corr(ps.corrections)}</p>`
    + `<p class="hint">설정: ${Object.entries({ ...ls.settings }).map(([k, v]) => `${k}=${v}`).join(', ')} | ${Object.entries(ps.settings).map(([k, v]) => `${k}=${v}`).join(', ')}</p>`;
  const prog = runner.benchProgress();
  $('#bench-status').textContent = prog ? `${prog.phase === 'warmup' ? '워밍업' : '측정'} ${prog.repeat}/${prog.repeats} · ${prog.pct}%` : lastResult ? `최근: ${lastResult.label}` : '';
  document.body.classList.toggle('benching', !!prog);
}

function renderBench() {
  const cols: Array<[string, BenchResult | null]> = [['최근', lastResult], ['A', slots.A], ['B', slots.B]];
  const shown = cols.filter(([, r]) => r);
  if (!shown.length) { $('#bench-body').innerHTML = '<p class="hint">같은 시나리오로 A 실행 → 결과 → A 저장 → 백엔드 변경 → 측정 → B 저장. 각 반복은 새 월드에서 워밍업 후 같은 기간을 측정합니다.</p>'; return; }
  const ov = shown.map(([k, r]) => [k, r!, overview(r!)] as const);
  const line = (label: string, f: (o: ReturnType<typeof overview>, r: BenchResult) => string) => `<tr><th>${label}</th>${ov.map(([, r, o]) => `<td>${f(o, r)}</td>`).join('')}</tr>`;
  const warn = slots.A && slots.B ? (slots.A.condition !== slots.B.condition ? '<p class="warn">A와 B의 조건이 다릅니다(단층·평면 ↔ 3D 적층): 동일 조건 비교가 아닌 실사용 후보 비교입니다.</p>' : slots.A.scenario.preset !== slots.B.scenario.preset || slots.A.scenario.seed !== slots.B.scenario.seed ? '<p class="warn">A와 B의 시나리오(프리셋·시드)가 다릅니다.</p>' : '') : '';
  $('#bench-body').innerHTML = warn + `<table><tr><th></th>${ov.map(([k, r]) => `<th>${k}<small>${r.backends.plinko} + ${r.backends.pusher}<br>${r.scenario.preset} · seed ${r.scenario.seed} · ${r.condition === 'planar' ? '단층·평면' : '3D 적층'}</small></th>`).join('')}</tr>`
    + line('반복 · 측정 기간', (_, r) => `${r.repeats.length}회 · ${r.scenario.measureSec}s (워밍업 ${r.scenario.warmupSec}s)`)
    + line('원석 평균/최대 · 토큰 평균', o => `${ms(o.items, 0)}/${ms(o.itemsMax, 0)} · ${ms(o.tokens, 0)}`)
    + line('플링코 step 중앙 / p95 (ms)', o => `${ms(o.plinkoMedian)} / ${ms(o.plinkoP95)}`)
    + line('푸셔 step 중앙 / p95 (ms)', o => `${ms(o.pusherMedian)} / ${ms(o.pusherP95)} <small>반복 편차 ${ms(o.pusherMedianSpread)}</small>`)
    + line('  └ 엔진 밖 어댑터 중앙 (플링코/푸셔 ms)', o => `${ms(o.plinkoAdapterMedian)} / ${ms(o.pusherAdapterMedian)}`)
    + line('상태 전달 중앙 / p95 (ms)', o => `${ms(o.transferMedian)} / ${ms(o.transferP95)}`)
    + line('프레임 CPU 중앙 / p95 (ms)', o => `${ms(o.frameMedian, 2)} / ${ms(o.frameP95, 2)}`)
    + line('프레임 간격 중앙 (ms)', o => ms(o.intervalMedian, 1))
    + line('푸셔 활성 / 휴면', o => `${ms(o.active, 0)} / ${ms(o.sleeping, 0)}`)
    + line('초기화 (플링코/푸셔 ms)', o => `${ms(o.initPlinko, 1)} / ${ms(o.initPusher, 1)}`)
    + line('JS 힙 변화 (MB)', o => ms(o.heap, 1))
    + line('최대 겹침 % · 20%+ 겹침 쌍', (o, r) => r.condition === 'stacked' ? '측정 불가(적층 형상)' : `${ms(o.maxOverlapPct, 1)} · ${ms(o.overlappedPairs, 1)}`)
    + line('튀어오름 · 유실 · 끼임 보정', o => `${ms(o.high, 0)} · ${ms(o.lostTokens, 0)} · ${ms(o.unstuck, 0)}`)
    + line('완료 · 회수 토큰 · 보너스', o => `${ms(o.completed, 0)} · ${ms(o.tokensPaid, 0)} · ${ms(o.bonus, 0)}`)
    + line('버린 시간 (ms)', o => ms(o.droppedMs, 0))
    + line('설정', (_, r) => `<small>${Object.entries({ ...r.settings.plinko }).map(([k, v]) => `${k}=${v}`).join(', ')}<br>${Object.entries(r.settings.pusher).map(([k, v]) => `${k}=${v}`).join(', ')}</small>`)
    + `</table><p class="hint">환경: ${ov[0][1].env}. 마찰·감쇠 계수는 엔진마다 의미가 달라 같은 수치라도 감각이 다를 수 있습니다(설정 행 참고).</p>`;
}

runner.onBenchDone = r => { lastResult = r; renderBench(); toast(`측정 완료: ${r.label}`); $('#bench').classList.add('open'); };
runner.onRebuilt = () => { selected = null; view.showSelection(null); renderPeg(null); syncControls(); };
$('#bench-run').addEventListener('click', () => { $('#bench').classList.add('open'); void runner.runBench(); });
$('#save-a').addEventListener('click', () => { if (lastResult) { slots.A = lastResult; renderBench(); } else toast('먼저 측정을 실행하세요.'); });
$('#save-b').addEventListener('click', () => { if (lastResult) { slots.B = lastResult; renderBench(); } else toast('먼저 측정을 실행하세요.'); });
$('#bench-toggle').addEventListener('click', () => $('#bench').classList.toggle('open'));
$('#bench-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ A: slots.A, B: slots.B, history: runner.results }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `plinko-pusher-bench-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
});

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
  view.setCamera((params.get('camera') as CameraPreset) ?? 'all', false);
  runner.paused = params.get('paused') === '1';
  $('#pause').textContent = runner.paused ? '재개' : '일시정지';
  renderBench();
  runner.start();
  setInterval(renderStats, 250);
  renderStats();
  document.body.dataset.ready = '1';
};
init().catch(err => { console.error(err); $('#scene').innerHTML = `<p class="error">초기화 실패: ${String(err)}</p>`; });
