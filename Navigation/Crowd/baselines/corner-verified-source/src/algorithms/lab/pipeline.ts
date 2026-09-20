import { FlowField } from '../flow-field/flow-field';
import { LocalMotionSolver } from '../lab-motion/local-motion';
import type { AgentBuffer } from '../../core/agent-state';
import type { CrowdMovementResult } from '../../core/crowd-movement-solver';
import { clamp } from '../../core/math';
import type { Vec2 } from '../../core/types';
import { emptyExperimentStats, type ExperimentStats, type LabWorld } from './contracts';
import { GridAStar } from './grid-astar';
import type { ExperimentOptions } from './registry';
import { GateQueue } from './traffic';

interface Group { id: number; members: number[]; path: Vec2[]; x: number; y: number; cursor: number; clearance: number; }
export interface AgentGoalCommand { agent: number; goal: Vec2; }

/** Layered experimental solver. Every new command/terrain edit creates navigation and traffic state anew. */
export class LabPipeline {
  readonly stats: ExperimentStats = emptyExperimentStats();
  readonly preferredX: Float64Array;
  readonly preferredY: Float64Array;
  readonly targets: Vec2[];
  readonly commandGoals: Vec2[];
  readonly available: Uint8Array;
  readonly arrived: Uint8Array;
  readonly stopped: Uint8Array;
  readonly navigators: FlowField[] = [];
  private readonly paths: Vec2[][];
  private readonly pathCursor: Int32Array;
  private readonly grids = new Map<number, GridAStar>();
  private readonly fields = new Map<string, FlowField>();
  private readonly agentFields: (FlowField | undefined)[];
  private readonly groupIndex: Int32Array;
  private readonly memberIndex: Int32Array;
  private readonly groups: Group[] = [];
  private readonly local = new LocalMotionSolver();
  private readonly queue: GateQueue;
  private readonly direction = { x: 0, y: 0 };
  private readonly recoveryCooldown: Int32Array;
  private lastDynamicStep = -1;
  private previousQueuePassed = 0;

  constructor(readonly world: LabWorld, readonly options: ExperimentOptions, primary: FlowField,
    overrides: ReadonlyMap<number, Vec2> = new Map(), terrainVersion = 0, previous?: LabPipeline) {
    const count = world.state.count;
    this.preferredX = new Float64Array(count); this.preferredY = new Float64Array(count);
    this.available = new Uint8Array(count); this.available.fill(1);
    this.arrived = new Uint8Array(count); this.stopped = new Uint8Array(count);
    this.paths = Array.from({ length: count }, () => []);
    this.pathCursor = new Int32Array(count); this.groupIndex = new Int32Array(count); this.groupIndex.fill(-1);
    this.memberIndex = new Int32Array(count); this.recoveryCooldown = new Int32Array(count);
    this.agentFields = new Array(count);
    this.commandGoals = Array.from({ length: count }, (_, i) => ({ ...(overrides.get(i) ?? world.goals[world.flows[i]!]!) }));
    this.targets = this.commandGoals.map((goal) => ({ ...goal }));
    this.queue = new GateQueue(options.queue ? world.scenario.routeGates ?? [] : [], world.config.width, world.config.height, count);
    this.stats.terrainVersion = terrainVersion;
    const start = performance.now();
    if (options.destination === 'slots') this.allocateSlots(previous);
    this.buildNavigation(primary);
    this.stats.passMs.navigation = performance.now() - start;
    this.stats.activeCount = 0;
    for (let i = 0; i < count; i += 1) {
      if (!world.state.active[i]) { this.arrived[i] = 1; this.stats.arrivedCount += 1; }
      else this.stats.activeCount += 1;
      this.sample(i, world.state.x[i]!, world.state.y[i]!, this.direction);
      world.state.intentX[i] = this.direction.x; world.state.intentY[i] = this.direction.y;
    }
    this.stats.waitingCount = this.stats.activeCount;
  }

  private grid(radius: number): GridAStar {
    let grid = this.grids.get(radius);
    if (!grid) {
      const c = this.world.config;
      grid = new GridAStar(c.width, c.height, c.navCellSize, radius + c.wallMargin, this.world.scenario.obstacles);
      this.grids.set(radius, grid);
    }
    return grid;
  }

