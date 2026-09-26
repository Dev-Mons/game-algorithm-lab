import { SpatialHash } from '../algorithms/spatial-hash/spatial-hash';
import type { AgentBuffer } from './agent-state';

/** px, seconds, unit inertial mass (independent of visual radius/area). */
export const EXTERNAL_PROFILE = Object.freeze({
  name: 'external-v2', maximumSpeed: 600, maximumDeltaVelocity: 600,
  maximumAcceleration: 1200, maximumProxySpeed: 300, maximumProxies: 8,
  maximumInputs: 32, maximumRecords: 4096, maximumSubsteps: 16,
  candidates: 64, iterations: 4, drag: 1.5, control: .25,
  maximumContactAttempts: 5, maximumProjectionAttempts: 512, maximumProjectionRounds: 4,
  velocityIterations: 16, positionIterations: 128, maximumPairFactor: 128,
  positionTolerance: .45, velocityWorksetHalo: 1,
  recoverySeconds: 4, compressionTolerance: .5,
});
export type ExternalTarget = { agent: number } | { x: number; y: number; radius: number; flow?: number };
type Stamp = { id: string; tick: number; generation: number };
export type ExternalInput = Stamp & (
  | { kind: 'impulse'; target: ExternalTarget; dvx: number; dvy: number }
  | { kind: 'acceleration'; target: ExternalTarget; ax: number; ay: number; endTick: number }
  | { kind: 'blast'; x: number; y: number; radius: number; speed: number; expansionSpeed?: number }
  | { kind: 'proxy'; body: string; x: number; y: number; toX: number; toY: number; radius: number }
  | { kind: 'remove-proxy'; body: string }
  | { kind: 'cancel'; input: string }
);
export interface MovingCircle { body: string; x: number; y: number; toX: number; toY: number; radius: number; }
type Effect = { input: ExternalInput; hit?: Uint8Array };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)]));
  return value;
}

