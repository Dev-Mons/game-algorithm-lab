import type { AgentBuffer } from './agent-state';
import type { CrowdField } from './crowd-field';
import { clamp } from './math';
import { segmentDistanceSquaredToRect } from './obstacle-collision';
import type { Rect } from './types';

const EPSILON = 1e-9;
export const FLOW_CHANNELS = 8;

export interface CrowdFlowOptions {
  targetDensity: number;
  pressureIterations: number;
  pressureRelaxationTime: number;
  velocityBlend: number;
  maximumAcceleration: number;
  maximumSpeed: number;
  fixedDelta: number;
}

/**
 * Particle/grid transport with eight interpolated heading channels. Channels
 * are local directions, never scenario/flow IDs. Opposing streams do not
 * cancel their velocities; they share only a unilateral capacity pressure.
 * Buffers, four-cell transfers and pressure stencils have fixed sizes.
 */
export class CrowdFlowSolver {
  readonly mass: Float64Array;
  readonly momentumX: Float64Array;
  readonly momentumY: Float64Array;
  readonly desiredX: Float64Array;
  readonly desiredY: Float64Array;
  readonly velocityX: Float64Array;
  readonly velocityY: Float64Array;
  private readonly unprojectedX: Float64Array;
  private readonly unprojectedY: Float64Array;
  readonly pressure: Float64Array;
  readonly divergence: Float64Array;
  readonly correctedDivergence: Float64Array;
  readonly openRight: Uint8Array;
  readonly openDown: Uint8Array;
  private readonly pressureNext: Float64Array;
  private readonly rhs: Float64Array;
  private readonly bulkX: Float64Array;
  private readonly bulkY: Float64Array;
  private readonly faceX: Float64Array;
  private readonly faceY: Float64Array;
  private readonly faceDensityX: Float64Array;
  private readonly faceDensityY: Float64Array;
  private readonly cells = new Int32Array(4);
  private readonly weights = new Float64Array(4);
  private channel = 0;
  private channelFraction = 0;

  constructor(readonly field: CrowdField) {
    const size = field.cellCount * FLOW_CHANNELS;
    this.mass = new Float64Array(size);
    this.momentumX = new Float64Array(size);
    this.momentumY = new Float64Array(size);
    this.desiredX = new Float64Array(size);
    this.desiredY = new Float64Array(size);
    this.velocityX = new Float64Array(size);
    this.velocityY = new Float64Array(size);
    this.unprojectedX = new Float64Array(size);
    this.unprojectedY = new Float64Array(size);
    this.pressure = new Float64Array(field.cellCount);
    this.pressureNext = new Float64Array(field.cellCount);
    this.rhs = new Float64Array(field.cellCount);
    this.divergence = new Float64Array(field.cellCount);
    this.correctedDivergence = new Float64Array(field.cellCount);
    this.bulkX = new Float64Array(field.cellCount);
    this.bulkY = new Float64Array(field.cellCount);
    this.faceX = new Float64Array(field.cellCount);
    this.faceY = new Float64Array(field.cellCount);
    this.faceDensityX = new Float64Array(field.cellCount);
    this.faceDensityY = new Float64Array(field.cellCount);
    this.openRight = new Uint8Array(field.cellCount);
    this.openDown = new Uint8Array(field.cellCount);
    this.setObstacles([], 0);
  }

