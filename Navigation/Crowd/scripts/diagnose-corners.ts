import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, platform, release } from 'node:os';
import type { CrowdSimulation as Simulation } from '../src/core/simulation';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const integer = (name: string, fallback: number, minimum = 1) => {
  const value = Number(arg(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum) throw new RangeError(`Invalid --${name}`);
  return value;
};
const sourceRoot = resolve(arg('source', '.'));
const agents = integer('agents', 1000);
const ticks = integer('ticks', 3600);
const tailTicks = integer('tail-ticks', ticks);
if (tailTicks < ticks) throw new RangeError('--tail-ticks must not be smaller than --ticks');
const tailPresets = new Set(arg('tail-presets', '').split(','));
const stopOnComplete = arg('stop-on-complete', 'false') === 'true';
const auditEvery = integer('audit-every', 30, 0);
const seed = integer('seed', 42, 0);
const output = resolve(arg('output', 'baselines/corners-diagnostic.json'));
const sourceFiles: Record<string, string> = {};
function scan(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (entry.name.endsWith('.ts')) sourceFiles[relative(sourceRoot, full).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(full)).digest('hex');
  }
}
scan(resolve(sourceRoot, 'src'));
const sourceHash = createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex');
// Execute an immutable copy for the baseline while repairs proceed in main.
const { CrowdSimulation, DEFAULT_CONFIG } = await import(pathToFileURL(resolve(sourceRoot, 'src/core/simulation.ts')).href) as typeof import('../src/core/simulation');
const { getScenario } = await import(pathToFileURL(resolve(sourceRoot, 'src/scenarios/scenarios.ts')).href) as typeof import('../src/scenarios/scenarios');
const { auditGeometry } = await import(pathToFileURL(resolve(sourceRoot, 'src/core/lab-results.ts')).href) as typeof import('../src/core/lab-results');
const { PRESETS } = await import(pathToFileURL(resolve(sourceRoot, 'src/algorithms/lab/registry.ts')).href) as typeof import('../src/algorithms/lab/registry');
const presets = arg('presets', PRESETS.map(preset => preset.id).join(',')).split(',');
for (const preset of presets) if (!PRESETS.some((candidate) => candidate.id === preset)) throw new RangeError(`Unknown preset ${preset}`);

