import { AgentBuffer } from '../../core/agent-state';
import { projectCircleOutsideRectWithinBounds, segmentDistanceSquaredToRect, SweptCircleStaticIntegrator,
  type CircleProjection, type SweptCircleSlideOutput } from '../../core/obstacle-collision';
import type { Rect, SimulationConfig } from '../../core/types';
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
    // Relative travel per substep <= minimum diameter / 2 under selected speed.
    // The swept-disc limiter additionally handles fast crossing and tangency.
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
      // Acceleration shapes the preference before projection; the ORCA result
      // is never post-clamped. This holonomic variant has no acceleration guarantee.
      const change = Math.hypot(px - current.vx[i]!, py - current.vy[i]!);
      const allowed = config.maxAcceleration * config.fixedDelta;
      if (change > allowed && allowed > 0) {
        px = current.vx[i]! + (px - current.vx[i]!) * allowed / change;
        py = current.vy[i]! + (py - current.vy[i]!) * allowed / change;
      }
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
        this.deltaX[i] = this.deltaX[i]! * this.timeFractions[i]!;
        this.deltaY[i] = this.deltaY[i]! * this.timeFractions[i]!;
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
    this.staticIntegrator.integrate(x, y, vx, vy, dt, radius,
      input.config.width, input.config.height, input.obstacles, 4, this.slide);
    if (this.slide.startedOverlapping) {
      // A tangent sweep can accumulate sub-micropixel floating-point error.
      // Repair only this tiny numeric shell; actual invalid spawns/building
      // intersections remain stopped and reported, never silently teleported.
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
      if (Math.hypot(repairedX - x, repairedY - y) <= tolerance) {
        this.staticIntegrator.integrate(repairedX, repairedY, vx, vy, dt, radius,
          input.config.width, input.config.height, input.obstacles, 4, this.slide);
        if (!this.slide.startedOverlapping) metrics.staticContacts++;
        else { this.slide.x = x; this.slide.y = y; }
      }
    }
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
