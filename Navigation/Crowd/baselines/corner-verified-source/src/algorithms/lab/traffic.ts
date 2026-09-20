import type { AgentBuffer } from '../../core/agent-state';
import type { ScenarioRouteGateDefinition, Vec2 } from '../../core/types';
import { SpatialHash } from '../spatial-hash/spatial-hash';

interface Lease { direction: number; expires: number; entered: boolean; }
interface GateState {
  definition: ScenarioRouteGateDefinition;
  leases: Map<number, Lease>;
  waiting: Map<number, { since: number; direction: number }>;
  direction: number;
  admitted: number;
}
/** Explicit gate policy. Lease timeout only cancels an unentered reservation, never physical occupancy. */
export class GateQueue {
  private readonly gates: GateState[];
  passed = 0;
  waitingCount = 0;
  private grid: SpatialHash | null = null;
  private bodies = new Uint8Array(0);
  constructor(definitions: readonly ScenarioRouteGateDefinition[], private width = 1200, private height = 720, capacity = 0) {
    this.gates = definitions.map((definition) => ({ definition, leases: new Map(), waiting: new Map(), direction: 0, admitted: 0 }));
    if (capacity > 0) { this.grid = new SpatialHash(width, height, 24, capacity); this.bodies = new Uint8Array(capacity); }
  }