  private allocateSlots(previous?: LabPipeline): void {
    const c = this.world.config;
    let maxRadius = c.agentRadius;
    for (let i = 0; i < this.world.state.count; i += 1) maxRadius = Math.max(maxRadius, this.world.radii[i]!);
    // Retained bodies need a full-body ingress lane, plus both settling tolerances.
    // Merely non-overlapping slots can form an impenetrable fence around later targets.
    const settleTolerance = Math.max(0.25, maxRadius * 0.2);
    const spacing = maxRadius * 4 + settleTolerance * 2 + Math.max(0.5, c.agentGap);
    const occupied = new Set<string>();
    const preserved = new Uint8Array(this.targets.length);
    if (previous) {
      for (let agent = 0; agent < this.targets.length; agent += 1) {
        const goal = this.commandGoals[agent]!; const oldGoal = previous.commandGoals[agent];
        const oldTarget = previous.targets[agent];
        if (!oldGoal || !oldTarget || !previous.available[agent] || oldGoal.x !== goal.x || oldGoal.y !== goal.y) continue;
        const grid = this.grid(this.world.radii[agent]!);
        if (!grid.isPointSafe(oldTarget.x, oldTarget.y) || !grid.isSegmentSafe(goal.x, goal.y, oldTarget.x, oldTarget.y)) {
          this.world.state.active[agent] = 1; continue;
        }
        this.targets[agent] = { ...oldTarget }; preserved[agent] = 1;
        occupied.add(`${Math.round(oldTarget.x / spacing)},${Math.round(oldTarget.y / spacing)}`);
      }
    }
    const cursors = new Map<string, number>();
    const assignments = new Map<string, number[]>();
    const maximumRing = Math.ceil(Math.hypot(c.width, c.height) / spacing);
    const maxCandidates = Math.min(4_000_000, (maximumRing * 2 + 1) ** 2);
    for (let agent = 0; agent < this.targets.length; agent += 1) {
      if (preserved[agent]) continue;
      const goal = this.commandGoals[agent]!;
      const key = `${goal.x},${goal.y}`;
      let cursor = cursors.get(key) ?? 0;
      let found = false;
      const grid = this.grid(this.world.radii[agent]!);
      if (!grid.isPointSafe(goal.x, goal.y)) {
        this.available[agent] = 0; this.stats.unavailableSlots += 1;
        continue;
      }
      // Stable square spiral; full-size lattice also excludes overlapping slots across distinct goals.
      for (; cursor < maxCandidates; cursor += 1) {
        const offset = spiral(cursor);
        const gx = Math.round(goal.x / spacing) + offset.x;
        const gy = Math.round(goal.y / spacing) + offset.y;
        const slotKey = `${gx},${gy}`;
        const x = gx * spacing; const y = gy * spacing;
        if (occupied.has(slotKey) || !grid.isPointSafe(x, y)) continue;
        // Slots must share the destination's obstacle-visible arrival region. Do not assign behind walls.
        if (!grid.isSegmentSafe(goal.x, goal.y, x, y)) continue;
        this.targets[agent] = { x, y }; occupied.add(slotKey); found = true; cursor += 1; break;
      }
      cursors.set(key, cursor);
      if (!found) { this.available[agent] = 0; this.stats.unavailableSlots += 1; }
      else {
        let members = assignments.get(key);
        if (!members) { members = []; assignments.set(key, members); }
        members.push(agent);
      }
    }
    for (const members of assignments.values()) this.assignApproachOrderedSlots(members);
  }

