import { AgentBuffer } from '../../core/agent-state';
import { projectCircleOutsideRectWithinBounds, segmentDistanceSquaredToRect, SweptCircleStaticIntegrator,
  type CircleProjection, type SweptCircleSlideOutput } from '../../core/obstacle-collision';
import type { Rect, SimulationConfig, Vec2 } from '../../core/types';
import { SpatialHash } from '../spatial-hash/spatial-hash';
import { discOrcaPlane, solveOrcaVelocity, sweptDiscTime, type VelocityPlane } from './orca';

export type LocalAvoidance = 'none' | 'separation' | 'boids' | 'orca' | 'sampling';
export interface LocalMotionInput {
  current: AgentBuffer;
  next: AgentBuffer;
  preferredX: Float64Array;
  preferredY: Float64Array;
  radii: Float64Array;
  config: SimulationConfig;
  obstacles: readonly Rect[];
  avoidance: LocalAvoidance;
  contactIterations: number;
  neighborLimit: number;
  timeHorizon: number;
  retainArrivals: boolean;
  immovable?: Uint8Array;
  groups?: Uint16Array;
  steeringBoids?: boolean;
  targets?: readonly Vec2[];
}
export interface LocalMotionMetrics {
  passes: { spatialMs: number; avoidanceMs: number; integrationMs: number; contactMs: number };
  candidateChecks: number;
  totalNeighbors: number;
  maxNeighbors: number;
  neighborTruncations: number;
  contactChecks: number;
  contactConstraints: number;
  contactActiveCount: number;
  overlapPairs: number;
  maxContactCorrection: number;
  recoveredAgents: number;
  staticContacts: number;
  invalidStaticStarts: number;
  substeps: number;
  orcaInfeasibleCount: number;
  ccdChecks: number;
  ccdStops: number;
  ccdPasses: number;
}

/** Shared route/slot clearance, including the circumscribed visibility polygon. */
export function retainedBodyDetourRadius(moverRadius: number, parkedRadius: number, agentGap: number): number {
  return (moverRadius + parkedRadius + agentGap + 0.02) / Math.cos(Math.PI / 16);
}

/**
 * Shared contact safety + interchangeable local velocity selection. Agent
 * avoidance uses nearest K within neighborRadius; contact/CCD queries never
 * truncate. Finite Jacobi iterations and CCD rounds are approximations and do
 * not promise overlap-free dense crowds. Arrivals may be retained immovable.
 */
export class LocalMotionSolver {
  private grid: SpatialHash | null = null;
  private bodies = new Uint8Array(0);
  private movable = new Uint8Array(0);
  private contacted = new Uint8Array(0);
  private velocityX = new Float64Array(0);
  private velocityY = new Float64Array(0);
  private startX = new Float64Array(0);
  private startY = new Float64Array(0);
  private deltaX = new Float64Array(0);
  private deltaY = new Float64Array(0);
  private correctionX = new Float64Array(0);
  private correctionY = new Float64Array(0);
  private correctionCount = new Uint32Array(0);
  private timeFractions = new Float64Array(0);
  private detourPaths: Vec2[][] = [];
  private detourCooldown = new Int32Array(0);
  private candidates = new Int32Array(0);
  private nearest: number[] = [];
  private nearestDistance: number[] = [];
  private readonly staticIntegrator = new SweptCircleStaticIntegrator();
  private readonly roundoffProjection: CircleProjection = { x: 0, y: 0, normalX: 0, normalY: 0 };
  private readonly slide: SweptCircleSlideOutput = {
    x: 0, y: 0, velocityX: 0, velocityY: 0, normalX: 0, normalY: 0,
    contactCount: 0, startedOverlapping: false, exhausted: false,
  };