  apply(state: AgentBuffer, radii: Float64Array, goals: readonly Vec2[], preferredX: Float64Array,
    preferredY: Float64Array, time: number, speed: number, dt: number, stopped: Uint8Array, retainArrivals = false): void {
    stopped.fill(0);
    this.waitingCount = 0;
    if (!this.gates.length) return;
    if (this.bodies.length !== state.count) {
      this.bodies = new Uint8Array(state.count);
      this.grid = new SpatialHash(this.width, this.height, 24, state.count);
    }
    let maximumRadius = 0;
    for (let i = 0; i < state.count; i += 1) {
      this.bodies[i] = state.active[i] || retainArrivals ? 1 : 0;
      maximumRadius = Math.max(maximumRadius, radii[i]!);
    }
    this.grid!.rebuild(state.x, state.y, this.bodies);
    for (const gate of this.gates) {
      const { region } = gate.definition;
      const axisX = gate.definition.axis !== 'y';
      const low = axisX ? region.x : region.y;
      const high = low + (axisX ? region.width : region.height);
      const sideLow = axisX ? region.y : region.x;
      const sideHigh = sideLow + (axisX ? region.height : region.width);
      const center = (low + high) * 0.5;
      const coordinate = (i: number): number => (axisX ? state.x : state.y)[i]!;
      const sideCoordinate = (i: number): number => (axisX ? state.y : state.x)[i]!;
      const occupies = (i: number): boolean => coordinate(i) + radii[i]! >= low && coordinate(i) - radii[i]! <= high
        && sideCoordinate(i) + radii[i]! >= sideLow && sideCoordinate(i) - radii[i]! <= sideHigh;
      for (const [agent, lease] of gate.leases) {
        // An arrived retained body remains an occupant. Being inactive is never a release criterion.
        if (!this.bodies[agent]) { gate.leases.delete(agent); continue; }
        if (occupies(agent)) { lease.entered = true; continue; }
        if (lease.entered) {
          gate.leases.delete(agent);
          const downstream = lease.direction > 0 ? coordinate(agent) - radii[agent]! > high : coordinate(agent) + radii[agent]! < low;
          if (downstream) this.passed += 1;
        }
        else if (time > lease.expires) gate.leases.delete(agent);
      }
      for (let agent = 0; agent < state.count; agent += 1) {
        if (!this.bodies[agent]) { gate.waiting.delete(agent); continue; }
        const goal = goals[agent]!;
        const target = axisX ? goal.x : goal.y;
        const pos = coordinate(agent);
        const direction = target >= center ? 1 : -1;
        if (occupies(agent)) {
          if (!gate.leases.has(agent)) gate.leases.set(agent, { direction, expires: Infinity, entered: true });
          if (gate.direction === 0) gate.direction = direction;
          gate.waiting.delete(agent); continue;
        }
        if (state.active[agent] !== 1) { gate.waiting.delete(agent); continue; }
        const upstream = direction > 0 ? pos < low && target > high : pos > high && target < low;
        const distance = direction > 0 ? low - pos : pos - high;
        const side = sideCoordinate(agent);
        if (!upstream || distance > Math.max(100, speed * 2) || side < sideLow - speed || side > sideHigh + speed) {
          gate.waiting.delete(agent); continue;
        }
        if (!gate.leases.has(agent) && !gate.waiting.has(agent)) gate.waiting.set(agent, { since: time, direction });
      }
      let oldestAgent = -1; let oldestTime = Infinity;
      const admissionOrder = [...gate.waiting.keys()].sort((a, b) => {
        const wa = gate.waiting.get(a)!; const wb = gate.waiting.get(b)!;
        // Aging chooses the next directional batch; within a batch admit its physical front first.
        const da = Math.min(Math.abs(coordinate(a) - low), Math.abs(coordinate(a) - high));
        const db = Math.min(Math.abs(coordinate(b) - low), Math.abs(coordinate(b) - high));
        return wa.direction - wb.direction || da - db || wa.since - wb.since || a - b;
      });
      for (const agent of admissionOrder) {
        const wait = gate.waiting.get(agent)!;
        if (wait.since < oldestTime || wait.since === oldestTime && agent < oldestAgent) { oldestAgent = agent; oldestTime = wait.since; }
      }
      if (gate.leases.size === 0) {
        gate.direction = oldestAgent >= 0 ? gate.waiting.get(oldestAgent)!.direction : 0;
        gate.admitted = 0;
      }
      const capacity = Math.max(1, Math.trunc(gate.definition.capacity ?? 12));
      let oppositeWaiting = false;
      for (const wait of gate.waiting.values()) if (wait.direction !== gate.direction) oppositeWaiting = true;
      for (const agent of admissionOrder) {
        const wait = gate.waiting.get(agent)!;
        if (wait.direction !== gate.direction || gate.leases.size >= capacity || oppositeWaiting && gate.admitted >= capacity) continue;
        const radius = radii[agent]!;
        const exitAlong = wait.direction > 0 ? high + radius * 3 : low - radius * 3;
        const exitSide = Math.max(sideLow + radius, Math.min(sideHigh - radius, sideCoordinate(agent)));
        const exitX = axisX ? exitAlong : exitSide;
        const exitY = axisX ? exitSide : exitAlong;
        let exitBlocked = false;
        this.grid!.forEachCandidate(exitX, exitY, radius + maximumRadius + 1, (other) => {
          if (other === agent) return;
          if (Math.hypot(state.x[other]! - exitX, state.y[other]! - exitY) < radius + radii[other]! + 1) exitBlocked = true;
        });
        if (exitBlocked) continue;
        const distance = Math.min(Math.abs(coordinate(agent) - low), Math.abs(coordinate(agent) - high));
        gate.leases.set(agent, { direction: wait.direction, expires: time + 2 + distance / Math.max(1, speed), entered: false });
        gate.waiting.delete(agent); gate.admitted += 1;
      }
      for (const agent of gate.waiting.keys()) {
        const pos = coordinate(agent);
        // Keep a body-sized exit pocket between the opposing stop line and the downstream probe.
        // Otherwise two waiting fronts can permanently deny admission to an entirely empty gate.
        const stopDistance = maximumRadius * 6 + speed * dt + 4;
        const distance = pos < low ? low - pos : pos - high;
        const scale = Math.max(0, Math.min(1, (distance - stopDistance) / Math.max(1, speed * 0.3)));
        preferredX[agent] = preferredX[agent]! * scale;
        preferredY[agent] = preferredY[agent]! * scale;
        if (scale < 0.05) { stopped[agent] = 1; this.waitingCount += 1; }
      }
    }
  }

  /** Debug/test view: physical occupants remain here after arbitrarily old lease expiry. */
  reservations(gateIndex = 0): readonly number[] { return [...(this.gates[gateIndex]?.leases.keys() ?? [])]; }
}