  private assignApproachOrderedSlots(members: number[]): void {
    if (members.length < 2) return;
    const state = this.world.state;
    let cx = 0; let cy = 0;
    for (const agent of members) { cx += state.x[agent]!; cy += state.y[agent]!; }
    cx /= members.length; cy /= members.length;
    const goal = this.commandGoals[members[0]!]!;
    const length = Math.hypot(goal.x - cx, goal.y - cy);
    const fx = length > 1e-9 ? (goal.x - cx) / length : 1;
    const fy = length > 1e-9 ? (goal.y - cy) / length : 0;
    const lateral = (point: Vec2): number => -fy * point.x + fx * point.y;
    const forward = (point: Vec2): number => fx * point.x + fy * point.y;
    const slots = members.map((agent) => this.targets[agent]!);
    members.sort((a, b) => (-fy * state.x[a]! + fx * state.y[a]!) - (-fy * state.x[b]! + fx * state.y[b]!) || a - b);
    slots.sort((a, b) => lateral(a) - lateral(b) || forward(a) - forward(b));
    // Stable spatial matching avoids ID-random crossing. In each lateral band, leading agents
    // travel to the far side first; later agents settle behind instead of fencing their ingress.
    const bandSize = Math.ceil(Math.sqrt(members.length));
    for (let start = 0; start < members.length; start += bandSize) {
      const agents = members.slice(start, start + bandSize).sort((a, b) =>
        (fx * state.x[a]! + fy * state.y[a]!) - (fx * state.x[b]! + fy * state.y[b]!) || a - b);
      const band = slots.slice(start, start + bandSize).sort((a, b) => forward(a) - forward(b) || lateral(a) - lateral(b));
      for (let index = 0; index < agents.length; index += 1) this.targets[agents[index]!] = band[index]!;
    }
  }

  private buildNavigation(primary: FlowField): void {
    const w = this.world; const c = w.config;
    if (this.options.planner === 'shared-flow') {
      for (let agent = 0; agent < w.state.count; agent += 1) {
        const goal = this.commandGoals[agent]!; const radius = w.radii[agent]!;
        const key = `${goal.x},${goal.y},${radius}`;
        let field = this.fields.get(key);
        if (!field) {
          if (this.fields.size >= 128) throw new RangeError('Shared-flow supports at most 128 distinct goal/size fields; use individual A* for many individual goals.');
          field = this.fields.size === 0 ? primary : new FlowField(c.width, c.height, c.navCellSize);
          field.rebuild(goal, w.scenario.obstacles, radius + c.wallMargin);
          this.fields.set(key, field); this.navigators.push(field); this.stats.fieldBuilds += 1;
        } else this.stats.cacheHits += 1;
        this.agentFields[agent] = field;
      }
    } else if (this.options.planner === 'individual-astar') {
      for (let agent = 0; agent < w.state.count; agent += 1) this.replanAgent(agent, false);
    } else {
      const openGroups = new Map<string, Group>();
      for (let agent = 0; agent < w.state.count; agent += 1) {
        const goal = this.commandGoals[agent]!;
        const key = `${w.flows[agent]},${goal.x},${goal.y}`;
        let group = openGroups.get(key);
        if (!group || group.members.length >= this.options.groupSize) {
          group = { id: this.groups.length, members: [], path: [], x: w.state.x[agent]!, y: w.state.y[agent]!, cursor: 0, clearance: w.radii[agent]! };
          openGroups.set(key, group); this.groups.push(group);
        } else this.stats.cacheHits += 1;
        this.groupIndex[agent] = group.id;
        this.memberIndex[agent] = group.members.length;
        group.members.push(agent); group.clearance = Math.max(group.clearance, w.radii[agent]!);
      }
      for (const group of this.groups) {
        const goal = this.commandGoals[group.members[0]!]!;
        group.path = this.grid(group.clearance).find({ x: group.x, y: group.y }, goal);
        this.stats.pathRequests += 1;
      }
    }
  }

  sample(agent: number, x: number, y: number, out: Vec2): boolean {
    out.x = 0; out.y = 0;
    if (!this.available[agent]) return false;
    const goal = this.targets[agent]!;
    const grid = this.grid(this.world.radii[agent]!);
    // Slot seeking only engages within its visible arrival region; otherwise retain the shared route.
    if (this.options.destination === 'slots' && grid.isSegmentSafe(x, y, goal.x, goal.y)) {
      return directionTo(x, y, goal, out);
    }
    if (this.options.planner === 'shared-flow' && !this.paths[agent]!.length) {
      if (!grid.isPointSafe(this.commandGoals[agent]!.x, this.commandGoals[agent]!.y)) return false;
      return this.agentFields[agent]!.sampleDirection(x, y, out);
    }
    const group = this.groups[this.groupIndex[agent]!];
    const path = this.paths[agent]!.length ? this.paths[agent]! : group?.path ?? this.paths[agent]!;
    const cursor = Math.min(this.pathCursor[agent]!, Math.max(0, path.length - 1));
    if (!path.length) return false;
    // A nearby corner is still required until the next segment becomes visible.
    // Distance-only advancement can discard the sole visible waypoint and leave
    // even a fresh A* route permanently unable to steer around a convex corner.
    let visible = -1;
    for (let i = cursor; i < path.length; i += 1) {
      if (grid.isSegmentSafe(x, y, path[i]!.x, path[i]!.y)) visible = i;
      else if (visible >= 0) break;
    }
    if (visible < 0) return false;
    this.pathCursor[agent] = visible;
    return directionTo(x, y, path[visible]!, out);
  }

