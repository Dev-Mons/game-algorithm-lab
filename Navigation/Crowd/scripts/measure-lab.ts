import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import { PRESETS, type PresetId } from '../src/algorithms/lab/registry';
import { LabRecorder, type LabResult } from '../src/core/lab-results';
import { CrowdSimulation, DEFAULT_CONFIG } from '../src/core/simulation';
import { LAB_SCENARIOS, applyCommands, defaultCommands, scaleScenario } from '../src/scenarios/lab-scenarios';
import { SCENARIOS } from '../src/scenarios/scenarios';
import type { Vec2 } from '../src/core/types';

type Status = 'completed' | 'capacity-reduced' | 'timeout' | 'error';
interface Case { preset: PresetId; scenario: string; agents: number; }
interface MemorySample { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; }
interface Measurement {
  case: Case;
  status: Status;
  reason?: string;
  elapsedWallMs: number;
  lastProgress?: unknown;
  result?: LabResult;
  executionSourceSha256?: string;
  setupCommands?: Array<{ step: number; type: 'individual-goals'; distinctGoals: number; assignments: Array<{ agent: number; goal: Vec2 }> }>;
  instrumentation?: { observerMs: number; commandMs: number; measuredWallMs: number; measuredHz: number; snapshotProtocolMs: number; };
  processMemory?: { scope: string; beforeInitialization: MemorySample; afterInitialization: MemorySample; observedPeak: MemorySample; end: MemorySample; };
}

const args = process.argv.slice(2);
const arg = (name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const numberArg = (name: string, fallback: number, minimum = 0): number => {
  const value = Number(arg(name) ?? fallback);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) throw new RangeError(`--${name} must be an integer >= ${minimum}`);
  return value;
};
const steps = numberArg('steps', 600, 1);
const warmup = numberArg('warmup', 60);
if (warmup >= steps) throw new RangeError('--warmup must be smaller than --steps');
const quality = numberArg('quality', 0);
if (![0, 1, 10].includes(quality)) throw new RangeError('--quality must be 0, 1 or 10');
const seed = numberArg('seed', 42);
const walltimeSeconds = numberArg('timeout', 90, 1);
const scaled = arg('scale') !== 'false';
const scenarios = [...SCENARIOS, ...LAB_SCENARIOS];
const selectedPresets = (arg('presets') ?? PRESETS.map(preset => preset.id).join(',')).split(',');
const selectedScenarios = (arg('scenario') ?? 'open-field').split(',');
const populations = (arg('agents') ?? '1000').split(',').map(Number);
for (const preset of selectedPresets) if (!PRESETS.some(candidate => candidate.id === preset)) throw new RangeError(`Unknown preset ${preset}`);
for (const scenario of selectedScenarios) if (!scenarios.some(candidate => candidate.id === scenario)) throw new RangeError(`Unknown scenario ${scenario}`);
for (const population of populations) if (!Number.isInteger(population) || population < 1 || population > 100_000) throw new RangeError('Agent populations must be integers within 1–100000');
const destinations = arg('destinations');
if (destinations && !['1', '4', '32', 'N'].includes(destinations)) throw new RangeError('--destinations must be 1, 4, 32 or N');

function memorySample(): MemorySample {
  const memory = process.memoryUsage();
  return { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external, arrayBuffers: memory.arrayBuffers };
}

function protocol(value: unknown): void { process.stdout.write(`${JSON.stringify(value)}\n`); }

function goalsFor(simulation: CrowdSimulation, count: number): Vec2[] {
  // A deterministic open-space goal lattice provides exactly D distinct target
  // coordinates. Destination stress is restricted to open-field so clamping a
  // goal out of an obstacle cannot accidentally merge distinct goals.
  const width = simulation.config.width, height = simulation.config.height;
  const columns = Math.ceil(Math.sqrt(count * width / height));
  const rows = Math.ceil(count / columns);
  const goals = Array.from({ length: count }, (_, i) => ({
    x: width * (.55 + .4 * (i % columns + .5) / columns),
    y: height * (.05 + .9 * (Math.floor(i / columns) + .5) / rows),
  }));
  return Array.from({ length: simulation.state.count }, (_, i) => goals[i % goals.length]!);
}

