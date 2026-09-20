import './ui/styles.css';
import { FixedClock } from './core/fixed-clock';
import { RuntimeMetrics } from './core/metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from './core/simulation';
import type { ScenarioDefinition, SimulationConfig, StepMetrics } from './core/types';
import { MapEditor } from './editor/map-editor';
import { loadMaps, scenarioFromMap } from './editor/map-document';
import { CanvasRenderer } from './rendering/canvas-renderer';
import { DEFAULT_DEBUG_OPTIONS } from './rendering/debug-drawing';
import { getScenario } from './scenarios/scenarios';
import { appTemplate } from './ui/template';
import { PRESETS, resolveExperiment, type ExperimentOptions, type PresetId } from './algorithms/lab/registry';
import { LabRecorder, type LabResult } from './core/lab-results';
import { applyCommands, defaultCommands, scaleScenario, type LabCommand } from './scenarios/lab-scenarios';

declare global {
  interface Window {
    crowdDebug: {
      getSnapshot: () => {
        step: number;
        hash: string;
        active: number;
        arrived: number;
        scenario: string;
        metrics: StepMetrics;
      };
      simulation: () => CrowdSimulation;
      ready: boolean;
    };
  }
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root.');
root.innerHTML = appTemplate();

const params = new URLSearchParams(location.search);
const customScenarios = new Map<string, ScenarioDefinition>();
try {
  for (const saved of loadMaps(localStorage)) registerCustomMap(scenarioFromMap(saved.map, saved.id));
} catch {
  const status = element('map-library-status');
  status.hidden = false;
  status.textContent = '브라우저의 저장된 맵을 읽을 수 없습니다. 기본 시나리오는 계속 사용할 수 있습니다.';
}
const initialId = params.get('scenario') ?? 'open-field';
const initialScenario = customScenarios.get(initialId) ?? getScenario(initialId);
const requestedAgents = parseInteger(params.get('agents'), DEFAULT_CONFIG.agentCount, 1, 50_000);
const requestedSeed = parseInteger(params.get('seed'), DEFAULT_CONFIG.seed, -2147483648, 2147483647);
const targetStep = parseInteger(params.get('step'), 0, 0, 1_000_000);
const requestedPaused = params.get('paused') === 'true';
const config: SimulationConfig = {
  ...DEFAULT_CONFIG,
  preset: PRESETS.some(p => p.id === params.get('preset')) ? params.get('preset') as PresetId : 'legacy',
  agentCount: requestedAgents,
  seed: requestedSeed,
  agentRadius: parseNumber(params.get('radius'), DEFAULT_CONFIG.agentRadius, 1.5, 8),
  largeAgentPercent: parseNumber(params.get('largePercent'), DEFAULT_CONFIG.largeAgentPercent, 0, 100),
  largeAgentScale: parseNumber(params.get('largeScale'), DEFAULT_CONFIG.largeAgentScale, 1, 4),
  agentGap: parseNumber(params.get('gap'), DEFAULT_CONFIG.agentGap, 0, 3),
};
let baseScenario = structuredClone(initialScenario);
let scaledWorld = params.get('scale') === 'true';
let worldScale = scaledWorld ? Math.max(1, Math.sqrt(config.agentCount / 1000)) : 1;
config.width = DEFAULT_CONFIG.width * worldScale;
config.height = DEFAULT_CONFIG.height * worldScale;
const initStarted = performance.now();
let simulation = new CrowdSimulation(config, scaleScenario(baseScenario, worldScale));
let commandLog = defaultCommands(baseScenario, worldScale);
let appliedLiveCommands = new Set<LabCommand>();
let recorder = new LabRecorder(simulation, 0, 0, performance.now() - initStarted);
let comparisonRunning = false;
let comparisonCancelled = false;
let savedResults: LabResult[] = [];
try { savedResults = JSON.parse(localStorage.getItem('crowd-lab-results-v1') ?? '[]').filter((r: LabResult) => r.schema === 'crowd-lab-result-v1').slice(-24); } catch { savedResults = []; }
let running = !requestedPaused;
let fastForwarding = targetStep > 0;
let timeScale = 1;
const clock = new FixedClock(config.fixedDelta);
const runtimeMetrics = new RuntimeMetrics();
const canvas = element<HTMLCanvasElement>('crowd-canvas');
const renderer = new CanvasRenderer(canvas, () => simulation, DEFAULT_DEBUG_OPTIONS);
const editor = new MapEditor({
  config: () => config,
  apply: (scenario, message) => {
    registerCustomMap(scenario);
    rebuildSimulation(scenario);
    running = true;
    clock.reset(performance.now() / 1000);
    updateRunState();
    const status = element('map-library-status');
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = `맵을 적용했습니다. ${message}`;
  },
  saved: registerCustomMap,
  close: () => updateRunState(),
});
let lastMetricsUpdate = 0;

initializeControls();
initializeLabControls();
updateScenarioText();
updateRunState();
updateMetrics();
renderer.render(0);

window.crowdDebug = {
  getSnapshot: () => ({
    step: simulation.stepCount,
    hash: simulation.stateHash(),
    active: simulation.metrics.activeCount,
    arrived: simulation.metrics.arrivedCount,
    scenario: simulation.scenario.id,
    metrics: { ...simulation.metrics },
  }),
  simulation: () => simulation,
  ready: !fastForwarding,
};

requestAnimationFrame(frame);
let lastFrameAt = 0;

function frame(now: number): void {
  const seconds = now / 1000;
  runtimeMetrics.frame(now);
  let alpha = 0;
  if (fastForwarding) {
    const remaining = targetStep - simulation.stepCount;
    const batch = Math.min(30, Math.max(0, remaining));
    for (let i = 0; i < batch; i += 1) timedStep();
    if (simulation.stepCount >= targetStep) {
      fastForwarding = false;
      running = false;
      alpha = 1;
      window.crowdDebug.ready = true;
      updateRunState();
    }
  } else if (running && !comparisonRunning) {
    alpha = clock.consume(seconds, timeScale, timedStep);
  } else {
    clock.reset(seconds);
    alpha = 1;
  }
  const renderStarted = performance.now();
  if (!editor.active) renderer.render(alpha);
  recorder.frame(lastFrameAt ? now - lastFrameAt : 0, performance.now() - renderStarted);
  lastFrameAt = now;
  if (now - lastMetricsUpdate > 120) {
    updateMetrics();
    lastMetricsUpdate = now;
  }
  requestAnimationFrame(frame);
}

function timedStep(): void {
  const startedAt = performance.now();
  applyCommands(simulation, commandLog.filter(command => !appliedLiveCommands.has(command)));
  simulation.step();
  const elapsed = performance.now() - startedAt;
  runtimeMetrics.recordStep(elapsed);
  recorder.record(elapsed);
}

function initializeControls(): void {
  const scenarioSelect = element<HTMLSelectElement>('scenario-select');
  scenarioSelect.value = simulation.scenario.id;
  element<HTMLInputElement>('agent-count').value = String(config.agentCount);
  element<HTMLInputElement>('seed').value = String(config.seed);

  element<HTMLButtonElement>('run-toggle').addEventListener('click', () => {
    running = !running;
    fastForwarding = false;
    window.crowdDebug.ready = true;
    updateRunState();
  });
  element<HTMLButtonElement>('single-step').addEventListener('click', () => {
    running = false;
    fastForwarding = false;
    timedStep();
    updateRunState();
    updateMetrics();
    renderer.render(1);
  });
  element<HTMLButtonElement>('reset').addEventListener('click', resetSimulation);
  element<HTMLSelectElement>('time-scale').addEventListener('change', (event) => {
    timeScale = Number((event.currentTarget as HTMLSelectElement).value);
  });
  scenarioSelect.addEventListener('change', () => {
    rebuildSimulation(customScenarios.get(scenarioSelect.value) ?? getScenario(scenarioSelect.value));
  });
  element('map-edit').addEventListener('click', () => {
    running = false;
    fastForwarding = false;
    window.crowdDebug.ready = true;
    editor.open({ ...simulation.scenario, goal: { ...simulation.goal } });
    updateRunState();
    updateMetrics();
  });
  element<HTMLInputElement>('agent-count').addEventListener('change', (event) => {
    config.agentCount = Math.max(
      1,
      Math.min(50_000, Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || 1000)),
    );
    rebuildSimulation(baseScenario);
  });
  element<HTMLInputElement>('seed').addEventListener('change', (event) => {
    config.seed = Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || 0);
    resetSimulation();
  });

  bindRange('max-speed', 'maxSpeed');
  bindRange('max-acceleration', 'maxAcceleration');
  bindRange('agent-radius', 'agentRadius', true);
  bindRange('large-agent-percent', 'largeAgentPercent', true);
  bindRange('large-agent-scale', 'largeAgentScale', true);
  bindRange('neighbor-radius', 'neighborRadius', true);
  bindRange('agent-gap', 'agentGap');
  bindRange('pressure-relaxation', 'crowdPressureRelaxationTime');
  bindRange('goal-radius', 'goalRadius', true);
  bindToggle('debug-flow', 'flowField');
  bindToggle('debug-grid', 'spatialGrid');
  bindToggle('debug-velocity', 'velocity');
  bindToggle('debug-desired', 'desiredVelocity');
  bindToggle('debug-density', 'density');
  bindToggle('debug-recovery', 'recovery');
  bindToggle('debug-neighbors', 'neighborRadius');
  bindToggle('debug-overlaps', 'overlaps');
  bindToggle('debug-stalled', 'stalled');

  canvas.addEventListener('click', (event) => {
    if (editor.active) return;
    const bounds = canvas.getBoundingClientRect();
    const goal = { x: ((event.clientX - bounds.left) / bounds.width) * simulation.config.width,
      y: ((event.clientY - bounds.top) / bounds.height) * simulation.config.height };
    simulation.setGoal(goal.x, goal.y);
    const command: LabCommand = { step: simulation.stepCount, type: 'goal', goal };
    commandLog.push(command);
    appliedLiveCommands.add(command);
    renderer.render(0);
  });
}

