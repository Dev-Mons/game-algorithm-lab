import './ui/styles.css';
import { FixedClock } from './core/fixed-clock';
import { RuntimeMetrics } from './core/metrics';
import { CrowdSimulation, DEFAULT_CONFIG } from './core/simulation';
import type { SimulationConfig, StepMetrics } from './core/types';
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
const scenarioId = params.get('scenario') ?? 'open-field';
const requestedAgents = parseInteger(params.get('agents'), DEFAULT_CONFIG.agentCount, 1, 5000);
const requestedSeed = parseInteger(params.get('seed'), DEFAULT_CONFIG.seed, -2147483648, 2147483647);
const targetStep = parseInteger(params.get('step'), 0, 0, 1_000_000);
const requestedPaused = params.get('paused') === 'true';
const config: SimulationConfig = { ...DEFAULT_CONFIG, agentCount: requestedAgents, seed: requestedSeed };
let simulation = new CrowdSimulation(config, getScenario(scenarioId));
let running = !requestedPaused;
let fastForwarding = targetStep > 0;
let timeScale = 1;
const clock = new FixedClock(config.fixedDelta);
const runtimeMetrics = new RuntimeMetrics();
const canvas = element<HTMLCanvasElement>('crowd-canvas');
const renderer = new CanvasRenderer(canvas, () => simulation, DEFAULT_DEBUG_OPTIONS);
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
      running = !requestedPaused && targetStep === 0;
      window.crowdDebug.ready = true;
      updateRunState();
    }
  } else if (running) {
    alpha = clock.consume(seconds, timeScale, timedStep);
  } else {
    clock.reset(seconds);
  }
  renderer.render(alpha);
  if (now - lastMetricsUpdate > 120) {
    updateMetrics();
    lastMetricsUpdate = now;
  }
  requestAnimationFrame(frame);
}

function timedStep(): void {
  const start = performance.now();
  simulation.step();
  runtimeMetrics.recordStep(performance.now() - start);
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
    renderer.render(0);
  });
  element<HTMLButtonElement>('reset').addEventListener('click', resetSimulation);
  element<HTMLSelectElement>('time-scale').addEventListener('change', (event) => {
    timeScale = Number((event.currentTarget as HTMLSelectElement).value);
  });
  scenarioSelect.addEventListener('change', () => {
    rebuildSimulation(getScenario(scenarioSelect.value));
    updateScenarioText();
  });
  element<HTMLInputElement>('agent-count').addEventListener('change', (event) => {
    config.agentCount = Math.max(1, Math.min(5000, Number((event.currentTarget as HTMLInputElement).value) || 1000));
    rebuildSimulation(simulation.scenario);
  });
  element<HTMLInputElement>('seed').addEventListener('change', (event) => {
    config.seed = Math.trunc(Number((event.currentTarget as HTMLInputElement).value) || 0);
    resetSimulation();
  });

  bindRange('max-speed', 'maxSpeed');
  bindRange('max-acceleration', 'maxAcceleration');
  bindRange('max-turn-rate', 'maxTurnRate');
  bindRange('agent-radius', 'agentRadius');
  bindRange('neighbor-radius', 'neighborRadius');
  bindRange('agent-gap', 'agentGap');
  bindRange('avoidance-horizon', 'avoidanceHorizon');
  bindRange('goal-radius', 'goalRadius');
  bindToggle('debug-flow', 'flowField');
  bindToggle('debug-grid', 'spatialGrid');
  bindToggle('debug-velocity', 'velocity');
  bindToggle('debug-neighbors', 'neighborRadius');
  bindToggle('debug-overlaps', 'overlaps');
  bindToggle('debug-stalled', 'stalled');

  canvas.addEventListener('click', (event) => {
    const bounds = canvas.getBoundingClientRect();
    simulation.setGoal(
      ((event.clientX - bounds.left) / bounds.width) * simulation.config.width,
      ((event.clientY - bounds.top) / bounds.height) * simulation.config.height,
    );
    renderer.render(0);
  });
}

function bindRange(id: string, key: keyof SimulationConfig): void {
  const input = element<HTMLInputElement>(id);
  const output = element<HTMLOutputElement>(`${id}-output`);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    const current = simulation.config[key];
    if (typeof current === 'number') simulation.config[key] = value;
    output.value = input.value;
  });
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
  element<HTMLElement>('status-label').textContent = fastForwarding ? '목표 스텝 계산 중' : paused ? '일시정지' : '실행 중';
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
  element<HTMLElement>('metric-fps').textContent = runtimeMetrics.fps.toFixed(1);
  element<HTMLElement>('metric-step-time').textContent = `${runtimeMetrics.averageStepMs.toFixed(2)} / ${runtimeMetrics.maxStepMs.toFixed(2)} ms`;
  element<HTMLElement>('metric-active').textContent = metrics.activeCount.toLocaleString();
  element<HTMLElement>('metric-arrived').textContent = `${metrics.arrivedCount.toLocaleString()} / ${(metrics.arrivalRate * 100).toFixed(1)}%`;
  element<HTMLElement>('metric-speed').textContent = metrics.averageSpeed.toFixed(1);
  element<HTMLElement>('metric-overlap').textContent = metrics.overlapPairs.toLocaleString();
  element<HTMLElement>('metric-stalled').textContent = metrics.stalledCount.toLocaleString();
  element<HTMLElement>('metric-neighbors').textContent = `${metrics.averageNeighbors.toFixed(1)} / ${metrics.maxNeighbors}`;
  element<HTMLElement>('metric-candidates').textContent = metrics.candidateChecks.toLocaleString();
  element<HTMLElement>('metric-backward').textContent = `${metrics.backwardCount.toLocaleString()} / ${metrics.strongBackwardCount.toLocaleString()}`;
  element<HTMLElement>('metric-wall-overlap').textContent = metrics.wallOverlapCount.toLocaleString();
  element<HTMLElement>('metric-velocity-delta').textContent = `${metrics.averageVelocityDelta.toFixed(2)} / ${metrics.maxVelocityDelta.toFixed(2)}`;
  element<HTMLElement>('metric-hard-stop').textContent = `${metrics.hardStopCount.toLocaleString()} / ${metrics.emergencyStopCount.toLocaleString()}`;
  element<HTMLElement>('metric-reservation').textContent = `${metrics.reservationLimitedCount.toLocaleString()} / ${metrics.reservationStoppedCount.toLocaleString()}`;
  element<HTMLElement>('metric-reciprocal').textContent = `${metrics.reciprocalConstraintCount.toLocaleString()} / ${metrics.reciprocalProjectionRepairCount.toLocaleString()}`;
  element<HTMLElement>('metric-side-switch').textContent = `${metrics.sideSwitchCount.toLocaleString()} / ${metrics.stopMoveStopCount.toLocaleString()}`;
  element<HTMLElement>('metric-adjacent-stop').textContent = metrics.longAdjacentStopCount.toLocaleString();
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
