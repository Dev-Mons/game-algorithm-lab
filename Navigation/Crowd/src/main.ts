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
const requestedAgents = parseInteger(params.get('agents'), DEFAULT_CONFIG.agentCount, 1, 10_000);
const requestedSeed = parseInteger(params.get('seed'), DEFAULT_CONFIG.seed, -2147483648, 2147483647);
const targetStep = parseInteger(params.get('step'), 0, 0, 1_000_000);
const requestedPaused = params.get('paused') === 'true';
const config: SimulationConfig = {
  ...DEFAULT_CONFIG,
  agentCount: requestedAgents,
  seed: requestedSeed,
  agentRadius: parseNumber(params.get('radius'), DEFAULT_CONFIG.agentRadius, 1.5, 8),
  largeAgentPercent: parseNumber(params.get('largePercent'), DEFAULT_CONFIG.largeAgentPercent, 0, 100),
  largeAgentScale: parseNumber(params.get('largeScale'), DEFAULT_CONFIG.largeAgentScale, 1, 4),
  agentGap: parseNumber(params.get('gap'), DEFAULT_CONFIG.agentGap, 0, 3),
};
let simulation = new CrowdSimulation(config, initialScenario);
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
  } else if (running) {
    alpha = clock.consume(seconds, timeScale, timedStep);
  } else {
    clock.reset(seconds);
    alpha = 1;
  }
  if (!editor.active) renderer.render(alpha);
  if (now - lastMetricsUpdate > 120) {
    updateMetrics();
    lastMetricsUpdate = now;
  }
  requestAnimationFrame(frame);
}

function timedStep(): void {
  const startedAt = performance.now();
  simulation.step();
  runtimeMetrics.recordStep(performance.now() - startedAt);
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
      Math.min(10_000, Number((event.currentTarget as HTMLInputElement).value) || 1000),
    );
    rebuildSimulation(simulation.scenario);
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
  bindRange('dynamic-rebuild-interval', 'dynamicFlowRebuildInterval');
  bindRange('dynamic-target-density', 'dynamicFlowTargetDensity');
  bindRange('dynamic-density-weight', 'dynamicFlowDensityWeight');
  bindRange('dynamic-overload-weight', 'dynamicFlowOverloadWeight');
  bindRange('dynamic-counter-weight', 'dynamicFlowCounterFlowWeight');
  bindRange('dynamic-wall-weight', 'dynamicFlowWallWeight');
  bindRange('dynamic-cost-smoothing', 'dynamicFlowCostSmoothing');
  bindRange('dynamic-direction-hysteresis', 'dynamicFlowDirectionHysteresis');
  bindToggle('debug-flow', 'flowField');
  bindToggle('debug-grid', 'spatialGrid');
  bindToggle('debug-velocity', 'velocity');
  bindToggle('debug-desired', 'desiredVelocity');
  bindToggle('debug-density', 'density');
  bindToggle('debug-dynamic-density', 'dynamicDensityCost');
  bindToggle('debug-dynamic-overload', 'dynamicOverloadCost');
  bindToggle('debug-dynamic-counter', 'dynamicCounterFlowCost');
  bindToggle('debug-dynamic-wall', 'dynamicWallCost');
  bindToggle('debug-recovery', 'recovery');
  bindToggle('debug-neighbors', 'neighborRadius');
  bindToggle('debug-overlaps', 'overlaps');
  bindToggle('debug-stalled', 'stalled');

  canvas.addEventListener('click', (event) => {
    if (editor.active) return;
    const bounds = canvas.getBoundingClientRect();
    simulation.setGoal(
      ((event.clientX - bounds.left) / bounds.width) * simulation.config.width,
      ((event.clientY - bounds.top) / bounds.height) * simulation.config.height,
    );
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
      rebuildSimulation(simulation.scenario);
    });
  }
}

function bindToggle(id: string, key: keyof typeof DEFAULT_DEBUG_OPTIONS): void {
  const input = element<HTMLInputElement>(id);
  input.addEventListener('change', () => { DEFAULT_DEBUG_OPTIONS[key] = input.checked; });
}

function rebuildSimulation(scenario: ReturnType<typeof getScenario>): void {
  simulation = new CrowdSimulation(config, scenario);
  runtimeMetrics.reset();
  fastForwarding = false;
  window.crowdDebug.ready = true;
  element<HTMLSelectElement>('scenario-select').value = scenario.id;
  updateScenarioText();
  updateMetrics();
  renderer.render(0);
}

function resetSimulation(): void {
  simulation.reset();
  runtimeMetrics.reset();
  fastForwarding = false;
  window.crowdDebug.ready = true;
  updateMetrics();
  renderer.render(0);
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
  element<HTMLElement>('metric-dynamic-rebuild').textContent = metrics.dynamicRebuildCount > 0
    ? `${metrics.dynamicRebuildMs.toFixed(2)} ms / ${metrics.dynamicRebuildCount} flow`
    : `age ${metrics.dynamicRebuildAgeSteps} / ${metrics.dynamicRebuildIntervalSteps} step`;
  document.body.dataset.step = String(simulation.stepCount);
  document.body.dataset.agents = String(simulation.config.agentCount);
  document.body.dataset.paused = String(!running && !fastForwarding);
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