type NumericConfigKey = {
  [K in keyof SimulationConfig]-?: SimulationConfig[K] extends number ? K : never;
}[keyof SimulationConfig];

function bindRange(id: string, key: NumericConfigKey, rebuild = false): void {
  const input = element<HTMLInputElement>(id);
  const output = element<HTMLOutputElement>(`${id}-output`);
  input.value = String(config[key]);
  output.value = input.value;
  input.addEventListener('input', () => {
    output.value = input.value;
    if (!rebuild) simulation.config[key] = Number(input.value);
  });
  if (rebuild) {
    input.addEventListener('change', () => {
      config[key] = Number(input.value);
      rebuildSimulation(baseScenario);
    });
  }
}

function bindToggle(id: string, key: keyof typeof DEFAULT_DEBUG_OPTIONS): void {
  const input = element<HTMLInputElement>(id);
  input.addEventListener('change', () => { DEFAULT_DEBUG_OPTIONS[key] = input.checked; });
}

function rebuildSimulation(scenario: ReturnType<typeof getScenario>): void {
  baseScenario = structuredClone(scenario);
  worldScale = scaledWorld ? Math.max(1, Math.sqrt(config.agentCount / 1000)) : 1;
  config.width = DEFAULT_CONFIG.width * worldScale;
  config.height = DEFAULT_CONFIG.height * worldScale;
  const started = performance.now();
  simulation = new CrowdSimulation(config, scaleScenario(baseScenario, worldScale));
  commandLog = defaultCommands(baseScenario, worldScale);
  appliedLiveCommands = new Set();
  recorder = new LabRecorder(simulation, Number(element<HTMLSelectElement>('quality-mode').value), 0, performance.now() - started);
  runtimeMetrics.reset();
  fastForwarding = false;
  window.crowdDebug.ready = true;
  element<HTMLSelectElement>('scenario-select').value = scenario.id;
  updateScenarioText();
  updateMetrics();
  renderer.render(0);
  syncLabControls();
}

