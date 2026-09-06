import './style.css';
import { configBounds, defaultConfig, presetConfig, presets, validateConfig, type VehicleConfig } from './physics/config';
import { courses, type CourseId } from './physics/terrain';
import { FIXED_DT, type DriverInput } from './physics/vehicle';
import { Vec3 } from './physics/math';
import { createExperiment, csv, experimentInput, experiments, telemetry, type ExperimentId, type Telemetry } from './lab/experiments';
import { FixedClock } from './lab/clock';
import { keyboardDriverInput, MANUAL_CONTROLS } from './lab/keyboard-input';
import { VehicleView } from './view/scene';
import { drawCurve, drawTelemetry, type Metric } from './view/charts';
import { FrictionEditor, RollEditor } from './view/speed-curve-editor';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const options = (values: Record<string, { name: string }>) => Object.entries(values).map(([id, v]) => `<option value="${id}">${v.name}</option>`).join('');
const parameterLabels: Record<keyof typeof configBounds, [string, string]> = {
  mass: ['차체 질량', 'kg'], spring: ['스프링 강성', 'N/m'], damping: ['댐퍼 감쇠', 'N·s/m'], restLength: ['서스펜션 길이', 'm'],
  rollInfluence: ['0–20 km/h 기울기', ''], rollInfluence40: ['40 km/h 기울기', ''],
  rollInfluence80: ['80 km/h 기울기', ''], rollInfluence160: ['160 km/h 이상 기울기', ''],
  frontGrip: ['앞 타이어 접지', ''], rearGrip: ['뒤 타이어 접지', ''], slidingGrip: ['미끄러질 때 접지', ''], friction: ['0–20 km/h 마찰', 'μ'],
  friction40: ['40 km/h 마찰', 'μ'], friction80: ['80 km/h 마찰', 'μ'], friction160: ['160 km/h 이상 마찰', 'μ'],
  engineForce: ['엔진 구동력', 'N'], topSpeed: ['목표 최고속도', 'm/s'], brakeForce: ['최대 제동력', 'N'], steerAngle: ['최대 조향각', '°'],
  drag: ['공기저항 계수', 'kg/m'], rolling: ['바퀴당 구름저항', 'N'],
};
function slider(key: keyof typeof configBounds) {
  const [min, max, step] = configBounds[key], [name, unit] = parameterLabels[key] ?? [key, ''];
  return `<label class="parameter" for="${key}"><span>${name}</span><output id="${key}-value">${defaultConfig[key]} ${unit}</output></label><input type="range" id="${key}" min="${min}" max="${max}" step="${step}" value="${defaultConfig[key]}">${key === 'engineForce' ? '<p class="parameter-note">구동력 ÷ 질량이 가속도의 기준입니다. 실제 가속은 접지와 출력 곡선에도 제한됩니다.</p>' : ''}`;
}
$('#app').innerHTML = `
<header class="header"><a class="brand" href="./"><span class="brand-mark">V<span>╱</span></span><div>VEHICLE<span>PHYSICS LAB</span></div></a><div class="header-description">힘을 설계하고, 움직임을 확인하세요.</div><div class="header-right"><span class="pill"><i></i> LOCAL SIMULATION</span><a href="https://www.youtube.com/watch?v=CdPYlj5uZeI" target="_blank" rel="noreferrer">참고 영상 ↗</a></div></header>
<main class="workspace"><section class="driving">
<div class="workspace-heading"><div><div class="eyebrow">CUSTOM RAYCAST VEHICLE / 01</div><h1>Vehicle Physics <span>실험실</span></h1></div><div class="step-label">물리 <b>120 Hz</b><span>·</span><b id="fps">60</b> fps</div></div>
<div class="stage"><div id="scene"></div><div class="stage-top"><span class="stage-tag" id="mode-label">직접 운전</span><span class="surface-label" id="course-label">자유 시험장</span><button id="camera-reset" title="카메라 위치 초기화" aria-label="카메라 위치 초기화">↗</button></div>
<div class="stage-help">드래그로 회전 <span>·</span> 스크롤로 확대</div>
<div class="speedometer"><div><span id="speed">0</span><small>km/h</small></div><div class="speedometer-bottom"><b id="gear">N</b><span id="contact-status">접지 확인 중</span></div></div>
<div class="input-overlay"><span id="key-left">A</span><span id="key-up">W</span><span id="key-down">S</span><span id="key-right">D</span><span id="key-brake">HANDBRAKE</span></div>
<div class="stage-bottom"><label><input type="checkbox" id="forces" checked> 힘 벡터</label><label><input type="checkbox" id="trail" checked> 주행 궤적</label><div class="legend"><span class="green">서스펜션</span><span class="red">접지</span><span class="blue">구동 / 제동</span></div><select id="camera" aria-label="카메라"><option value="orbit">오비트 뷰</option><option value="chase">추적 뷰</option><option value="top">탑 뷰</option></select></div>
</div>
<div class="transport"><div class="transport-actions"><button id="pause" class="primary">Ⅱ 일시정지</button><button id="step" title="1/120초 진행">한 스텝</button><button id="reset">↺ 초기화</button><button id="replay" disabled>입력 재생</button></div><div class="time"><span id="time">00:00.00</span><small id="step-count">0 steps</small></div><select id="timescale" aria-label="재생 속도"><option value="1">1× 실시간</option><option value="0.25">0.25× 느리게</option><option value="0.1">0.1× 느리게</option></select></div>
<div class="test-strip"><div class="section-number">01</div><div class="test-field"><label for="course">시험장</label><select id="course">${options(courses)}</select></div><div class="test-field"><label for="experiment">자동 시험</label><select id="experiment">${options(experiments)}</select></div><button id="run" class="accent">시험 시작 <span>→</span></button></div><p class="experiment-hint" id="experiment-hint">${experiments.manual.description}</p>
<section class="telemetry-panel"><div class="section-header"><div><span class="section-number">02</span><h2>라이브 텔레메트리</h2></div><div class="chart-tabs" role="group" aria-label="그래프 지표"><button class="selected" data-metric="speed">속도</button><button data-metric="height">차체 높이</button><button data-metric="slip">슬립</button></div><button id="export-csv" class="text-button">CSV 내보내기 ↗</button></div><div class="telemetry-content"><div class="chart-area"><div class="chart-meta"><span id="chart-unit">SPEED / km/h</span><span id="baseline-label">기준 데이터 없음</span></div><canvas id="telemetry-chart" aria-label="시간에 따른 주행 측정 그래프"></canvas></div><div class="stats"><div><span>주행 거리</span><b id="distance">0.0 <small>m</small></b></div><div><span>횡방향 슬립</span><b id="slip">0 <small>%</small></b></div><div><span>차체 기울기</span><b id="roll">0.0 <small>°</small></b></div><button id="baseline" class="text-button">현재 결과를 비교 기준으로 +</button></div></div><div id="result" class="result" role="status">직접 운전하거나 자동 시험을 시작하세요. 동일한 입력을 다시 재생할 수 있습니다.</div></section>
<footer><span>1 BODY · 4 RAYCASTS · 3 FORCES PER TIRE</span><span>m · kg · s / 고정 시간 간격</span></footer>
</section>
<aside class="sidebar"><div class="sidebar-heading"><div class="eyebrow">VEHICLE SETUP</div><h2>차량 설정 <span id="dirty">적용됨</span></h2></div><div class="preset-grid">${Object.entries(presets).map(([id, p]) => `<button data-preset="${id}" class="${id === 'balanced' ? 'active' : ''}">${p.name}</button>`).join('')}</div><p class="preset-description" id="preset-description">${presets.balanced.description}</p>
<div class="setup-section"><h3><span>Ⅰ</span> 서스펜션</h3>${slider('spring')}${slider('damping')}${slider('restLength')}<h3>속도별 코너링 기울기</h3><div id="roll-editor"></div><p class="friction-help">점을 위아래로 드래그하세요. 0은 기울임 토크 억제, 1은 원래 바퀴 높이입니다. 저속은 크게, 고속은 작게 조절할 수 있습니다.</p><p id="live-roll" class="live-friction" aria-live="off"></p>${slider('rollInfluence')}${slider('rollInfluence40')}${slider('rollInfluence80')}${slider('rollInfluence160')}</div>
<div class="setup-section"><h3><span>Ⅱ</span> 타이어 접지</h3>${slider('frontGrip')}${slider('rearGrip')}${slider('slidingGrip')}<div class="curve-label"><span>슬립 → 접지 곡선</span><span><i class="green">앞</i> / <i class="orange">뒤</i></span></div><canvas id="grip-curve" aria-label="앞뒤 타이어의 슬립별 접지 곡선"></canvas><h3>속도별 노면 마찰</h3><div id="friction-editor"></div><p class="friction-help">점을 위아래로 드래그하세요. 0–20 km/h는 최대 2, 고속 구간은 최대 8입니다. 구간 사이는 선형 보간됩니다.</p><p id="live-friction" class="live-friction" aria-live="off"></p>${slider('friction')}${slider('friction40')}${slider('friction80')}${slider('friction160')}</div>
<div class="setup-section"><h3><span>Ⅲ</span> 파워트레인</h3><label class="parameter" for="drive"><span>구동 방식</span></label><select id="drive"><option value="fwd">전륜구동 · FWD</option><option value="rwd">후륜구동 · RWD</option><option value="awd">사륜구동 · AWD</option></select>${slider('mass')}${slider('engineForce')}${slider('topSpeed')}<canvas id="power-curve" aria-label="속도별 엔진 출력 곡선"></canvas><details><summary>조향 · 제동 · 주행 저항</summary>${slider('steerAngle')}${slider('brakeForce')}${slider('drag')}${slider('rolling')}</details></div>
<div class="apply-bar"><p class="settings-help">슬라이더를 놓거나 구동 방식을 선택하면 자동 적용되고 차량이 초기화됩니다.</p><p id="applied-summary" class="applied-summary" aria-live="polite"></p><div><button id="save" class="text-button">적용값 저장 ↓</button><button id="load" class="text-button">불러오기 ↑</button><input id="config-file" type="file" accept="application/json,.json" hidden></div></div>
<section class="wheel-panel"><h3>바퀴별 접지 하중 <small>N</small></h3><div class="wheel-grid">${['FL', 'FR', 'RL', 'RR'].map(name => `<div class="wheel-cell"><span>${name}</span><b id="load-${name}">0</b><div class="load-track"><i id="bar-${name}"></i></div></div>`).join('')}</div></section>
<details class="model-notes"><summary>물리 모델 알아보기</summary><p>단일 3D 강체에 네 바퀴의 힘을 가합니다. 초록은 스프링과 감쇠, 빨강은 횡방향 미끄러짐 억제, 파랑은 구동과 제동입니다.</p><code>Fspring = k × 압축량 − c × 수직속도</code><p>레이가 지면에 닿는 바퀴만 힘을 냅니다. 앞뒤 접지와 속도별 출력 곡선으로 주행감을 조절합니다.</p><p>타이어 회전 관성·변속기·차체 변형은 모델링하지 않습니다. 표시되는 바퀴 회전은 시각 효과입니다.</p><a href="https://www.youtube.com/watch?v=CdPYlj5uZeI&t=163s" target="_blank" rel="noreferrer">Toyful Games · 세 가지 힘 ↗</a></details>
</aside></main><div id="toast" role="status" aria-live="polite"></div>`;