async function runWorker(item: Case): Promise<void> {
  const executionSourceSha256 = sourceManifest().executionSourceSha256;
  const started = performance.now();
  const before = memorySample();
  let lastProgress: unknown = { phase: 'initializing', completedSteps: 0 };
  try {
    const scale = scaled ? Math.sqrt(item.agents / 1000) : 1;
    const scenario = scaleScenario(scenarios.find(candidate => candidate.id === item.scenario)!, scale);
    const simulation = new CrowdSimulation({ ...DEFAULT_CONFIG, preset: item.preset, seed, agentCount: item.agents,
      width: DEFAULT_CONFIG.width * scale, height: DEFAULT_CONFIG.height * scale }, scenario);
    let commandMs = 0;
    const setupCommands: NonNullable<Measurement['setupCommands']> = [];
    if (destinations) {
      if (scenario.id !== 'open-field') throw new RangeError('--destinations stress currently requires --scenario=open-field');
      const commandStart = performance.now();
      const count = destinations === 'N' ? simulation.state.count : Number(destinations);
      if (count > simulation.state.count) throw new RangeError('Destination count cannot exceed spawned agents');
      const assignments = goalsFor(simulation, count).map((goal, agent) => ({ agent, goal }));
      simulation.setAgentGoals(assignments);
      setupCommands.push({ step: 0, type: 'individual-goals', distinctGoals: count, assignments });
      commandMs += performance.now() - commandStart;
    }
    const initMs = performance.now() - started;
    const after = memorySample();
    const peak = { ...after };
    const sampleMemory = () => {
      const sample = memorySample();
      for (const key of Object.keys(peak) as Array<keyof MemorySample>) peak[key] = Math.max(peak[key], sample[key]);
      return sample;
    };
    const commands = defaultCommands(scenario, scale);
    const recorder = new LabRecorder(simulation, quality, warmup, initMs);
    let observerMs = 0, snapshotProtocolMs = 0, measuredStart = 0;
    protocol({ type: 'initialized', data: { ...item, spawned: simulation.state.count, initMs, memory: after } });
    for (let step = 0; step < steps; step++) {
      if (step === warmup) measuredStart = performance.now();
      const commandStart = performance.now();
      applyCommands(simulation, commands);
      commandMs += performance.now() - commandStart;
      const stepStart = performance.now();
      simulation.step();
      const stepMs = performance.now() - stepStart;
      const observerStart = performance.now();
      recorder.record(stepMs);
      if (step % 10 === 0 || step === steps - 1) sampleMemory();
      observerMs += performance.now() - observerStart;
      if ((step + 1) % 60 === 0 || step === steps - 1) {
        const reportStart = performance.now();
        lastProgress = { phase: 'simulating', completedSteps: step + 1, spawned: simulation.state.count,
          active: simulation.metrics.activeCount, arrived: simulation.metrics.arrivedCount,
          elapsedWallMs: performance.now() - started, lastStepMs: stepMs, observedProcessMemory: peak };
        protocol({ type: 'progress', data: lastProgress });
        snapshotProtocolMs += performance.now() - reportStart;
      }
    }
    const measuredWallMs = performance.now() - measuredStart;
    const record: Measurement = { case: item, executionSourceSha256, setupCommands, status: simulation.unspawnedCount ? 'capacity-reduced' : 'completed',
      ...(simulation.unspawnedCount ? { reason: 'Spawn capacity was below requested population; this is not a full-population comparison.' } : {}),
      elapsedWallMs: performance.now() - started, result: recorder.result(commands),
      instrumentation: { observerMs, commandMs, measuredWallMs, measuredHz: (steps - warmup) * 1000 / measuredWallMs, snapshotProtocolMs },
      processMemory: { scope: 'Node child process, including Vite transform/runtime and all simulation buffers; sampled every 10 ticks, not true peak or solver-only allocation.',
        beforeInitialization: before, afterInitialization: after, observedPeak: peak, end: sampleMemory() } };
    protocol({ type: 'result', data: record });
  } catch (error) {
    protocol({ type: 'result', data: { case: item, executionSourceSha256, status: 'error', reason: error instanceof Error ? error.stack : String(error),
      elapsedWallMs: performance.now() - started, lastProgress } satisfies Measurement });
  }
}