function resetSimulation(): void {
  rebuildSimulation(baseScenario);
}

function updateRunState(): void {
  const paused = !running && !fastForwarding;
  element<HTMLElement>('status-label').textContent = fastForwarding
    ? '목표 스텝 계산 중'
    : paused ? '일시정지' : '실행 중';
  element<HTMLButtonElement>('run-toggle').textContent = paused ? '▶ 실행' : '❚❚ 일시정지';
  element<HTMLElement>('status-dot').parentElement?.classList.toggle('paused', paused);
}

function updateScenarioText(): void {
  element<HTMLElement>('scenario-description').textContent = simulation.scenario.description;
  element<HTMLElement>('scenario-badge').textContent = simulation.scenario.name;
}

function updateMetrics(): void {
  const metrics = simulation.metrics;
  element<HTMLElement>('step-label').textContent = `Step ${simulation.stepCount.toLocaleString()}`;
  element<HTMLElement>('hash-badge').textContent = `Hash ${simulation.stateHash()}`;
  element<HTMLElement>('agent-size-summary').textContent =
    `생성 ${simulation.state.count.toLocaleString()}명 · 큰 객체 ${simulation.largeAgentCount.toLocaleString()}명`
    + ` · 반지름 ${config.agentRadius.toFixed(1)} → ${(config.agentRadius * config.largeAgentScale).toFixed(1)}`
    + (simulation.unspawnedCount > 0 ? ` · 공간 부족 ${simulation.unspawnedCount.toLocaleString()}명` : '');
  element<HTMLElement>('metric-fps').textContent = runtimeMetrics.fps.toFixed(1);
  element<HTMLElement>('metric-step-time').textContent = `${runtimeMetrics.averageStepMs.toFixed(2)} / ${runtimeMetrics.maxStepMs.toFixed(2)} ms`;
  element<HTMLElement>('metric-active').textContent = metrics.activeCount.toLocaleString();
  element<HTMLElement>('metric-arrived').textContent = `${metrics.arrivedCount.toLocaleString()} / ${(metrics.arrivalRate * 100).toFixed(1)}%`;
  element<HTMLElement>('metric-speed').textContent = metrics.averageSpeed.toFixed(1);
  element<HTMLElement>('metric-overlap').textContent = metrics.overlapPairs.toLocaleString();
  element<HTMLElement>('metric-recovery').textContent = `${metrics.recoveredAgents.toLocaleString()} / ${metrics.maxRecoveryDistance.toFixed(2)} px`;
  element<HTMLElement>('metric-stalled').textContent = metrics.stalledCount.toLocaleString();
  element<HTMLElement>('metric-neighbors').textContent = `${metrics.averageNeighbors.toFixed(1)} / ${metrics.maxNeighbors}`;
  element<HTMLElement>('metric-candidates').textContent = metrics.candidateChecks.toLocaleString();
  element<HTMLElement>('metric-backward').textContent = metrics.backwardCount.toLocaleString();
  element<HTMLElement>('metric-wall-overlap').textContent = metrics.wallOverlapCount.toLocaleString();
  element<HTMLElement>('metric-velocity-delta').textContent = `${metrics.averageVelocityDelta.toFixed(2)} / ${metrics.maxVelocityDelta.toFixed(2)}`;
  element<HTMLElement>('metric-acceleration').textContent = `${metrics.averageAcceleration.toFixed(1)} / ${metrics.maxAcceleration.toFixed(1)}`;
  element<HTMLElement>('metric-dynamic-rebuild').textContent = simulation.resolvedExperiment.preset.id !== 'legacy'
    ? `${simulation.resolvedExperiment.options.planner} · 생성 ${simulation.experimentStats.fieldBuilds}`
    : !simulation.config.dynamicRouting
    ? `고정 · ${simulation.navigators.length}개`
    : metrics.dynamicRebuildCount > 0
      ? `${metrics.dynamicRebuildMs.toFixed(2)} ms / ${metrics.dynamicRebuildCount} flow`
      : `age ${metrics.dynamicRebuildAgeSteps} / ${metrics.dynamicRebuildIntervalSteps} step`;
  document.body.dataset.step = String(simulation.stepCount);
  document.body.dataset.agents = String(simulation.config.agentCount);
  document.body.dataset.paused = String(!running && !fastForwarding);
  document.body.dataset.preset = simulation.resolvedExperiment.preset.id;
  const stats = simulation.experimentStats;
  element('lab-live').textContent = `생성 ${simulation.state.count.toLocaleString()} · 활성 ${metrics.activeCount.toLocaleString()} · 이동 ${stats.movingCount.toLocaleString()} · 대기 ${stats.waitingCount.toLocaleString()} · 도착 ${metrics.arrivedCount.toLocaleString()} · 접촉 활성 ${stats.contactActiveCount.toLocaleString()} · 벽시계 Hz ${recorder.achievedHz.toFixed(1)} · 슬롯 부족 ${stats.unavailableSlots} · 회피 이웃 잘림 ${stats.neighborTruncations}`;
  element('lab-passes').textContent = Object.entries(stats.passMs).map(([key, value]) => `${key} ${value.toFixed(2)}ms`).join(' · ')
    + ` | 경로 요청 ${stats.pathRequests} · 공유 재사용 ${stats.cacheHits} · field 생성 ${stats.fieldBuilds} · 지형 v${stats.terrainVersion}`;
}