  private replanAgent(agent: number, recovery: boolean): void {
    const w = this.world;
    this.paths[agent] = this.available[agent]
      ? this.grid(w.radii[agent]!).find({ x: w.state.x[agent]!, y: w.state.y[agent]! }, this.targets[agent]!) : [];
    this.pathCursor[agent] = 0;
    this.stats.pathRequests += 1;
    if (recovery) this.stats.replans += 1;
  }

  step(current: AgentBuffer, next: AgentBuffer, step: number, densityScale: number): CrowdMovementResult {
    const started = performance.now(); const c = this.world.config;
    this.world.state = current;
    const pass = this.stats.passMs;
    for (const key of Object.keys(pass) as (keyof typeof pass)[]) pass[key] = 0;
    this.deactivateArrivals(current);
    let mark = performance.now();
    if (this.options.congestion && (this.lastDynamicStep < 0 || step - this.lastDynamicStep >= Math.max(1, c.dynamicFlowRebuildInterval))) {
      for (const field of this.fields.values()) {
        field.rebuildDynamic(this.world.crowdField, {
          densityScale, targetDensity: c.dynamicFlowTargetDensity, densityWeight: c.dynamicFlowDensityWeight,
          overloadWeight: c.dynamicFlowOverloadWeight, counterFlowWeight: c.dynamicFlowCounterFlowWeight,
          wallWeight: c.dynamicFlowWallWeight, costSmoothing: c.dynamicFlowCostSmoothing,
          directionHysteresis: c.dynamicFlowDirectionHysteresis, maximumSpeed: c.maxSpeed,
          directGoalLowDensity: c.directGoalLowDensity, directGoalCounterFlow: c.directGoalCounterFlow,
          directGoalMinimumClearance: c.directGoalMinimumClearance,
        });
        this.stats.fieldBuilds += 1;
      }
      this.lastDynamicStep = step;
      // Any corridor derived while recovering from a stale dynamic field is invalid after its refresh.
      for (let agent = 0; agent < this.paths.length; agent += 1) {
        this.paths[agent] = []; this.pathCursor[agent] = 0;
      }
    }
    pass.navigation += performance.now() - mark;
    mark = performance.now();
    let recoveryNavigationMs = 0;
    if (this.options.steering === 'formation') this.advanceLeaders(current);
    for (let agent = 0; agent < current.count; agent += 1) {
      this.preferredX[agent] = 0; this.preferredY[agent] = 0;
      if (current.active[agent] !== 1 || !this.available[agent]) continue;
      let navigable = this.sample(agent, current.x[agent]!, current.y[agent]!, this.direction);
      const isStalled = current.stalledFor[agent]! >= c.stallSeconds;
      if ((!navigable || isStalled) && step >= this.recoveryCooldown[agent]!) {
        const planStart = performance.now();
        this.replanAgent(agent, true);
        this.recoveryCooldown[agent] = step + Math.max(60, Math.round(c.stallSeconds / c.fixedDelta));
        navigable = this.sample(agent, current.x[agent]!, current.y[agent]!, this.direction);
        const replanningMs = performance.now() - planStart;
        pass.navigation += replanningMs;
        recoveryNavigationMs += replanningMs;
      }
      if (!navigable) continue;
      if (this.options.steering === 'formation') this.formationDirection(agent, current, this.direction);
      const previousDot = current.intentX[agent]! * this.direction.x + current.intentY[agent]! * this.direction.y;
      if (previousDot < -0.2) this.stats.directionFlips += 1;
      current.intentX[agent] = this.direction.x; current.intentY[agent] = this.direction.y;
      const goal = this.targets[agent]!;
      const arrival = this.options.destination === 'slots' ? Math.max(0.25, this.world.radii[agent]! * 0.2) : c.goalRadius;
      const distance = Math.hypot(goal.x - current.x[agent]!, goal.y - current.y[agent]!);
      const slowSpan = this.options.destination === 'slots' ? Math.max(this.world.radii[agent]! * 3, 8) : Math.max(1, c.arrivalSlowRadius - c.goalRadius);
      // Euclidean proximity across a wall is not arrival progress. Continue
      // following the corridor at cruise speed until its destination is visible.
      const approaching = distance < slowSpan + arrival * 0.5
        && this.grid(this.world.radii[agent]!).isSegmentSafe(current.x[agent]!, current.y[agent]!, goal.x, goal.y);
      let speed = approaching ? c.maxSpeed * clamp((distance - arrival * 0.5) / slowSpan, 0, 1) : c.maxSpeed;
      if (this.options.density) {
        const density = this.world.crowdField.sampleDensity(current.x[agent]!, current.y[agent]!) / densityScale;
        speed /= 1 + Math.max(0, density - 0.25) * 1.8;
      }
      // Deterministic, temporary handed yielding breaks perfect local symmetry without teleportation.
      if (isStalled && this.options.queue) {
        const side = agent % 2 === 0 ? 1 : -1;
        const dx = this.direction.x; this.direction.x = dx * 0.8 - this.direction.y * side * 0.3;
        this.direction.y = this.direction.y * 0.8 + dx * side * 0.3;
      }
      this.preferredX[agent] = this.direction.x * speed; this.preferredY[agent] = this.direction.y * speed;
    }
    pass.desired = Math.max(0, performance.now() - mark - recoveryNavigationMs);
    mark = performance.now();
    this.queue.apply(current, this.world.radii, this.commandGoals, this.preferredX, this.preferredY,
      step * c.fixedDelta, c.maxSpeed, c.fixedDelta, this.stopped, this.options.destination === 'slots');
    pass.queue = performance.now() - mark;
    const motion = this.local.solve({ current, next, preferredX: this.preferredX, preferredY: this.preferredY,
      targets: this.targets,
      radii: this.world.radii, config: c, obstacles: this.world.scenario.obstacles,
      avoidance: this.options.avoidance, steeringBoids: this.options.steering === 'boids', groups: this.world.flows,
      contactIterations: this.options.contact === 'pbd' ? this.options.contactIterations : 0,
      neighborLimit: this.options.maxNeighbors, timeHorizon: this.options.timeHorizon,
      retainArrivals: this.options.destination === 'slots',
      immovable: this.stopped,
    });
    this.deactivateArrivals(next);
    pass.spatial = motion.passes.spatialMs; pass.avoidance = motion.passes.avoidanceMs;
    pass.integration = motion.passes.integrationMs; pass.contact = motion.passes.contactMs;
    this.stats.activeCount = 0; this.stats.movingCount = 0; this.stats.waitingCount = 0; this.stats.arrivedCount = 0;
    for (let agent = 0; agent < next.count; agent += 1) {
      if (this.arrived[agent]) { this.stats.arrivedCount += 1; continue; }
      this.stats.activeCount += 1;
      if (Math.hypot(next.vx[agent]!, next.vy[agent]!) >= c.maxSpeed * 0.04) this.stats.movingCount += 1;
      else this.stats.waitingCount += 1;
    }
    this.stats.contactActiveCount = motion.contactActiveCount;
    this.stats.queuePassed += this.queue.passed - this.previousQueuePassed;
    this.previousQueuePassed = this.queue.passed;
    this.stats.neighborTruncations = motion.neighborTruncations;
    this.stats.orcaInfeasibleCount = motion.orcaInfeasibleCount;
    this.stats.invalidStaticStarts = motion.invalidStaticStarts;
    this.stats.substeps = motion.substeps;
    pass.total = performance.now() - started;
    return {
      candidateChecks: motion.candidateChecks, totalNeighbors: motion.totalNeighbors, maxNeighbors: motion.maxNeighbors,
      overlapPairs: motion.overlapPairs, recoveredAgents: motion.recoveredAgents, maxRecoveryDistance: 0,
      contactChecks: motion.contactChecks, contactConstraints: motion.contactConstraints,
      constraintIterations: this.options.contact === 'pbd' ? this.options.contactIterations : 0,
      maxContacts: 0, contactCorrectedAgents: motion.contactActiveCount, maxContactCorrection: motion.maxContactCorrection,
      staticProjectionCorrections: motion.staticContacts,
    };
  }