function sourceManifest() {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|css|html|json)$/.test(entry.name)) files.push(path);
    }
  };
  walk(resolve('src'));
  files.push(resolve('scripts/measure-lab.ts'), resolve('package.json'), resolve('package-lock.json'));
  const hashes = Object.fromEntries(files.sort().map(path => [relative(process.cwd(), path).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const executionFiles = Object.fromEntries(Object.entries(hashes).filter(([path]) =>
    /^(src\/(core|algorithms|scenarios)\/|scripts\/measure-lab\.ts|package(-lock)?\.json)/.test(path)));
  return { head, sourceSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    executionSourceSha256: createHash('sha256').update(JSON.stringify(executionFiles)).digest('hex'), files: hashes };
}

async function runIsolated(item: Case): Promise<Measurement> {
  return await new Promise(resolveCase => {
    const started = performance.now();
    const forwarded = args.filter(value => !/^--(presets|scenario|agents|output|worker)=/.test(value));
    const child = spawn(process.execPath, [resolve('node_modules/vite-node/vite-node.mjs'), resolve('scripts/measure-lab.ts'),
      ...forwarded, `--presets=${item.preset}`, `--scenario=${item.scenario}`, `--agents=${item.agents}`, '--worker=true'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '', stderr = '', timedOut = false, lastProgress: unknown, record: Measurement | undefined;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, walltimeSeconds * 1000);
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line) as { type: string; data: unknown };
          if (message.type === 'result') record = message.data as Measurement;
          else if (message.type === 'progress' || message.type === 'initialized') lastProgress = message.data;
        } catch { stderr += line.slice(0, 2000); }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-10000); });
    child.on('error', error => { clearTimeout(timer); resolveCase({ case: item, status: 'error', reason: error.message, elapsedWallMs: performance.now() - started }); });
    child.on('close', code => {
      clearTimeout(timer);
      resolveCase(record ?? { case: item, status: timedOut ? 'timeout' : 'error',
        reason: timedOut ? `Hard wall-time limit ${walltimeSeconds}s includes child startup, initialization, warmup, simulation and audit.` : `Worker exited ${code} without a result. ${stderr}`,
        elapsedWallMs: performance.now() - started, lastProgress });
    });
  });
}

if (arg('worker') === 'true') {
  await runWorker({ preset: selectedPresets[0] as PresetId, scenario: selectedScenarios[0]!, agents: populations[0]! });
} else {
  const source = sourceManifest();
  const cases = populations.flatMap(agents => selectedScenarios.flatMap(scenario => selectedPresets.map(preset => ({ agents, scenario, preset: preset as PresetId }))));
  const records: Measurement[] = [];
  const output = arg('output');
  const report = {
    schema: 'crowd-lab-measurements-v1', createdAt: new Date().toISOString(), source,
    environment: { node: process.version, v8: process.versions.v8, os: platform(), osRelease: release(), arch: arch(),
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, systemMemoryBytes: totalmem(), freeSystemMemoryBytesAtStart: freemem(),
      simulationThreads: 1, runtime: 'Node + vite-node (TypeScript transformed); no production-browser/JIT equivalence claimed',
      gpu: 'unused', render: 'headless; canvas, browser layout and full frame timing excluded', powerClock: 'not controlled' },
    contract: { args, steps, warmupSteps: warmup, qualityAuditEverySteps: quality, seed, scale: scaled,
      densityPolicy: scaled ? 'World and scenario geometry scaled by sqrt(N/1000); physical radius/gap/speed/dt/grid cell sizes unchanged.' : 'Same world area; larger N is capacity/overload stress.',
      destinations: destinations ?? 'scenario-defined', walltimeLimitSecondsPerCase: walltimeSeconds,
      qualification: 'Finite engineering comparison, not the research 10s warmup + 60s duration + 5 seed acceptance protocol.',
      observerScope: 'Step timing excludes command dispatch, recorder/audit, process-memory sampling and JSON output. These overheads are reported separately.',
      memoryScope: 'Independent child per case, no cross-case heap retention. Observed memory peak is sampled, not guaranteed high-water mark.' },
    records,
  };
  const save = () => {
    if (!output) return;
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  };
  save();
  for (const item of cases) {
    console.error(`Measuring ${item.preset} / ${item.scenario} / ${item.agents} agents (${steps} ticks; audit ${quality}; limit ${walltimeSeconds}s)`);
    const record = await runIsolated(item);
    records.push(record);
    save();
    console.error(`${record.status}: ${record.result ? `spawned=${record.result.spawned}, active=${record.result.active}, p95=${record.result.timing.stepMs.p95.toFixed(3)}ms` : record.reason}`);
  }
  const sourceAfter = sourceManifest();
  if (sourceAfter.sourceSha256 !== source.sourceSha256) {
    const executionSourceChangedDuringRun = sourceAfter.executionSourceSha256 !== source.executionSourceSha256;
    Object.assign(report, { sourceChangedDuringRun: true, executionSourceChangedDuringRun, sourceAfter });
    save();
    console.error(executionSourceChangedDuringRun
      ? 'Simulation or measurement source changed while this matrix ran; do not use it as a fixed-code performance comparison.'
      : 'UI-only source changed while this headless matrix ran; simulation/measurement source stayed fixed.');
  }
  if (!output) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // Persist every case before signaling incomplete/error populations to shell
  // automation. A deliberate timeout test therefore has a nonzero exit code.
  if (records.some(record => record.status !== 'completed')) process.exitCode = 1;
}