function syncLabControls(): void {
  const { preset, options } = simulation.resolvedExperiment;
  element<HTMLSelectElement>('preset-select').value = preset.id;
  element('preset-description').textContent = preset.description;
  element('preset-limitations').textContent = preset.limitations;
  element('destination-description').textContent = options.destination === 'slots'
    ? '초록 빈 원은 각 유닛의 도착 슬롯입니다(최대 2,000개 표시). 파란 원은 부대 명령 중심이며, 목표에서 보이는 주변 공간에 슬롯이 분산됩니다. 초록색 유닛은 도착 후 자리를 유지합니다.'
    : preset.id === 'legacy' ? '파란 영역에 도착하면 유닛을 출구로 제거합니다. 기존 도착 판정을 보존한 기준 프리셋입니다.'
      : '파란 영역에 도착하면 유닛을 출구로 제거합니다. 벽에 가려진 목표는 도착으로 처리하지 않습니다.';
  element<HTMLFieldSetElement>('module-controls').disabled = preset.id === 'legacy';
  element<HTMLFieldSetElement>('individual-controls').disabled = preset.id === 'legacy';
  for (const [key, value] of Object.entries(options)) {
    const control = document.getElementById(`module-${key}`) as HTMLInputElement | HTMLSelectElement | null;
    if (!control) continue;
    if (typeof value === 'boolean') (control as HTMLInputElement).checked = value;
    else control.value = String(value);
  }
  element<HTMLButtonElement>('map-edit').disabled = scaledWorld && worldScale !== 1;
  element<HTMLInputElement>('scale-world').checked = scaledWorld;
}