  private deactivateArrivals(state: AgentBuffer): void {
    for (let agent = 0; agent < state.count; agent += 1) {
      if (state.active[agent] !== 1 || !this.available[agent]) continue;
      const target = this.targets[agent]!;
      const radius = this.options.destination === 'slots' ? Math.max(0.25, this.world.radii[agent]! * 0.2) : this.world.config.goalRadius;
      if (Math.hypot(state.x[agent]! - target.x, state.y[agent]! - target.y) > radius) continue;
      if (!this.grid(this.world.radii[agent]!).isSegmentSafe(state.x[agent]!, state.y[agent]!, target.x, target.y)) continue;
      this.arrived[agent] = 1; state.active[agent] = 0;
      state.vx[agent] = 0; state.vy[agent] = 0; state.stalledFor[agent] = 0;
    }
  }

  private advanceLeaders(state: AgentBuffer): void {
    const c = this.world.config;
    for (const group of this.groups) {
      if (!group.path.length) continue;
      let x = 0; let y = 0; let moving = 0;
      for (const member of group.members) { if (!state.active[member]) continue; x += state.x[member]!; y += state.y[member]!; moving += 1; }
      if (!moving) continue;
      x /= moving; y /= moving;
      const leash = Math.max(c.navCellSize * 2, Math.sqrt(group.members.length) * group.clearance * 5);
      if (Math.hypot(group.x - x, group.y - y) > leash) continue;
      let remaining = c.maxSpeed * c.fixedDelta;
      while (remaining > 0 && group.cursor < group.path.length) {
        const target = group.path[group.cursor]!;
        const distance = Math.hypot(target.x - group.x, target.y - group.y);
        if (distance <= remaining) { group.x = target.x; group.y = target.y; group.cursor += 1; remaining -= distance; }
        else { group.x += (target.x - group.x) / distance * remaining; group.y += (target.y - group.y) / distance * remaining; remaining = 0; }
      }
    }
  }