const params = new URLSearchParams(location.search);
let course: CourseId = params.get('course') && params.get('course')! in courses ? params.get('course') as CourseId : 'playground';
const initialPreset = params.get('preset') && params.get('preset')! in presets ? params.get('preset')! : 'balanced';
let config = presetConfig(initialPreset), draft = { ...config };
let experiment: ExperimentId = 'manual';
let car = createExperiment(experiment, config, course);
let paused = params.get('paused') === 'true', timescale = 1, metric: Metric = 'speed';
let rows: Telemetry[] = [], baseline: Telemetry[] = [];
let recording: DriverInput[] = [], replayInputs: DriverInput[] | null = null, replayIndex = 0;
let brakeStart: number | null = null, stopDistance: number | null = null, maxSpeed = 0, airborne = 0;
let lastFrame = performance.now(), lastUI = 0, smoothedFps = 60;
const keys = new Set<string>(), clock = new FixedClock();
let view: VehicleView | null = null;
try { view = new VehicleView($('#scene')); view.setTerrain(car.terrain); }
catch { $('#scene').innerHTML = '<div class="webgl-error">3D 화면을 열 수 없습니다.<br>WebGL을 지원하는 브라우저에서 다시 열어주세요.<br>자동 시험과 수치 측정은 계속 사용할 수 있습니다.</div>'; }
const frictionEditor = new FrictionEditor($('#friction-editor'), () => draft, (key, value, commit) => {
  draft[key] = value; syncSettings(); if (commit) applySettings();
});
const rollEditor = new RollEditor($('#roll-editor'), () => draft, (key, value, commit) => {
  draft[key] = value; syncSettings(); if (commit) applySettings();
});