export class ExternalInfluences {
  /** Kernel choice changes computation only; it is not a physical input or hash component. */
  backend: 'auto' | 'js' = 'auto';
  generation = 0;
  readonly affected: Uint8Array;
  readonly direct: Uint8Array;
  readonly proxies: MovingCircle[] = [];
  readonly settings: { drag: number; control: number } = { drag: EXTERNAL_PROFILE.drag, control: EXTERNAL_PROFILE.control };
  readonly stats = { inputs: 0, affected: 0, queryCells: 0, candidates: 0, substeps: 0,
    planningMs: 0, planningCandidates: 0, planningFallbacks: 0, singleStepVerified: 0, singleStepFallbacks: 0,
    substepRetries: 0, rejectedTrialCompressions: 0, rejectedTrialBudgetExhaustions: 0, rejectedTrialPenetration: 0,
    contactAttempts: 0, attemptedSubsteps: 0,
    colorBuilds: 0, colorBuildMs: 0, maximumColors: 0, colorFallbacks: 0,
    workerThreads: 0,parallelPasses: 0,parallelPhaseMs: 0,workerFailures: 0,workerDiscardedMs: 0,
    pairOwnershipSkips: 0, pairCapacityRetries: 0,
    contactAffected: 0,
    contactCellUpperBound: 0, proxyCells: 0, proxyCandidates: 0, staticSweeps: 0, staticExhaustions: 0,
    rebuilds: 0, pairs: 0, saturatedQueries: 0, candidateFallbacks: 0, velocityPasses: 0, stabilizationPasses: 0, unresolvedCompression: 0, speedClamps: 0, crushed: 0,
    velocityPairVisits: 0, velocityWorksets: 0, velocityFallbacks: 0,
    positionBudgetExhaustions: 0, maxExhaustedPenetration: 0,
    projectionPasses: 0, projectionAttempts: 0, projectionGroups: 0, projectedBodies: 0, projectionCandidates: 0,
    warmRejections: 0, warmDamping: 0,
    energyDampedContacts: 0,
    wasm: 0, kernelBytes: 0, retainedBytes: 0, queryMs: 0, predictionMs: 0, contactMs: 0, staticMs: 0 };
  private readonly records = new Map<string, ExternalInput>();
  private pending: ExternalInput[] = [];
  private effects: Effect[] = [];
  private grid: SpatialHash | null = null;
  private running = false;
  constructor(private readonly capacity: number, private readonly width: number, private readonly height: number) {
    this.affected = new Uint8Array(capacity); this.direct = new Uint8Array(capacity);
  }
  get active(): boolean { return this.running || this.proxies.length > 0; }
  reset(): void {
    this.generation++; this.affected.fill(0); this.direct.fill(0);
    this.records.clear(); this.pending = []; this.effects = []; this.proxies.length = 0; this.running = false;
    for (const key of Object.keys(this.stats) as (keyof typeof this.stats)[]) this.stats[key] = 0;
  }
  /** Returns false only for an identical retransmission. Invalid/conflicting inputs throw atomically. */
  enqueue(input: ExternalInput, tick: number, count: number, dt: number): boolean {
    if (input.generation !== this.generation) throw new RangeError('Stale external generation.');
    const copy = canonical(input) as ExternalInput;
    // Validate before JSON can turn non-finite values into null.
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const bounded = (v: number, max: number) => finite(v) && Math.abs(v) <= max;
    if (typeof input.id !== 'string' || !input.id || input.id.length > 128 || !Number.isSafeInteger(input.tick) || input.tick < 0)
      throw new RangeError('Invalid external ID or tick.');
    const prior = this.records.get(input.id);
    if (prior) {
      if (JSON.stringify(prior) === JSON.stringify(copy)) return false;
      throw new RangeError('Conflicting external ID.');
    }
    if (input.tick < tick || input.tick > tick + 36000 || this.records.size >= EXTERNAL_PROFILE.maximumRecords
      || this.pending.length + this.effects.length >= EXTERNAL_PROFILE.maximumInputs) throw new RangeError('External input budget or tick exceeded.');
    if (!finite(dt) || dt <= 0 || dt > 1/30) throw new RangeError('External profile requires 0 < dt <= 1/30.');
    const point = (x: number, y: number) => bounded(x, this.width * 2) && bounded(y, this.height * 2);
    if ((input.kind === 'impulse' || input.kind === 'acceleration') && (!input.target || typeof input.target !== 'object')) throw new RangeError('Missing target.');
    if ('target' in input) {
      const t = input.target;
      if ('agent' in t) {
        if (!Number.isInteger(t.agent) || t.agent < 0 || t.agent >= count) throw new RangeError('Invalid target agent.');
      } else if (!point(t.x,t.y) || !finite(t.radius) || t.radius <= 0 || t.radius > Math.hypot(this.width,this.height)
        || (t.flow !== undefined && (!Number.isInteger(t.flow) || t.flow < 0 || t.flow > 65535))) throw new RangeError('Invalid target region.');
    }
    switch (input.kind) {
      case 'impulse':
        if (!finite(input.dvx) || !finite(input.dvy) || Math.hypot(input.dvx,input.dvy) > EXTERNAL_PROFILE.maximumDeltaVelocity) throw new RangeError('Impulse exceeds profile.');
        break;
      case 'acceleration':
        if (!finite(input.ax) || !finite(input.ay) || Math.hypot(input.ax,input.ay) > EXTERNAL_PROFILE.maximumAcceleration
          || !Number.isSafeInteger(input.endTick) || input.endTick <= input.tick || input.endTick > input.tick + 36000) throw new RangeError('Invalid sustained influence.');
        break;
      case 'blast':
        if (!point(input.x,input.y) || !finite(input.radius) || input.radius <= 0 || input.radius > Math.hypot(this.width,this.height)
          || !bounded(input.speed,600) || input.speed < 0 || (input.expansionSpeed !== undefined && (!finite(input.expansionSpeed) || input.expansionSpeed < input.radius / 60))) throw new RangeError('Invalid blast.');
        break;
      case 'proxy':
        if (!input.body || input.body.length > 128 || !point(input.x,input.y) || !point(input.toX,input.toY)
          || !finite(input.radius) || input.radius < 1.5 || input.radius > 64
          || Math.hypot(input.toX-input.x,input.toY-input.y) / dt > EXTERNAL_PROFILE.maximumProxySpeed + 1e-8) throw new RangeError('Invalid proxy motion.');
        break;
      case 'remove-proxy': if (!input.body) throw new RangeError('Invalid body ID.'); break;
      case 'cancel': if (!input.input) throw new RangeError('Invalid cancellation.'); break;
      default: throw new RangeError('Unknown external input.');
    }
    if (input.kind === 'proxy' || input.kind === 'remove-proxy') {
      // Validate the whole scheduled body timeline before accepting any mutation.
      const bodies = new Map(this.proxies.map(p => [p.body,{x:p.toX,y:p.toY,radius:p.radius}]));
      const scheduled = [...this.pending,copy].sort((a,b) => a.tick-b.tick || (a.id < b.id ? -1 : 1));
      const poses = new Set<string>();
      for (const e of scheduled) {
        if (e.kind === 'remove-proxy') bodies.delete(e.body);
        if (e.kind !== 'proxy') continue;
        const key=JSON.stringify([e.tick,e.body]);
        if(poses.has(key)) throw new RangeError('Only one pose per body per tick is allowed.');
        poses.add(key);
        const priorBody = bodies.get(e.body);
        if (priorBody && (Math.hypot(priorBody.x-e.x,priorBody.y-e.y) > 1e-6 || priorBody.radius !== e.radius)) throw new RangeError('Proxy discontinuity: remove before teleport/resize.');
        bodies.set(e.body,{x:e.toX,y:e.toY,radius:e.radius});
        if (bodies.size > EXTERNAL_PROFILE.maximumProxies) throw new RangeError('Proxy capacity exceeded.');
      }
    }
    if (input.kind === 'cancel') {
      const target = this.records.get(input.input);
      if (!target || target.kind === 'cancel') throw new RangeError('Cancellation requires a known influence ID.');
      if (target.kind === 'proxy' || target.kind === 'remove-proxy') throw new RangeError('Use remove-proxy for body lifetime.');
    }
    this.records.set(input.id,copy); this.pending.push(copy);
    this.pending.sort((a,b) => a.tick-b.tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return true;
  }
  record(): ExternalInput[] { return structuredClone([...this.records.values()].sort((a,b) => a.tick-b.tick || (a.id < b.id ? -1 : 1))); }
  /** Hash material includes consumed IDs, future inputs, wave hit masks and contact state. */
  fingerprint(): string {
    if (!this.records.size && !this.active) return '';
    return JSON.stringify([this.generation,this.record(),this.pending,this.effects.map(e => [e.input,e.hit ? Array.from(e.hit) : null]),this.proxies,Array.from(this.affected),this.settings]);
  }
  begin(state: AgentBuffer, flows: Uint16Array, tick: number, dt: number): void {
    for (const key of Object.keys(this.stats) as (keyof typeof this.stats)[]) this.stats[key] = 0;
    this.direct.fill(0);
    const started = performance.now();
    // A proxy stays at its last endpoint unless this tick supplies new prescribed motion.
    for (const p of this.proxies) { p.x = p.toX; p.y = p.toY; }
    while (this.pending.length && this.pending[0]!.tick <= tick) {
      const input = this.pending.shift()!; this.stats.inputs++;
      if (input.kind === 'cancel') {
        this.effects = this.effects.filter(e => e.input.id !== input.input);
        this.pending = this.pending.filter(e => e.id !== input.input);
      } else if (input.kind === 'remove-proxy') {
        const i = this.proxies.findIndex(p => p.body === input.body); if (i >= 0) this.proxies.splice(i,1);
      } else if (input.kind === 'proxy') {
        const p = this.proxies.find(p => p.body === input.body);
        if (p && (Math.hypot(p.x-input.x,p.y-input.y) > 1e-6 || p.radius !== input.radius)) throw new RangeError('Proxy discontinuity: remove before teleport/resize.');
        if (!p && this.proxies.length >= EXTERNAL_PROFILE.maximumProxies) throw new RangeError('Proxy capacity exceeded.');
        if (p) Object.assign(p,input); else this.proxies.push({ ...input });
        this.proxies.sort((a,b) => a.body < b.body ? -1 : 1);
      } else this.effects.push({ input, ...(input.kind === 'blast' && input.expansionSpeed ? { hit: new Uint8Array(state.count) } : {}) });
    }
    if (this.effects.some(e => e.input.kind === 'blast' || ('target' in e.input && !('agent' in e.input.target)))) {
      this.grid ??= new SpatialHash(this.width,this.height,32,this.capacity);
      this.grid.rebuild(state.x,state.y,state.active); this.stats.rebuilds++;
    }
    for (const effect of this.effects) {
      const e = effect.input;
      if (e.kind === 'acceleration' && tick >= e.endTick) continue;
      if (e.kind === 'blast') {
        const radius = Math.min(e.radius, e.expansionSpeed ? (tick-e.tick+1)*dt*e.expansionSpeed : e.radius);
        this.visitRegion(state,{ x:e.x,y:e.y,radius },flows,a => {
          if (effect.hit?.[a]) return;
          if (effect.hit) effect.hit[a] = 1;
          const dx = state.x[a]!-e.x, dy = state.y[a]!-e.y, d = Math.hypot(dx,dy);
          const angle = ((Math.imul(a+1,2654435761) >>> 0) / 4294967296) * Math.PI*2;
          const magnitude = e.speed * Math.max(0,1-d/e.radius);
          this.kick(state,a,(d > 1e-9 ? dx/d : Math.cos(angle))*magnitude,(d > 1e-9 ? dy/d : Math.sin(angle))*magnitude);
        });
      } else if (e.kind === 'impulse' || e.kind === 'acceleration') {
        const x = e.kind === 'impulse' ? e.dvx : e.ax*dt, y = e.kind === 'impulse' ? e.dvy : e.ay*dt;
        if ('agent' in e.target) this.kick(state,e.target.agent,x,y);
        else this.visitRegion(state,e.target,flows,a => this.kick(state,a,x,y));
      }
    }
    this.effects = this.effects.filter(({input:e}) => e.kind === 'acceleration' ? tick+1 < e.endTick
      : e.kind === 'blast' && !!e.expansionSpeed && (tick-e.tick+1)*dt*e.expansionSpeed < e.radius);
    this.running = this.affected.some(v => v === 1);
    this.stats.queryMs = performance.now()-started;
  }
  private kick(state: AgentBuffer, a: number, x: number, y: number): void {
    if (state.active[a] !== 1 || (x === 0 && y === 0)) return;
    state.vx[a] = state.vx[a]!+x; state.vy[a] = state.vy[a]!+y;
    this.affected[a] = 1;
    if (!this.direct[a]) { this.direct[a] = 1; this.stats.affected++; }
  }
  private visitRegion(state: AgentBuffer, region: {x:number;y:number;radius:number;flow?:number}, flows: Uint16Array, visit: (a:number) => void): void {
    const grid = this.grid!;
    const left = Math.max(0,Math.floor((region.x-region.radius)/32)), right = Math.min(grid.columns-1,Math.floor((region.x+region.radius)/32));
    const top = Math.max(0,Math.floor((region.y-region.radius)/32)), bottom = Math.min(grid.rows-1,Math.floor((region.y+region.radius)/32));
    this.stats.queryCells += Math.max(0,right-left+1)*Math.max(0,bottom-top+1);
    grid.forEachCandidate(region.x,region.y,region.radius,a => {
      this.stats.candidates++;
      if (region.flow !== undefined && flows[a] !== region.flow) return;
      if ((state.x[a]!-region.x)**2+(state.y[a]!-region.y)**2 <= region.radius**2) visit(a);
    });
  }
  finish(state: AgentBuffer): void {
    this.running = false;
    for (let a=0; a<state.count; a++) {
      if (state.active[a] !== 1) this.affected[a] = 0;
      if (this.affected[a]) this.running = true;
    }
  }
}