  private formationDirection(agent: number, state: AgentBuffer, out: Vec2): void {
    const group = this.groups[this.groupIndex[agent]!];
    if (!group) return;
    const final = this.targets[agent]!; const c = this.world.config;
    const distance = Math.hypot(final.x - state.x[agent]!, final.y - state.y[agent]!);
    if (distance < Math.max(c.goalRadius * 2, Math.sqrt(group.members.length) * this.world.radii[agent]! * 3)) return;
    const width = Math.ceil(Math.sqrt(group.members.length)); const local = this.memberIndex[agent]!;
    const spacing = group.clearance * 2 + c.agentGap + 1;
    const lateral = (local % width - (width - 1) / 2) * spacing;
    const behind = Math.floor(local / width) * spacing;
    const target = { x: group.x - out.y * lateral - out.x * behind, y: group.y + out.x * lateral - out.y * behind };
    const grid = this.grid(this.world.radii[agent]!);
    // Obstacles temporarily release formation; obstacle-safe shared corridor remains authoritative.
    if (!grid.isSegmentSafe(state.x[agent]!, state.y[agent]!, target.x, target.y)) return;
    const dx = target.x - state.x[agent]!; const dy = target.y - state.y[agent]!;
    const length = Math.hypot(dx, dy);
    if (length < spacing * 0.25) return;
    const bx = out.x * 0.65 + dx / length * 0.35;
    const by = out.y * 0.65 + dy / length * 0.35;
    const norm = Math.hypot(bx, by); out.x = bx / norm; out.y = by / norm;
  }
}

function directionTo(x: number, y: number, target: Vec2, out: Vec2): boolean {
  const dx = target.x - x; const dy = target.y - y; const length = Math.hypot(dx, dy);
  if (length < 1e-9) { out.x = 0; out.y = 0; return false; }
  out.x = dx / length; out.y = dy / length; return true;
}
function spiral(index: number): Vec2 {
  if (index === 0) return { x: 0, y: 0 };
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const length = ring * 2; const offset = index - (2 * ring - 1) ** 2;
  if (offset < length) return { x: ring, y: -ring + offset };
  if (offset < length * 2) return { x: ring - (offset - length), y: ring };
  if (offset < length * 3) return { x: -ring, y: ring - (offset - length * 2) };
  return { x: -ring + (offset - length * 3), y: -ring };
}