function initializeLabControls(): void {
  syncLabControls();
  renderSavedResults();
  element('preset-select').addEventListener('change', () => {
    config.preset = element<HTMLSelectElement>('preset-select').value as PresetId;
    config.experiment = undefined;
    running = false;
    rebuildSimulation(baseScenario);
    updateRunState();
  });
  element('scale-world').addEventListener('change', () => {
    scaledWorld = element<HTMLInputElement>('scale-world').checked;
    rebuildSimulation(baseScenario);
  });
  element('quality-mode').addEventListener('change', () => rebuildSimulation(baseScenario));
  element('send-agent-command').addEventListener('click', () => {
    const agent = Number(element<HTMLInputElement>('command-agent').value);
    const goal = { x: Number(element<HTMLInputElement>('command-x').value), y: Number(element<HTMLInputElement>('command-y').value) };
    try {
      simulation.setAgentGoal(agent, goal.x, goal.y);
      const command: LabCommand = { type: 'agent-goals', step: simulation.stepCount, goals: [{ agent, goal }] };
      commandLog.push(command); appliedLiveCommands.add(command);
      element('lab-error').hidden = true; updateMetrics(); renderer.render(1);
    } catch (error) { element('lab-error').hidden = false; element('lab-error').textContent = String(error); }
  });
  element('apply-modules').addEventListener('click', () => {
    const options = { ...simulation.resolvedExperiment.options };
    for (const key of Object.keys(options) as Array<keyof ExperimentOptions>) {
      const control = element<HTMLInputElement>(`module-${key}`);
      (options as unknown as Record<string, unknown>)[key] = typeof options[key] === 'boolean' ? control.checked : typeof options[key] === 'number' ? Number(control.value) : control.value;
    }
    try {
      resolveExperiment({ preset: config.preset, experiment: options });
      config.experiment = options;
      element('lab-error').hidden = true;
      running = false;
      rebuildSimulation(baseScenario);
      updateRunState();
    } catch (error) {
      element('lab-error').hidden = false;
      element('lab-error').textContent = String(error);
    }
  });
  element('run-current').addEventListener('click', () => { void compareRuns(false); });
  element('compare-presets').addEventListener('click', () => { void compareRuns(true); });
  element('cancel-comparison').addEventListener('click', () => { comparisonCancelled = true; });
  element('save-result').addEventListener('click', () => saveResult(recorder.result(commandLog)));
  element('export-results').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(savedResults, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'crowd-lab-results.json'; link.click(); URL.revokeObjectURL(url);
  });
  element('clear-results').addEventListener('click', () => { savedResults = []; persistResults(); });
}

function comparisonKey(result: LabResult): string {
  const { preset: _preset, experiment: _options, ...physical } = result.config;
  return JSON.stringify({ config: physical, scenario: result.scenario, commands: result.commands, step: result.step });
}