  setObstacles(obstacles: readonly Rect[], clearance: number): void {
    const {columns, rows, cellSize, blocked} = this.field;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x;
        const px = (x + .5) * cellSize;
        const py = (y + .5) * cellSize;
        this.openRight[i] = x + 1 < columns && !blocked[i] && !blocked[i+1]
          && !obstacles.some(o => segmentDistanceSquaredToRect(px, py, px + cellSize, py, o)
            <= clearance * clearance) ? 1 : 0;
        this.openDown[i] = y + 1 < rows && !blocked[i] && !blocked[i+columns]
          && !obstacles.some(o => segmentDistanceSquaredToRect(px, py, px, py + cellSize, o)
            <= clearance * clearance) ? 1 : 0;
      }
    }
  }

  solve(state: AgentBuffer, desiredX: Float64Array, desiredY: Float64Array,
    options: CrowdFlowOptions): void {
    this.scatter(state, desiredX, desiredY);
    this.buildVelocities(options);
    this.project(options);
    this.gather(state, desiredX, desiredY, options);
  }

  private scatter(state: AgentBuffer, desiredX: Float64Array, desiredY: Float64Array): void {
    this.mass.fill(0);
    this.momentumX.fill(0);
    this.momentumY.fill(0);
    this.desiredX.fill(0);
    this.desiredY.fill(0);
    const cells = this.field.cellCount;
    for (let a = 0; a < state.count; a++) {
      if (state.active[a] !== 1) continue;
      this.stencil(state.x[a]!, state.y[a]!);
      this.heading(state.intentX[a]!, state.intentY[a]!);
      for (let side = 0; side < 2; side++) {
        const offset = ((this.channel + side) % FLOW_CHANNELS) * cells;
        const angularWeight = side === 0 ? 1 - this.channelFraction : this.channelFraction;
        for (let corner = 0; corner < 4; corner++) {
          const weight = this.weights[corner]! * angularWeight;
          const i = this.cells[corner]! + offset;
          this.mass[i] = this.mass[i]! + weight;
          this.momentumX[i] = this.momentumX[i]! + state.vx[a]! * weight;
          this.momentumY[i] = this.momentumY[i]! + state.vy[a]! * weight;
          this.desiredX[i] = this.desiredX[i]! + desiredX[a]! * weight;
          this.desiredY[i] = this.desiredY[i]! + desiredY[a]! * weight;
        }
      }
    }
  }

  private buildVelocities(options: CrowdFlowOptions): void {
    const {cellCount, density} = this.field;
    this.bulkX.fill(0);
    this.bulkY.fill(0);
    for (let cell = 0; cell < cellCount; cell++) {
      let total = 0;
      const blend = options.velocityBlend * clamp(density[cell]! / options.targetDensity, 0, 1);
      for (let channel = 0; channel < FLOW_CHANNELS; channel++) {
        const i = channel * cellCount + cell;
        const mass = this.mass[i]!;
        const inverse = mass > EPSILON ? 1 / mass : 0;
        this.velocityX[i] = (this.desiredX[i]! * (1 - blend) + this.momentumX[i]! * blend) * inverse;
        this.velocityY[i] = (this.desiredY[i]! * (1 - blend) + this.momentumY[i]! * blend) * inverse;
        this.unprojectedX[i] = this.velocityX[i]!;
        this.unprojectedY[i] = this.velocityY[i]!;
        this.bulkX[cell] = this.bulkX[cell]! + this.velocityX[i]! * mass;
        this.bulkY[cell] = this.bulkY[cell]! + this.velocityY[i]! * mass;
        total += mass;
      }
      if (total > EPSILON) {
        this.bulkX[cell] = this.bulkX[cell]! / total;
        this.bulkY[cell] = this.bulkY[cell]! / total;
      }
    }
  }

  private project(options: CrowdFlowOptions): void {
    const {cellCount, columns, cellSize, density, blocked} = this.field;
    const horizon = Math.max(options.fixedDelta, options.pressureRelaxationTime);
    const inverseTarget = 1 / Math.max(EPSILON, options.targetDensity);
    this.pressure.fill(0);
    this.pressureNext.fill(0);
    for (let i = 0; i < cellCount; i++) {
      this.faceDensityX[i] = this.openRight[i]
        ? (density[i]! + density[i+1]!) * .5 * inverseTarget : 0;
      this.faceDensityY[i] = this.openDown[i]
        ? (density[i]! + density[i+columns]!) * .5 * inverseTarget : 0;
      this.faceX[i] = this.openRight[i] ? (this.bulkX[i]! + this.bulkX[i+1]!) * .5 : 0;
      this.faceY[i] = this.openDown[i] ? (this.bulkY[i]! + this.bulkY[i+columns]!) * .5 : 0;
    }
    for (let i = 0; i < cellCount; i++) {
      const left = i % columns > 0 ? i - 1 : i;
      const up = i >= columns ? i - columns : i;
      const fluxLeft = left !== i ? this.faceDensityX[left]! * this.faceX[left]! : 0;
      const fluxUp = up !== i ? this.faceDensityY[up]! * this.faceY[up]! : 0;
      const divergence = (this.faceDensityX[i]! * this.faceX[i]! - fluxLeft
        + this.faceDensityY[i]! * this.faceY[i]! - fluxUp) / cellSize;
      this.divergence[i] = divergence;
      this.rhs[i] = blocked[i] ? 0 : (density[i]! * inverseTarget - 1) / horizon - divergence;
    }
    // Projected Jacobi for A p >= b, p >= 0. Under-filled cells are allowed
    // to compress; no negative pressure, cohesion, or tensile gap force.
    for (let iteration = 0; iteration < options.pressureIterations; iteration++) {
      for (let i = 0; i < cellCount; i++) {
        const left = i % columns > 0 ? i - 1 : i;
        const up = i >= columns ? i - columns : i;
        const wl = left !== i ? this.faceDensityX[left]! : 0;
        const wu = up !== i ? this.faceDensityY[up]! : 0;
        const wr = this.faceDensityX[i]!;
        const wd = this.faceDensityY[i]!;
        const diagonal = wl + wr + wu + wd;
        const neighborPressure = wl * this.pressure[left]! + wu * this.pressure[up]!
          + (wr > 0 ? wr * this.pressure[i+1]! : 0)
          + (wd > 0 ? wd * this.pressure[i+columns]! : 0);
        this.pressureNext[i] = diagonal > EPSILON
          ? Math.max(0, (this.rhs[i]! * cellSize * cellSize + neighborPressure) / diagonal) : 0;
      }
      this.pressure.set(this.pressureNext);
    }
    const limit = options.maximumAcceleration * horizon;
    for (let i = 0; i < cellCount; i++) {
      const left = i % columns > 0 ? i - 1 : i;
      const up = i >= columns ? i - columns : i;
      const gxRight = this.openRight[i] ? (this.pressure[i+1]! - this.pressure[i]!) / cellSize : 0;
      const gyDown = this.openDown[i] ? (this.pressure[i+columns]! - this.pressure[i]!) / cellSize : 0;
      const gxLeft = left !== i && this.openRight[left] ? (this.pressure[i]! - this.pressure[left]!) / cellSize : 0;
      const gyUp = up !== i && this.openDown[up] ? (this.pressure[i]! - this.pressure[up]!) / cellSize : 0;
      let x = -(gxLeft + gxRight) * .5;
      let y = -(gyUp + gyDown) * .5;
      const scale = Math.min(1, limit / Math.max(EPSILON, Math.hypot(x,y)));
      x *= scale;
      y *= scale;
      // Publish corrected transport velocities on the grid. Agent gather
      // only interpolates these channels; it adds no separate pressure force.
      for (let channel = 0; channel < FLOW_CHANNELS; channel++) {
        const slot = channel * cellCount + i;
        this.velocityX[slot] = this.velocityX[slot]! + x;
        this.velocityY[slot] = this.velocityY[slot]! + y;
      }
      this.correctedDivergence[i] = this.divergence[i]!
        - (this.faceDensityX[i]! * gxRight - (left !== i ? this.faceDensityX[left]! * gxLeft : 0)
          + this.faceDensityY[i]! * gyDown - (up !== i ? this.faceDensityY[up]! * gyUp : 0)) / cellSize;
    }
  }

  private gather(state: AgentBuffer, desiredX: Float64Array, desiredY: Float64Array,
    options: CrowdFlowOptions): void {
    const count = this.field.cellCount;
    for (let a = 0; a < state.count; a++) {
      if (state.active[a] !== 1) continue;
      this.stencil(state.x[a]!, state.y[a]!);
      this.heading(state.intentX[a]!, state.intentY[a]!);
      let x = 0;
      let y = 0;
      let weightSum = 0;
      let baseX = 0;
      let baseY = 0;
      let density = 0;
      for (let corner = 0; corner < 4; corner++) {
        const cell = this.cells[corner]!;
        const weight = this.weights[corner]!;
        density += this.field.density[cell]! * weight;
        for (let side = 0; side < 2; side++) {
          const i = ((this.channel + side) % FLOW_CHANNELS) * count + cell;
          const w = weight * (side === 0 ? 1 - this.channelFraction : this.channelFraction);
          if (this.mass[i]! <= EPSILON) continue;
          x += this.velocityX[i]! * w;
          y += this.velocityY[i]! * w;
          baseX += this.unprojectedX[i]! * w;
          baseY += this.unprojectedY[i]! * w;
          weightSum += w;
        }
      }
      const blend = clamp(density / options.targetDensity, 0, 1);
      if (weightSum > EPSILON) {
        // Preserve sub-grid navigation detail in dilute cells while taking
        // the grid's entire velocity change. Dense cells use pure PIC gather.
        x = x / weightSum + (desiredX[a]! - baseX / weightSum) * (1 - blend);
        y = y / weightSum + (desiredY[a]! - baseY / weightSum) * (1 - blend);
      } else { x = desiredX[a]!; y = desiredY[a]!; }
      // Pressure may stop a stream, but cannot replace its route with reverse
      // transport. Static sweeps remain the geometric safety authority.
      const forward = x * state.intentX[a]! + y * state.intentY[a]!;
      if (forward < 0) {
        x -= forward * state.intentX[a]!;
        y -= forward * state.intentY[a]!;
      }
      const scale = Math.min(1, options.maximumSpeed / Math.max(EPSILON, Math.hypot(x,y)));
      desiredX[a] = x * scale;
      desiredY[a] = y * scale;
    }
  }

  private heading(x: number, y: number): void {
    const heading = (Math.atan2(y,x) / (Math.PI * 2) + 1) * FLOW_CHANNELS;
    this.channel = Math.floor(heading) % FLOW_CHANNELS;
    this.channelFraction = heading - Math.floor(heading);
  }

  private stencil(x: number, y: number): void {
    const {columns, rows, cellSize, blocked} = this.field;
    const gx = clamp(x / cellSize - .5, 0, columns - 1);
    const gy = clamp(y / cellSize - .5, 0, rows - 1);
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const tx = gx - cx;
    const ty = gy - cy;
    this.cells[0] = cy * columns + cx;
    this.cells[1] = cy * columns + Math.min(columns - 1, cx+1);
    this.cells[2] = Math.min(rows - 1, cy+1) * columns + cx;
    this.cells[3] = Math.min(rows - 1, cy+1) * columns + Math.min(columns - 1, cx+1);
    this.weights[0] = (1-tx)*(1-ty);
    this.weights[1] = tx*(1-ty);
    this.weights[2] = (1-tx)*ty;
    this.weights[3] = tx*ty;
    let anchor = 0;
    for (let k = 0; k < 4; k++) {
      if (blocked[this.cells[k]!]) this.weights[k] = 0;
      if (this.weights[k]! > this.weights[anchor]!) anchor = k;
    }
    const origin = this.cells[anchor]!;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const target = this.cells[k]!;
      const dx = target % columns - origin % columns;
      const dy = Math.floor(target / columns) - Math.floor(origin / columns);
      // Transfers obey the same face connectivity as pressure. Otherwise a
      // bilinear scatter could couple two streams across a sub-cell wall.
      const connected = (this.horizontalOpen(origin, dx) && this.verticalOpen(origin + dx, dy))
        || (this.verticalOpen(origin, dy) && this.horizontalOpen(origin + dy * columns, dx));
      if (!connected) this.weights[k] = 0;
      total += this.weights[k]!;
    }
    for (let k = 0; k < 4; k++) this.weights[k] = total > EPSILON ? this.weights[k]! / total : 0;
  }

  private horizontalOpen(i: number, offset: number): boolean {
    return offset === 0 || this.openRight[offset > 0 ? i : i - 1] === 1;
  }

  private verticalOpen(i: number, offset: number): boolean {
    return offset === 0 || this.openDown[offset > 0 ? i : i - this.field.columns] === 1;
  }
}