function toast(message: string) { $('#toast').textContent = message; $('#toast').classList.add('visible'); window.setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
function syncSettings() {
  for (const key of Object.keys(parameterLabels) as (keyof typeof configBounds)[]) {
    $<HTMLInputElement>(`#${key}`).value = String(draft[key]);
    $(`#${key}-value`).textContent = `${draft[key].toLocaleString('en-US', { maximumFractionDigits: 2 })} ${parameterLabels[key]![1]}`;
    if (key === 'topSpeed') $(`#${key}-value`).textContent += ` · ${(draft.topSpeed * 3.6).toFixed(0)} km/h`;
  }
  $<HTMLSelectElement>('#drive').value = draft.drive;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  $('#dirty').textContent = dirty ? '조절 중' : '적용됨'; $('#dirty').classList.toggle('pending', dirty);
  $('#applied-summary').textContent = `현재 적용: ${config.mass} kg · ${config.engineForce.toLocaleString()} N · ${config.drive.toUpperCase()} · 마찰 곡선 ${config.friction} / ${config.friction40} / ${config.friction80} / ${config.friction160} · 기울기 곡선 ${config.rollInfluence} / ${config.rollInfluence40} / ${config.rollInfluence80} / ${config.rollInfluence160} · ${(config.topSpeed * 3.6).toFixed(0)} km/h`;
  frictionEditor.update(); rollEditor.update();
  drawCurve($('#grip-curve'), draft, 'grip'); drawCurve($('#power-curve'), draft, 'power');
}
function syncPresetIdentity() {
  const match = Object.keys(presets).find(id => {
    const values = presetConfig(id);
    return (Object.keys(defaultConfig) as (keyof VehicleConfig)[]).every(key => config[key] === values[key]);
  });
  document.querySelectorAll<HTMLElement>('[data-preset]').forEach(button => button.classList.toggle('active', button.dataset.preset === match));
  $('#preset-description').textContent = match ? `${presets[match].name} 설정과 일치 · ${presets[match].description}` : '사용자 설정 · 현재 적용값으로 주행합니다.';
}
function applySettings() {
  const next = validateConfig(draft);
  const changed = (Object.keys(defaultConfig) as (keyof VehicleConfig)[]).some(key => next[key] !== config[key]);
  config = next; draft = { ...config }; syncSettings(); syncPresetIdentity();
  if (changed) reset();
}
function updatePause() { $('#pause').textContent = paused ? '▶ 계속하기' : 'Ⅱ 일시정지'; }
function reset(id: ExperimentId = experiment, nextCourse: CourseId = course) {
  experiment = id; course = nextCourse; car = createExperiment(id, config, nextCourse);
  car.previousPosition = car.body.position.clone();
  rows = []; recording = []; replayInputs = null; replayIndex = 0;
  brakeStart = null; stopDistance = null; maxSpeed = 0; airborne = 0; keys.clear(); clock.reset();
  if (view) view.setTerrain(car.terrain);
  $<HTMLSelectElement>('#course').value = course; $<HTMLSelectElement>('#experiment').value = id;
  $('#course-label').textContent = courses[course].name; $('#mode-label').textContent = experiments[id].name;
  $('#experiment-hint').textContent = experiments[id].description; $('#result').textContent = id === 'manual' ? MANUAL_CONTROLS : experiments[id].description;
  updateUI();
}
function keyboardInput(): DriverInput {
  return keyboardDriverInput(keys, car.forwardSpeed);
}
function tick() {
  if (replayInputs && replayIndex >= replayInputs.length) { paused = true; updatePause(); return; }
  if (!replayInputs && experiment !== 'manual' && car.time >= experiments[experiment].duration) { paused = true; updatePause(); return; }
  const input = replayInputs ? replayInputs[replayIndex++] : experiment === 'manual' ? keyboardInput() : experimentInput(experiment, car.time);
  if (input.brake && brakeStart === null) brakeStart = car.distance;
  car.step(input);
  if (!replayInputs && recording.length < 36000) recording.push({ ...input });
  maxSpeed = Math.max(maxSpeed, car.speed * 3.6);
  if (car.groundedCount === 0) airborne += FIXED_DT;
  if (brakeStart !== null && car.speed < 0.1 && stopDistance === null) stopDistance = car.distance - brakeStart;
  if (car.stepIndex % 6 === 0) { rows.push(telemetry(car)); if (rows.length > 6000) rows.shift(); }
  if ((replayInputs && replayIndex >= replayInputs.length) || (!replayInputs && experiment !== 'manual' && car.time >= experiments[experiment].duration)) {
    paused = true; updatePause();
    $('#result').textContent = `${replayInputs ? '입력 재생 완료' : '시험 완료'} · 최고 ${maxSpeed.toFixed(1)} km/h · 주행 ${car.distance.toFixed(1)} m · 공중 ${airborne.toFixed(2)} s${stopDistance !== null ? ` · 제동거리 ${stopDistance.toFixed(2)} m` : ''}`;
  }
}
function updateUI() {
  const groundSpeed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
  frictionEditor.updateLive(groundSpeed, car.config);
  rollEditor.updateLive(groundSpeed, car.config);
  $('#live-roll').textContent = `현재 ${(groundSpeed * 3.6).toFixed(1)} km/h → 적용 기울임 강도 ${car.rollCoefficient.toFixed(2)}`;
  $('#live-friction').textContent = `현재 ${(groundSpeed * 3.6).toFixed(1)} km/h → 적용 마찰 ${car.frictionCoefficient.toFixed(2)} μ`;
  $('#speed').textContent = (car.speed * 3.6).toFixed(0);
  $('#gear').textContent = car.forwardSpeed < -0.2 ? 'R' : car.forwardSpeed > 0.2 ? 'D' : 'N';
  $('#contact-status').textContent = car.stepIndex === 0 ? '정지 · 준비' : car.groundedCount ? `${car.groundedCount} / 4 접지` : 'AIRBORNE';
  $('#contact-status').classList.toggle('airborne', car.groundedCount === 0);
  $('#time').textContent = `${Math.floor(car.time / 60).toString().padStart(2, '0')}:${(car.time % 60).toFixed(2).padStart(5, '0')}`;
  $('#step-count').textContent = `${car.stepIndex.toLocaleString()} steps`;
  $('#distance').innerHTML = `${car.distance.toFixed(1)} <small>m</small>`;
  $('#slip').innerHTML = `${(car.slip * 100).toFixed(0)} <small>%</small>`;
  const localUp = car.body.orientation.inverseRotate(new Vec3(0, 1, 0));
  const roll = Math.atan2(localUp.x, localUp.y) * 180 / Math.PI;
  $('#roll').innerHTML = `${roll.toFixed(1)} <small>°</small>`;
  for (const w of car.wheels) {
    $(`#load-${w.name}`).textContent = w.grounded ? w.load.toFixed(0) : 'AIR';
    $(`#bar-${w.name}`).style.width = `${Math.min(100, w.load / (config.mass * 9.81 / 2) * 100)}%`;
  }
  for (const [key, on] of [['left', car.input.steer < 0], ['right', car.input.steer > 0], ['up', car.input.throttle > 0], ['down', car.input.throttle < 0 || car.input.brake > 0], ['brake', car.input.handbrake]] as const) $(`#key-${key}`).classList.toggle('pressed', on);
  $<HTMLButtonElement>('#replay').disabled = !recording.length;
  drawTelemetry($('#telemetry-chart'), rows, baseline, metric);
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#pause').addEventListener('click', () => { paused = !paused; clock.reset(); updatePause(); if (!paused) view?.renderer.domElement.focus(); });
$('#step').addEventListener('click', () => { paused = true; clock.reset(); tick(); updatePause(); updateUI(); });
$('#reset').addEventListener('click', () => reset());
$('#run').addEventListener('click', () => {
  const id = $<HTMLSelectElement>('#experiment').value as ExperimentId;
  reset(id, id === 'manual' ? course : experiments[id].course); paused = false; updatePause();
  view?.renderer.domElement.focus();
});
$('#experiment').addEventListener('change', () => { $('#experiment-hint').textContent = experiments[$<HTMLSelectElement>('#experiment').value as ExperimentId].description; });
$('#course').addEventListener('change', () => reset('manual', $<HTMLSelectElement>('#course').value as CourseId));
$('#timescale').addEventListener('change', () => { timescale = Number($<HTMLSelectElement>('#timescale').value); clock.reset(); });
$('#forces').addEventListener('change', () => { if (view) view.forces = $<HTMLInputElement>('#forces').checked; });
$('#trail').addEventListener('change', () => { if (view) view.showTrail = $<HTMLInputElement>('#trail').checked; });
$('#camera').addEventListener('change', () => { if (view) view.cameraMode = $<HTMLSelectElement>('#camera').value as VehicleView['cameraMode']; });
$('#camera-reset').addEventListener('click', () => view?.resetCamera());
$('#replay').addEventListener('click', () => {
  const inputs = recording.map(i => ({ ...i })); reset(); replayInputs = inputs; recording = inputs;
  paused = false; $('#mode-label').textContent = '기록된 입력 재생'; updatePause();
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.preset!; config = presetConfig(id); draft = { ...config }; syncSettings(); reset();
  syncPresetIdentity();
}));
for (const key of Object.keys(parameterLabels) as (keyof typeof configBounds)[]) {
  $(`#${key}`).addEventListener('input', () => { draft[key] = Number($<HTMLInputElement>(`#${key}`).value); syncSettings(); });
  $(`#${key}`).addEventListener('change', () => { draft[key] = Number($<HTMLInputElement>(`#${key}`).value); applySettings(); });
}
$('#drive').addEventListener('change', () => { draft.drive = $<HTMLSelectElement>('#drive').value as VehicleConfig['drive']; applySettings(); });
$('#save').addEventListener('click', () => download('vehicle-setup.json', JSON.stringify(config, null, 2), 'application/json'));
$('#load').addEventListener('click', () => $<HTMLInputElement>('#config-file').click());
$('#config-file').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('#config-file'), file = input.files?.[0]; if (!file) return;
  try { draft = validateConfig(JSON.parse(await file.text())); applySettings(); toast('불러온 설정을 차량에 적용했습니다.'); }
  catch (e) { toast(e instanceof Error ? e.message : '설정을 불러올 수 없습니다.'); }
  input.value = '';
});
$('#export-csv').addEventListener('click', () => { if (!rows.length) return toast('먼저 주행 데이터를 기록하세요.'); download(`vehicle-${experiment}.csv`, csv(rows), 'text/csv;charset=utf-8'); });
$('#baseline').addEventListener('click', () => { if (!rows.length) return toast('먼저 주행 데이터를 기록하세요.'); baseline = rows.map(r => ({ ...r })); $('#baseline-label').textContent = `점선: ${experiments[experiment].name} · ${config.drive.toUpperCase()}`; updateUI(); });
document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(button => button.addEventListener('click', () => {
  metric = button.dataset.metric as Metric; document.querySelectorAll('[data-metric]').forEach(b => b.classList.toggle('selected', b === button));
  $('#chart-unit').textContent = { speed: 'SPEED / km/h', height: 'BODY HEIGHT / m', slip: 'LATERAL SLIP / ratio' }[metric]; updateUI();
}));
const drivingKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.closest('[role="slider"]') || target.isContentEditable || (target.tagName === 'BUTTON' && event.code === 'Space')) return;
  if (drivingKeys.has(event.code)) { event.preventDefault(); keys.add(event.code); if (target.tagName === 'BUTTON') view?.renderer.domElement.focus(); }
  if (event.code === 'KeyR' && !event.repeat) reset();
  if (event.code === 'KeyP' && !event.repeat) { paused = !paused; clock.reset(); updatePause(); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { keys.clear(); clock.reset(); lastFrame = performance.now(); });
// Test bridge is read-only: browser tests exercise actual UI/keyboard commands.
Object.defineProperty(window, '__vehicleLab', { value: { snapshot: () => car.snapshot(), get input() { return { ...car.input }; }, get wheelPoses() { return view?.inspectWheels(); }, get paused() { return paused; }, get config() { return { ...car.config }; }, get rows() { return rows.map(r => ({ ...r })); }, get replaying() { return replayInputs !== null; } } });
syncSettings(); syncPresetIdentity(); reset('manual', course); updatePause();
function frame(now: number) {
  const dt = Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
  if (!paused && !document.hidden) clock.advance(dt * timescale, () => { if (!paused) tick(); });
  smoothedFps += (1 / Math.max(dt, 0.001) - smoothedFps) * 0.03;
  view?.render(car, clock.accumulator / FIXED_DT, dt, paused);
  if (now - lastUI > 70) { updateUI(); $('#fps').textContent = Math.min(999, Math.round(smoothedFps)).toString(); lastUI = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