function renderSavedResults(): void {
  const body = element('result-rows'); body.replaceChildren();
  for (const result of savedResults) {
    const row = document.createElement('tr');
    const same = savedResults.filter(other => comparisonKey(other) === comparisonKey(result)).length;
    const values = [`${result.preset} · ${result.scenario.name}`, `${result.requested} / ${result.spawned}`,
      `${result.active} / ${result.moving} / ${result.waiting} / ${result.arrived}`,
      `${result.timing.stepMs.p50.toFixed(2)} / ${result.timing.stepMs.p95.toFixed(2)}`, result.timing.simulationCapacityHz.toFixed(1),
      `${(result.arrivalRate * 100).toFixed(1)}%`, result.quality.maximumOverlapPairs ?? '미측정', result.quality.maximumWallCount, `${same}개 · ${result.hash}`];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); }
    body.append(row);
  }
}

function persistResults(): void {
  try { localStorage.setItem('crowd-lab-results-v1', JSON.stringify(savedResults)); }
  catch { element('comparison-status').textContent = '브라우저 저장 공간이 부족합니다. 결과 JSON을 내보내세요. 현재 세션 결과는 유지됩니다.'; }
  renderSavedResults();
}

function saveResult(result: LabResult): void { savedResults.push(result); savedResults = savedResults.slice(-24); persistResults(); }

async function compareRuns(all: boolean): Promise<void> {
  if (comparisonRunning) return;
  if (all && commandLog.some(command => command.type === 'agent-goals')) {
    element('comparison-status').textContent = '개별 명령은 Legacy가 지원하지 않습니다. 현재 조합 재실행으로 비교하거나 초기화하여 공통 명령으로 6개 프리셋을 비교하세요.';
    return;
  }
  comparisonRunning = true; comparisonCancelled = false; running = false; fastForwarding = false;
  const runConfig = structuredClone(config), runScenario = structuredClone(baseScenario), replay = structuredClone(commandLog);
  const ids = all ? PRESETS.map(p => p.id) : [simulation.resolvedExperiment.preset.id];
  const steps = parseInteger(element<HTMLInputElement>('comparison-steps').value, 600, 1, 100000);
  const quality = Number(element<HTMLSelectElement>('quality-mode').value);
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')].map(control => ({ control, disabled: control.disabled }));
  controls.forEach(({ control }) => { control.disabled = true; });
  element<HTMLButtonElement>('cancel-comparison').disabled = false;
  updateRunState();
  try {
    for (const id of ids) {
      if (comparisonCancelled) break;
      Object.assign(config, structuredClone(runConfig), { preset: id, experiment: all ? undefined : runConfig.experiment });
      const start = performance.now();
      simulation = new CrowdSimulation(config, scaleScenario(runScenario, worldScale));
      recorder = new LabRecorder(simulation, quality, 0, performance.now() - start);
      runtimeMetrics.reset(); commandLog = structuredClone(replay); appliedLiveCommands = new Set();
      while (simulation.stepCount < steps && !comparisonCancelled) {
        const sliceStart = performance.now();
        do { timedStep(); } while (simulation.stepCount < steps && performance.now() - sliceStart < 10);
        element('comparison-status').textContent = `${id}: ${simulation.stepCount}/${steps} step · ${simulation.state.count}명 생성 · ${simulation.metrics.activeCount}명 활성`;
        updateMetrics();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      if (!comparisonCancelled) saveResult(recorder.result(commandLog));
    }
    element('comparison-status').textContent = comparisonCancelled ? '중단했습니다. 완료한 프리셋 결과는 저장되어 있습니다.' : `${ids.length}개 실행 완료. 동일 입력 열과 도착 모델을 함께 확인하세요.`;
  } catch (error) { element('comparison-status').textContent = `실행 실패: ${String(error)}`; }
  finally {
    comparisonRunning = false; controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    element<HTMLButtonElement>('cancel-comparison').disabled = true;
    syncLabControls(); updateMetrics(); updateRunState();
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function registerCustomMap(scenario: ScenarioDefinition): void {
  customScenarios.set(scenario.id, scenario);
  const select = element<HTMLSelectElement>('scenario-select');
  let option = Array.from(select.options).find((entry) => entry.value === scenario.id);
  if (!option) {
    option = new Option('', scenario.id);
    select.add(option);
  }
  option.textContent = `내 맵 · ${scenario.name}`;
}

function parseNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