  solve(input: LocalMotionInput): LocalMotionMetrics {
    const { current, next, config, radii } = input;
    if (current === next) throw new Error('LocalMotionSolver requires distinct current/next buffers.');
    const count = current.count;
    this.ensureCapacity(count, config);
    next.copyFrom(current);
    const metrics: LocalMotionMetrics = {
      passes: { spatialMs: 0, avoidanceMs: 0, integrationMs: 0, contactMs: 0 },
      candidateChecks: 0, totalNeighbors: 0, maxNeighbors: 0, neighborTruncations: 0, contactChecks: 0, contactConstraints: 0,
      contactActiveCount: 0, overlapPairs: 0, maxContactCorrection: 0, recoveredAgents: 0,
      staticContacts: 0, invalidStaticStarts: 0, substeps: 1, orcaInfeasibleCount: 0,
      ccdChecks: 0, ccdStops: 0, ccdPasses: 0,
    };
    this.contacted.fill(0);
    let maxRadius = 0;
    let minRadius = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      this.bodies[i] = current.active[i] === 1 || input.retainArrivals ? 1 : 0;
      this.movable[i] = current.active[i] === 1 && input.immovable?.[i] !== 1 ? 1 : 0;
      if (this.bodies[i]) {
        maxRadius = Math.max(maxRadius, radii[i]!);
        minRadius = Math.min(minRadius, Math.max(0.01, radii[i]!));
      }
    }
    const spatialStarted = performance.now();
    this.grid!.rebuild(current.x, current.y, this.bodies);
    metrics.passes.spatialMs += performance.now() - spatialStarted;
    const avoidanceStarted = performance.now();
    this.chooseVelocities(input, maxRadius, metrics);
    metrics.passes.avoidanceMs = performance.now() - avoidanceStarted;
    // Selected-speed travel is bounded before contact sharing; a normal
    // projection can increase one body's displacement. CCD uses updated travel.
    let maximumSpeed = 0;
    for (let i = 0; i < count; i++) maximumSpeed = Math.max(maximumSpeed, Math.hypot(this.velocityX[i]!, this.velocityY[i]!));
    metrics.substeps = Math.max(1, Math.ceil(maximumSpeed * config.fixedDelta / Math.max(0.01, minRadius * 0.5)));
    const dt = config.fixedDelta / metrics.substeps;
    for (let substep = 0; substep < metrics.substeps; substep++) {
      const integrationStarted = performance.now();
      this.startX.set(next.x);
      this.startY.set(next.y);
      for (let i = 0; i < count; i++) {
        this.deltaX[i] = 0;
        this.deltaY[i] = 0;
        if (!this.movable[i]) continue;
        this.integrateStatic(input, next.x[i]!, next.y[i]!, this.velocityX[i]!, this.velocityY[i]!, dt, i, metrics);
        this.deltaX[i] = this.slide.x - next.x[i]!;
        this.deltaY[i] = this.slide.y - next.y[i]!;
      }
      this.limitSweptDiscs(input, maxRadius, metrics);
      for (let i = 0; i < count; i++) {
        next.x[i] = this.startX[i]! + this.deltaX[i]!;
        next.y[i] = this.startY[i]! + this.deltaY[i]!;
      }
      metrics.passes.integrationMs += performance.now() - integrationStarted;
      const contactStarted = performance.now();
      for (let iteration = 0; iteration < input.contactIterations; iteration++) {
        this.solveContacts(input, maxRadius, metrics);
      }
      metrics.passes.contactMs += performance.now() - contactStarted;
    }
    for (let i = 0; i < count; i++) {
      next.vx[i] = (next.x[i]! - current.x[i]!) / config.fixedDelta;
      next.vy[i] = (next.y[i]! - current.y[i]!) / config.fixedDelta;
      if (this.contacted[i]) metrics.contactActiveCount++;
    }
    // Exact final physical overlap count, independent of the avoidance K cap.
    const auditStarted = performance.now();
    this.grid!.rebuild(next.x, next.y, this.bodies);
    for (let i = 0; i < count; i++) {
      if (!this.bodies[i]) continue;
      const n = this.grid!.queryCandidates(next.x[i]!, next.y[i]!, radii[i]! + maxRadius, this.candidates);
      for (let k = 0; k < n; k++) {
        const j = this.candidates[k]!;
        if (j <= i) continue;
        if (Math.hypot(next.x[j]! - next.x[i]!, next.y[j]! - next.y[i]!) < radii[i]! + radii[j]! - 1e-5) metrics.overlapPairs++;
      }
    }
    metrics.passes.contactMs += performance.now() - auditStarted;
    return metrics;
  }

  private chooseVelocities(input: LocalMotionInput, maxRadius: number, metrics: LocalMotionMetrics): void {
    const { current, config, radii } = input;
    const horizon = Math.max(config.fixedDelta, input.timeHorizon);
    const limit = Math.max(0, Math.floor(input.neighborLimit));
    for (let i = 0; i < current.count; i++) {
      this.velocityX[i] = 0;
      this.velocityY[i] = 0;
      if (!this.movable[i]) continue;
      let px = input.preferredX[i]!;
      let py = input.preferredY[i]!;
      this.nearest.length = 0;
      this.nearestDistance.length = 0;
      if (input.avoidance !== 'none' || input.steeringBoids) {
        const n = this.grid!.queryCandidates(current.x[i]!, current.y[i]!, config.neighborRadius + radii[i]! + maxRadius, this.candidates);
        let inRange = 0;
        for (let k = 0; k < n; k++) {
          const j = this.candidates[k]!;
          if (j === i) continue;
          metrics.candidateChecks++;
          const squared = (current.x[j]! - current.x[i]!) ** 2 + (current.y[j]! - current.y[i]!) ** 2;
          if (squared > (config.neighborRadius + radii[i]! + radii[j]!) ** 2) continue;
          inRange++;
          let slot = this.nearest.length;
          while (slot > 0 && (squared < this.nearestDistance[slot - 1]! || (squared === this.nearestDistance[slot - 1]! && j < this.nearest[slot - 1]!))) slot--;
          if (slot >= limit) continue;
          this.nearest.splice(slot, 0, j);
          this.nearestDistance.splice(slot, 0, squared);
          if (this.nearest.length > limit) { this.nearest.pop(); this.nearestDistance.pop(); }
        }
        metrics.neighborTruncations += Math.max(0, inRange - limit);
      }
      metrics.totalNeighbors += this.nearest.length;
      metrics.maxNeighbors = Math.max(metrics.maxNeighbors, this.nearest.length);
      if ((input.avoidance === 'orca' || input.avoidance === 'sampling') && input.retainArrivals) {
        const detour = this.retainedBodyPreference(input, i, px, py);
        px = detour.x; py = detour.y;
      }
      // Accelerate toward the actual route preference. Clamping toward the
      // blocked goal before redirecting a detour repeatedly brakes its progress.
      // ORCA remains holonomic: its projected result is never post-clamped.
      const change = Math.hypot(px - current.vx[i]!, py - current.vy[i]!);
      const allowed = config.maxAcceleration * config.fixedDelta;
      if (change > allowed && allowed > 0) {
        px = current.vx[i]! + (px - current.vx[i]!) * allowed / change;
        py = current.vy[i]! + (py - current.vy[i]!) * allowed / change;
      }
      if (input.avoidance === 'separation' || input.avoidance === 'boids' || input.steeringBoids) {
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, flock = 0;
        for (const j of this.nearest) {
          const dx = current.x[i]! - current.x[j]!;
          const dy = current.y[i]! - current.y[j]!;
          const distance = Math.hypot(dx, dy);
          const spacing = radii[i]! + radii[j]! + config.agentGap;
          const range = spacing * 2;
          if (distance < range) {
            const normal = pairNormal(i, j, dx, dy);
            const force = Math.max(0, 1 - distance / range) * config.maxSpeed * 0.8;
            sx += normal.x * force;
            sy += normal.y * force;
          }
          const sameGroup = !input.groups || input.groups[i] === input.groups[j];
          const sameDirection = input.preferredX[i]! * input.preferredX[j]! + input.preferredY[i]! * input.preferredY[j]! > 0;
          const clearance = Math.max(radii[i]!, radii[j]!) + config.wallMargin;
          const visible = sameGroup && sameDirection && this.movable[j]
            && !input.obstacles.some(obstacle => segmentDistanceSquaredToRect(
              current.x[i]!, current.y[i]!, current.x[j]!, current.y[j]!, obstacle,
            ) < clearance * clearance);
          if (visible) {
            ax += current.vx[j]!; ay += current.vy[j]!;
            cx += -dx; cy += -dy; flock++;
          }
        }
        px += sx; py += sy;
        if ((input.avoidance === 'boids' || input.steeringBoids) && flock > 0) {
          px += 0.15 * (ax / flock - current.vx[i]!) + 0.1 * cx / flock;
          py += 0.15 * (ay / flock - current.vy[i]!) + 0.1 * cy / flock;
        }
      }
      if (input.avoidance === 'orca') {
        const planes: VelocityPlane[] = [];
        for (const j of this.nearest) {
          const normal = pairNormal(i, j, current.x[i]! - current.x[j]!, current.y[i]! - current.y[j]!);
          planes.push(discOrcaPlane(
            current.x[j]! - current.x[i]!, current.y[j]! - current.y[i]!,
            current.vx[i]!, current.vy[i]!, this.movable[j] ? current.vx[j]! : 0, this.movable[j] ? current.vy[j]! : 0,
            radii[i]! + radii[j]! + config.agentGap + 1e-5, horizon, config.fixedDelta,
            this.movable[j] ? 0.5 : 1, normal.x, normal.y,
          ));
        }
        const solved = solveOrcaVelocity(planes, config.maxSpeed, px, py);
        px = solved.x; py = solved.y;
        if (!solved.feasible) metrics.orcaInfeasibleCount++;
      } else if (input.avoidance === 'sampling') {
        const picked = this.sampleVelocity(input, i, px, py, horizon);
        px = picked.x; py = picked.y;
      }
      const speed = Math.hypot(px, py);
      const scale = speed > config.maxSpeed ? config.maxSpeed / speed : 1;
      this.velocityX[i] = px * scale;
      this.velocityY[i] = py * scale;
    }
  }

  /** Bounded cached route around parked discs; ORCA still owns feasible velocity. */
  private retainedBodyPreference(input: LocalMotionInput, i: number, px: number, py: number): { x: number; y: number } {
    const { current, config, radii } = input;
    const speed = Math.hypot(px, py);
    let path = this.detourPaths[i]!;
    if (this.detourCooldown[i]! > 0) this.detourCooldown[i]!--;
    if (speed < 1e-9 || (!path.length && (current.stalledFor[i]! < config.stallSeconds || this.detourCooldown[i]! > 0))) return { x: px, y: py };
    const x = current.x[i]!, y = current.y[i]!;
    const target = input.targets?.[i];
    if (!target) return { x: px, y: py };
    const parked = this.nearest.filter(j => current.active[j] === 0);
    if (!parked.length) { path.length = 0; return { x: px, y: py }; }
    if (!path.length && !parked.some(j => Number.isFinite(sweptDiscTime(
      x - current.x[j]!, y - current.y[j]!, target.x - x, target.y - y,
      radii[i]! + radii[j]! + config.agentGap)))) return { x: px, y: py };
    const clearance = radii[i]! + config.wallMargin;
    const clear = (ax: number, ay: number, bx: number, by: number): boolean => {
      if (bx < clearance || by < clearance || bx > config.width - clearance || by > config.height - clearance) return false;
      if (input.obstacles.some(obstacle => segmentDistanceSquaredToRect(ax, ay, bx, by, obstacle) < clearance * clearance - 1e-8)) return false;
      for (const j of this.nearest) {
        if (this.movable[j]) continue;
        if (Number.isFinite(sweptDiscTime(ax - current.x[j]!, ay - current.y[j]!,
          bx - ax, by - ay, radii[i]! + radii[j]! + config.agentGap))) return false;
      }
      return true;
    };
    if (clear(x, y, target.x, target.y)) { path.length = 0; return { x: px, y: py }; }
    if (path.length && !clear(x, y, path[0]!.x, path[0]!.y)) path.length = 0;
    if (path.length > 1 && Math.hypot(path[0]!.x - x, path[0]!.y - y) < Math.max(0.05, radii[i]! * 0.1)
      && !clear(x, y, path[1]!.x, path[1]!.y)) path.length = 0;
    if (!path.length) {
      if (this.detourCooldown[i]! > 0) return { x: px, y: py };
      this.detourCooldown[i] = Math.max(1, Math.round(1 / config.fixedDelta));
      const nodes: Vec2[] = [{ x, y }, target];
      // Circumscribed 16-gons retain a narrow but real clearance between parked
      // discs. The visibility graph is bounded by the avoidance neighbor limit.
      // It runs only for stalled bodies and caches its route across later ticks.
      for (const j of parked) {
        const radius = retainedBodyDetourRadius(radii[i]!, radii[j]!, config.agentGap);
        for (let side = 0; side < 16; side++) {
          const angle = side * Math.PI / 8;
          const point = { x: current.x[j]! + Math.cos(angle) * radius, y: current.y[j]! + Math.sin(angle) * radius };
          if (clear(point.x, point.y, point.x, point.y)
            && this.nearest.every(k => this.movable[k] || Math.hypot(point.x - current.x[k]!, point.y - current.y[k]!) >= radii[i]! + radii[k]! + config.agentGap)) nodes.push(point);
        }
      }
      const distances = new Float64Array(nodes.length).fill(Infinity);
      const previous = new Int32Array(nodes.length).fill(-1);
      const visited = new Uint8Array(nodes.length);
      distances[0] = 0;
      for (let iteration = 0; iteration < nodes.length; iteration++) {
        let node = -1, distance = Infinity;
        for (let n = 0; n < nodes.length; n++) if (!visited[n] && distances[n]! < distance) { node = n; distance = distances[n]!; }
        if (node < 0 || node === 1) break;
        visited[node] = 1;
        const from = nodes[node]!;
        for (let n = 1; n < nodes.length; n++) {
          if (visited[n] || n === node) continue;
          const to = nodes[n]!;
          const nextDistance = distance + Math.hypot(to.x - from.x, to.y - from.y);
          if (nextDistance >= distances[n]! || !clear(from.x, from.y, to.x, to.y)) continue;
          distances[n] = nextDistance; previous[n] = node;
        }
      }
      if (previous[1]! < 0) return { x: px, y: py };
      path = [];
      for (let node = 1; node > 0; node = previous[node]!) path.push(nodes[node]!);
      path.reverse(); this.detourPaths[i] = path;
    }
    // Keep a waypoint until the following segment is itself clear; proximity
    // alone cannot authorize cutting a parked disc's corner.
    while (path.length > 1 && clear(x, y, path[1]!.x, path[1]!.y)) path.shift();
    const waypoint = path[0]!;
    const dx = waypoint.x - x, dy = waypoint.y - y, length = Math.hypot(dx, dy);
    return length > 1e-9 ? { x: dx / length * speed, y: dy / length * speed } : { x: px, y: py };
  }
  private sampleVelocity(input: LocalMotionInput, i: number, px: number, py: number, horizon: number): { x: number; y: number } {
    const { config, current, radii } = input;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestX = 0, bestY = 0;
    const preferenceLength = Math.hypot(px, py);
    const scale = preferenceLength > config.maxSpeed ? config.maxSpeed / preferenceLength : 1;
    const angle = Math.atan2(py, px);
    // 1 stop + exact preference + 3 rings × 16 directions, deterministic order.
    for (let sample = 0; sample < 50; sample++) {
      let vx = 0, vy = 0;
      if (sample === 1) { vx = px * scale; vy = py * scale; }
      else if (sample >= 2) {
        const phase = angle + ((sample - 2) % 16) * Math.PI / 8;
        const speed = config.maxSpeed * (Math.floor((sample - 2) / 16) + 1) / 3;
        vx = Math.cos(phase) * speed; vy = Math.sin(phase) * speed;
      }
      let cost = ((vx - px) ** 2 + (vy - py) ** 2) / Math.max(1, config.maxSpeed ** 2);
      for (const j of this.nearest) {
        const time = sweptDiscTime(current.x[i]! - current.x[j]!, current.y[i]! - current.y[j]!,
          (vx - (this.movable[j] ? current.vx[j]! : 0)) * horizon,
          (vy - (this.movable[j] ? current.vy[j]! : 0)) * horizon, radii[i]! + radii[j]! + config.agentGap);
        if (Number.isFinite(time)) cost += 4 / (0.1 + time);
      }
      if (cost < bestCost) { bestCost = cost; bestX = vx; bestY = vy; }
    }
    return { x: bestX, y: bestY };
  }

  private limitSweptDiscs(input: LocalMotionInput, maxRadius: number, metrics: LocalMotionMetrics): void {
    const { current, radii } = input;
    this.grid!.rebuild(this.startX, this.startY, this.bodies);
    // At touching contacts, remove only the inward relative displacement. A
    // time-of-impact of zero must not erase both agents' shared tangential
    // motion. Normal projection is bounded and every changed segment is swept
    // against walls again; the usual CCD rounds below guard remaining conflicts.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let i = 0; i < current.count; i++) {
        if (!this.bodies[i]) continue;
        const n = this.grid!.queryCandidates(this.startX[i]!, this.startY[i]!, radii[i]! + maxRadius + 1e-5, this.candidates);
        for (let k = 0; k < n; k++) {
          const j = this.candidates[k]!;
          if (j <= i || (!this.movable[i] && !this.movable[j])) continue;
          metrics.ccdChecks++;
          const dx = this.startX[i]! - this.startX[j]!;
          const dy = this.startY[i]! - this.startY[j]!;
          const distance = Math.hypot(dx, dy);
          const gap = distance - radii[i]! - radii[j]!;
          if (gap > 1e-5 || distance < 1e-9) continue;
          const nx = dx / distance, ny = dy / distance;
          const inward = nx * (this.deltaX[i]! - this.deltaX[j]!) + ny * (this.deltaY[i]! - this.deltaY[j]!);
          const correction = -Math.max(0, gap) - inward;
          if (correction <= 1e-10) continue;
          const share = correction / (this.movable[i]! + this.movable[j]!);
          for (const body of [i, j]) {
            if (!this.movable[body]) continue;
            const sign = body === i ? 1 : -1;
            this.integrateStatic(input, this.startX[body]!, this.startY[body]!,
              this.deltaX[body]! + nx * share * sign, this.deltaY[body]! + ny * share * sign, 1, body, metrics);
            this.deltaX[body] = this.slide.x - this.startX[body]!;
            this.deltaY[body] = this.slide.y - this.startY[body]!;
          }
          this.contacted[i] = 1; this.contacted[j] = 1;
          metrics.ccdStops++;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Revisit after shortening trajectories, since a stopped leader can cause a
    // new follower conflict. Three rounds are a conservative practical bound,
    // not a proof for arbitrary contact chains; PBD addresses final residuals.
    for (let pass = 0; pass < 3; pass++) {
      let maximumTravel = 0;
      for (let i = 0; i < current.count; i++) maximumTravel = Math.max(maximumTravel, Math.hypot(this.deltaX[i]!, this.deltaY[i]!));
      this.timeFractions.fill(1);
      let collisions = 0;
      for (let i = 0; i < current.count; i++) {
        if (!this.bodies[i]) continue;
        const range = radii[i]! + maxRadius + Math.hypot(this.deltaX[i]!, this.deltaY[i]!) + maximumTravel;
        const n = this.grid!.queryCandidates(this.startX[i]!, this.startY[i]!, range, this.candidates);
        for (let k = 0; k < n; k++) {
          const j = this.candidates[k]!;
          if (j <= i || (!this.movable[i] && !this.movable[j])) continue;
          metrics.ccdChecks++;
          const time = sweptDiscTime(this.startX[i]! - this.startX[j]!, this.startY[i]! - this.startY[j]!,
            this.deltaX[i]! - this.deltaX[j]!, this.deltaY[i]! - this.deltaY[j]!, radii[i]! + radii[j]!);
          if (!Number.isFinite(time)) continue;
          const safe = Math.max(0, time - 1e-7);
          this.timeFractions[i] = Math.min(this.timeFractions[i]!, safe);
          this.timeFractions[j] = Math.min(this.timeFractions[j]!, safe);
          this.contacted[i] = 1; this.contacted[j] = 1;
          collisions++;
        }
      }
      metrics.ccdPasses++;
      if (!collisions) break;
      metrics.ccdStops += collisions;
      for (let i = 0; i < current.count; i++) {
        if (!this.movable[i] || this.timeFractions[i] === 1) continue;
        // A static slide may have bent around a rounded corner. Shortening its
        // endpoint chord can cut through that corner, so sweep the shortened
        // displacement again instead of interpolating directly along the chord.
        this.integrateStatic(input, this.startX[i]!, this.startY[i]!,
          this.deltaX[i]! * this.timeFractions[i]!, this.deltaY[i]! * this.timeFractions[i]!, 1, i, metrics);
        this.deltaX[i] = this.slide.x - this.startX[i]!;
        this.deltaY[i] = this.slide.y - this.startY[i]!;
      }
    }
  }

  private solveContacts(input: LocalMotionInput, maxRadius: number, metrics: LocalMotionMetrics): void {
    const { next, radii, current, config } = input;
    // Rebuild every Jacobi pass from its own read snapshot. No stale pair list,
    // no per-cell capacity, and no neighborLimit truncation in contact solving.
    this.grid!.rebuild(next.x, next.y, this.bodies);
    this.correctionX.fill(0); this.correctionY.fill(0); this.correctionCount.fill(0);
    for (let i = 0; i < current.count; i++) {
      if (!this.bodies[i]) continue;
      const n = this.grid!.queryCandidates(next.x[i]!, next.y[i]!, radii[i]! + maxRadius, this.candidates);
      for (let k = 0; k < n; k++) {
        const j = this.candidates[k]!;
        if (j <= i || (!this.movable[i] && !this.movable[j])) continue;
        metrics.contactChecks++;
        const dx = next.x[i]! - next.x[j]!;
        const dy = next.y[i]! - next.y[j]!;
        const distance = Math.hypot(dx, dy);
        const penetration = radii[i]! + radii[j]! - distance;
        if (penetration <= 1e-7) continue;
        metrics.contactConstraints++;
        this.contacted[i] = 1; this.contacted[j] = 1;
        const normal = pairNormal(i, j, dx, dy);
        const weight = this.movable[i]! + this.movable[j]!;
        const correction = penetration / weight;
        if (this.movable[i]) {
          this.correctionX[i] = this.correctionX[i]! + normal.x * correction;
          this.correctionY[i] = this.correctionY[i]! + normal.y * correction;
          this.correctionCount[i] = this.correctionCount[i]! + 1;
        }
        if (this.movable[j]) {
          this.correctionX[j] = this.correctionX[j]! - normal.x * correction;
          this.correctionY[j] = this.correctionY[j]! - normal.y * correction;
          this.correctionCount[j] = this.correctionCount[j]! + 1;
        }
      }
    }
    for (let i = 0; i < current.count; i++) {
      if (!this.correctionCount[i]) continue;
      // Contact-count averaging prevents Jacobi sum overshoot in dense cells.
      let dx = this.correctionX[i]! / this.correctionCount[i]!;
      let dy = this.correctionY[i]! / this.correctionCount[i]!;
      const distance = Math.hypot(dx, dy);
      const limit = Math.min(radii[i]! * 0.5, Math.max(0.01, config.maximumContactCorrection));
      if (distance > limit) { dx *= limit / distance; dy *= limit / distance; }
      this.integrateStatic(input, next.x[i]!, next.y[i]!, dx, dy, 1, i, metrics);
      metrics.maxContactCorrection = Math.max(metrics.maxContactCorrection, Math.hypot(this.slide.x - next.x[i]!, this.slide.y - next.y[i]!));
      next.x[i] = this.slide.x;
      next.y[i] = this.slide.y;
    }
  }

  private integrateStatic(input: LocalMotionInput, x: number, y: number, vx: number, vy: number, dt: number, i: number, metrics: LocalMotionMetrics): void {
    const radius = input.radii[i]! + input.config.wallMargin;
    // Repair the tiny spatial shell before invoking the sweep. The underlying
    // primitive accepts that shell as a valid start; for a slow inward move its
    // slightly negative normalized hit time may nevertheless exceed its time
    // tolerance and be rejected. Waiting for startedOverlapping is too late.
    const tolerance = 1e-5;
    let repairedX = Math.max(radius, Math.min(input.config.width - radius, x));
    let repairedY = Math.max(radius, Math.min(input.config.height - radius, y));
    for (const obstacle of input.obstacles) {
      if (projectCircleOutsideRectWithinBounds(repairedX, repairedY, radius + 1e-9,
        obstacle, input.config.width, input.config.height, this.roundoffProjection)) {
        repairedX = this.roundoffProjection.x;
        repairedY = this.roundoffProjection.y;
      }
    }
    const repairDistance = Math.hypot(repairedX - x, repairedY - y);
    if (repairDistance > 0 && repairDistance <= tolerance) {
      x = repairedX; y = repairedY;
      metrics.staticContacts++;
    }
    this.staticIntegrator.integrate(x, y, vx, vy, dt, radius,
      input.config.width, input.config.height, input.obstacles, 4, this.slide);
    metrics.staticContacts += this.slide.contactCount;
    if (this.slide.startedOverlapping) metrics.invalidStaticStarts++;
  }

  private ensureCapacity(count: number, config: SimulationConfig): void {
    if (this.bodies.length !== count) {
      this.bodies = new Uint8Array(count); this.movable = new Uint8Array(count); this.contacted = new Uint8Array(count);
      this.velocityX = new Float64Array(count); this.velocityY = new Float64Array(count);
      this.startX = new Float64Array(count); this.startY = new Float64Array(count);
      this.deltaX = new Float64Array(count); this.deltaY = new Float64Array(count);
      this.correctionX = new Float64Array(count); this.correctionY = new Float64Array(count);
      this.correctionCount = new Uint32Array(count); this.timeFractions = new Float64Array(count);
      this.detourPaths = Array.from({ length: count }, () => []); this.detourCooldown = new Int32Array(count);
      this.candidates = new Int32Array(count);
      this.grid = null;
    }
    const cellSize = Math.max(1, config.contactCellSize);
    if (!this.grid || this.grid.columns !== Math.ceil(config.width / cellSize)
      || this.grid.rows !== Math.ceil(config.height / cellSize) || this.grid.cellSize !== cellSize) {
      this.grid = new SpatialHash(config.width, config.height, cellSize, count);
    }
  }
}

/** Antisymmetric ID-derived normal for fully collapsed discs. */
function pairNormal(i: number, j: number, x: number, y: number): { x: number; y: number } {
  const distance = Math.hypot(x, y);
  if (distance > 1e-9) return { x: x / distance, y: y / distance };
  const low = Math.min(i, j), high = Math.max(i, j);
  const angle = ((Math.imul(low + 1, 73856093) ^ Math.imul(high + 1, 19349663)) >>> 0) / 4294967296 * Math.PI * 2;
  const sign = i < j ? 1 : -1;
  return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };
}