const GATES = [
  { id: 'wall-1-lower', x: 408, minY: 504, maxY: 720 },
  { id: 'wall-2-upper', x: 672, minY: 0, maxY: 216 },
  { id: 'wall-3-lower', x: 936, minY: 504, maxY: 720 },
] as const;
interface GateProgress { id: string; forwardUnique: number; reverseUnique: number; orderedUnique: number; targetBeyond: number; targetBeyondPassed: number; }
interface Example {
  agent: number; x: number; y: number; vx: number; vy: number; speed: number; stalledSeconds: number;
  desiredX: number; desiredY: number; desiredSpeed: number; intentX: number; intentY: number;
  goalX: number; goalY: number; goalDistance: number; highestGatePassed: number; radius: number;
}
interface Progress {
  tick: number; seconds: number; active: number; arrived: number; moving: number; waiting: number; stalled: number;
  unavailableSlots: number; invalidStaticStarts: number; runtimeWalls: number; finite: boolean;
  longestStalledSeconds: number;
  gateProgress: GateProgress[]; stageActive: number[]; exemplar: Example[];
}
interface CaseResult {
  preset: string; status: 'completed' | 'error'; error?: string; config?: unknown; scenario?: unknown; options?: unknown;
  sourceHash: string; requested: number; spawned?: number; unspawned?: number; initMs?: number; wallMs: number;
  finalHash?: string; progress: Progress[]; audit?: Record<string, number | string>;
  firstAllArrivedTick: number | null;
  baseTicks: number; maximumTicks: number;
  maxima?: Record<string, number>; final?: Progress;
}
const report = {
  schema: 'crowd-corner-diagnostic-v1', createdAt: new Date().toISOString(),
  source: { root: sourceRoot, sha256: sourceHash, files: sourceFiles,
    diagnosticSha256: createHash('sha256').update(readFileSync(resolve('scripts/diagnose-corners.ts'))).digest('hex') },
  environment: { node: process.version, v8: process.versions.v8, platform: platform(), release: release(), cpu: cpus()[0]?.model,
    scope: 'Single-thread headless diagnostic; source snapshot imports; no rendering/performance qualification.' },
  contract: { args, agents, ticks, tailTicks, tailPresets: [...tailPresets], stopOnComplete, seed, auditEvery, gates: GATES,
    duration: stopOnComplete ? 'Cases stop exactly at full arrival or their explicit tick limit. Progress includes every 300 ticks reached, including tick 3600 when still active. No case restarts to extend its tail.'
      : 'Every case records the full base tick window. Named tail presets then continue only while agents remain, stopping at full arrival or the explicit tail limit. No case restarts to extend its tail.',
    passage: 'Unique directional centre crossings interpolated at actual obstacle-end x lines; ordered count requires preceding gates. targetBeyondPassed counts only agents whose assigned goal x is beyond that gate.',
    capacity: 'Retained slots may legitimately lie before a later gate. Compare targetBeyondPassed/targetBeyond, unavailableSlots and arrivals; do not require every retained goal to cross all three gates.',
    audit: auditEvery ? `Every ${auditEvery} ticks plus final: all candidate pairs from an independent index; published-step chords, not hidden substep paths. Finite and runtime walls checked every tick.` : 'Independent audit disabled; finite and runtime walls checked every tick.',
    stalled: 'Low-speed duration proxy, not proof of deadlock. Exemplars include the 12 longest-stalled active agents plus one active representative before each unfinished gate, with observed debug preferred velocity.' },
  records: [] as CaseResult[],
};
function save(): void { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
save();
function examples(simulation: Simulation, passed: Uint8Array): Example[] {
  const state = simulation.state;
  const ranked = Array.from({ length: state.count }, (_, i) => i).filter((i) => state.active[i] === 1)
    .sort((a, b) => state.stalledFor[b]! - state.stalledFor[a]! || a - b);
  const selected = ranked.slice(0, 12);
  for (let stage = 0; stage < GATES.length; stage += 1) {
    const representative = ranked.find((agent) => passed[agent] === stage);
    if (representative !== undefined && !selected.includes(representative)) selected.push(representative);
  }
  return selected.map((agent) => {
    const goal = simulation.goalForAgent(agent);
    return { agent, x: state.x[agent]!, y: state.y[agent]!, vx: state.vx[agent]!, vy: state.vy[agent]!,
      speed: Math.hypot(state.vx[agent]!, state.vy[agent]!), stalledSeconds: state.stalledFor[agent]!,
      desiredX: simulation.debugLayers.desiredVelocityX[agent]!, desiredY: simulation.debugLayers.desiredVelocityY[agent]!,
      desiredSpeed: Math.hypot(simulation.debugLayers.desiredVelocityX[agent]!, simulation.debugLayers.desiredVelocityY[agent]!),
      intentX: state.intentX[agent]!, intentY: state.intentY[agent]!, goalX: goal.x, goalY: goal.y,
      goalDistance: Math.hypot(goal.x - state.x[agent]!, goal.y - state.y[agent]!), highestGatePassed: passed[agent]!, radius: simulation.agentRadii[agent]! };
  });
}
for (const preset of presets) {
  const start = performance.now();
  const maximumTicks = tailPresets.has(preset) ? tailTicks : ticks;
  const record: CaseResult = { preset, status: 'completed', sourceHash, requested: agents, wallMs: 0, progress: [], firstAllArrivedTick: null, baseTicks: ticks, maximumTicks };
  report.records.push(record);
  try {
    const config = { ...DEFAULT_CONFIG, agentCount: agents, preset, seed };
    const scenario = getScenario('winding-corners');
    const sim = new CrowdSimulation(config, scenario);
    record.initMs = performance.now() - start; record.config = structuredClone(config); record.scenario = structuredClone(scenario);
    record.options = { ...sim.resolvedExperiment.options }; record.spawned = sim.state.count; record.unspawned = sim.unspawnedCount;
    const forward = GATES.map(() => new Uint8Array(sim.state.count));
    const reverse = GATES.map(() => new Uint8Array(sim.state.count));
    const passed = new Uint8Array(sim.state.count);
    const targetBeyond = GATES.map((gate) => Uint8Array.from({ length: sim.state.count }, (_, agent) => sim.goalForAgent(agent).x > gate.x ? 1 : 0));
    let finite = true; let maximumWalls = 0; let maximumInvalidStarts = 0; let invalidStartTicks = 0; let maximumStalled = 0;
    let maximumStalledDuration = 0;
    let audited = 0; let auditMs = 0; let maximumPairs = 0; let maximumPenetration = 0; let maximumSweptPenetration = 0;
    let auditedWalls = 0; let tunnelingPairs = 0; let auditChecks = 0;
    const capture = (): Progress => {
      const stageActive = [0, 0, 0, 0];
      let longestStalledSeconds = 0;
      for (let i = 0; i < sim.state.count; i += 1) if (sim.state.active[i]) {
        stageActive[passed[i]!] = stageActive[passed[i]!]! + 1;
        longestStalledSeconds = Math.max(longestStalledSeconds, sim.state.stalledFor[i]!);
      }
      return { tick: sim.stepCount, seconds: sim.stepCount * config.fixedDelta,
        active: sim.metrics.activeCount, arrived: sim.metrics.arrivedCount, moving: sim.experimentStats.movingCount,
        waiting: sim.experimentStats.waitingCount, stalled: sim.metrics.stalledCount,
        unavailableSlots: sim.experimentStats.unavailableSlots, invalidStaticStarts: sim.experimentStats.invalidStaticStarts,
        runtimeWalls: sim.metrics.wallOverlapCount, finite, longestStalledSeconds,
        gateProgress: GATES.map((gate, index) => ({ id: gate.id,
          forwardUnique: forward[index]!.reduce((sum, value) => sum + value, 0),
          reverseUnique: reverse[index]!.reduce((sum, value) => sum + value, 0),
          orderedUnique: passed.reduce((sum, value) => sum + (value > index ? 1 : 0), 0),
          targetBeyond: targetBeyond[index]!.reduce((sum, value) => sum + value, 0),
          targetBeyondPassed: targetBeyond[index]!.reduce((sum, value, agent) => sum + (value && forward[index]![agent] ? 1 : 0), 0),
        })), stageActive, exemplar: examples(sim, passed) };
    };
    record.progress.push(capture());
    process.stdout.write(`${JSON.stringify({ type: 'initialized', preset, spawned: sim.state.count, unavailableSlots: sim.experimentStats.unavailableSlots, sourceHash })}\n`);
    for (let tick = 1; tick <= maximumTicks; tick += 1) {
      sim.step();
      if (record.firstAllArrivedTick === null && sim.state.count > 0 && sim.metrics.arrivedCount === sim.state.count) record.firstAllArrivedTick = tick;
      const stopForCompletion = (stopOnComplete || tick >= ticks) && sim.state.count > 0 && sim.metrics.arrivedCount === sim.state.count;
      maximumWalls = Math.max(maximumWalls, sim.metrics.wallOverlapCount);
      maximumInvalidStarts = Math.max(maximumInvalidStarts, sim.experimentStats.invalidStaticStarts);
      if (sim.experimentStats.invalidStaticStarts) invalidStartTicks += 1;
      maximumStalled = Math.max(maximumStalled, sim.metrics.stalledCount);
      for (let agent = 0; agent < sim.state.count; agent += 1) {
        if (sim.state.active[agent]) maximumStalledDuration = Math.max(maximumStalledDuration, sim.state.stalledFor[agent]!);
        if (![sim.state.x[agent], sim.state.y[agent], sim.state.vx[agent], sim.state.vy[agent]].every(Number.isFinite)) finite = false;
        const x0 = sim.previousState.x[agent]!; const x1 = sim.state.x[agent]!;
        if (x0 === x1) continue;
        for (let gateIndex = 0; gateIndex < GATES.length; gateIndex += 1) {
          const gate = GATES[gateIndex]!;
          if (!((x0 < gate.x && x1 >= gate.x) || (x0 > gate.x && x1 <= gate.x))) continue;
          const time = (gate.x - x0) / (x1 - x0);
          const y = sim.previousState.y[agent]! + (sim.state.y[agent]! - sim.previousState.y[agent]!) * time;
          if (y <= gate.minY || y >= gate.maxY) continue;
          if (x1 > x0) { forward[gateIndex]![agent] = 1; if (passed[agent] === gateIndex) passed[agent] = gateIndex + 1; }
          else reverse[gateIndex]![agent] = 1;
        }
      }
      if (auditEvery && (tick % auditEvery === 0 || tick === ticks || tick === maximumTicks || stopForCompletion)) {
        const auditStart = performance.now(); const audit = auditGeometry(sim); auditMs += performance.now() - auditStart;
        audited += 1; maximumPairs = Math.max(maximumPairs, audit.pairs); maximumPenetration = Math.max(maximumPenetration, audit.maxPenetration);
        maximumSweptPenetration = Math.max(maximumSweptPenetration, audit.maxSweptPenetration);
        auditedWalls = Math.max(auditedWalls, audit.walls); tunnelingPairs += audit.tunnelingPairs; auditChecks += audit.checks;
      }
      if (tick % 300 === 0 || tick === ticks || tick === maximumTicks || stopForCompletion) {
        const progress = capture(); record.progress.push(progress); record.wallMs = performance.now() - start;
        record.final = progress; record.finalHash = sim.stateHash();
        record.maxima = { runtimeWalls: maximumWalls, invalidStaticStarts: maximumInvalidStarts, invalidStartTicks, stalled: maximumStalled, stalledDurationSeconds: maximumStalledDuration };
        record.audit = { samples: audited, everyTicks: auditEvery, milliseconds: auditMs, maxPairs: maximumPairs,
          maxPenetration: maximumPenetration, maxSweptPenetration: maximumSweptPenetration, maxWalls: auditedWalls, tunnelingPairs, candidateChecks: auditChecks,
          coverage: 'Sampled full candidate search; endpoint chord only.' };
        save();
        process.stdout.write(`${JSON.stringify({ type: 'progress', preset, ...progress, exemplar: progress.exemplar.slice(0, 2), wallMs: record.wallMs })}\n`);
      }
      if (stopForCompletion) break;
    }
  } catch (error) {
    record.status = 'error'; record.error = error instanceof Error ? error.stack : String(error); record.wallMs = performance.now() - start; save();
    process.stdout.write(`${JSON.stringify({ type: 'error', preset, error: record.error })}\n`);
  }
}
const changed = Object.entries(sourceFiles).filter(([file, sha]) => createHash('sha256').update(readFileSync(resolve(sourceRoot, file))).digest('hex') !== sha).map(([file]) => file);
Object.assign(report.source, { changedDuringRun: changed });
save();
process.stdout.write(`${JSON.stringify({ type: 'saved', output, sourceHash, changedDuringRun: changed, records: report.records.length })}\n`);
if (report.records.some((record) => record.status === 'error') || changed.length) process.exitCode = 1;
