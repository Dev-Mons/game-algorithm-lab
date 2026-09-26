import { CrowdTransferKernel } from './crowd-transfer-kernel';
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
  areaWeights?: Float64Array;
  /** External momentum is observed by CrowdField, but is not voluntary channel alignment. */
  externallyDriven?: Uint8Array;
}

/**
 * Particle/grid transport with eight interpolated heading channels. Channels
 * are local directions, never scenario/flow IDs. Opposing streams do not
 * cancel their velocities; they share only a unilateral capacity pressure.
 * Buffers, four-cell transfers and pressure stencils have fixed sizes.
 */
export class CrowdFlowSolver {
  backend:'auto'|'js'='auto';
  private transferKernel:CrowdTransferKernel|null|undefined;
  get kernelBytes():number {return this.transferKernel?.memory.buffer.byteLength??0;}
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
  private readonly pressureCells: Int32Array;
  private readonly pressureMarked: Uint8Array;
  pressureWorksetSize=0;
  pressureGradientCells=0;
  pressureWorksetFallback=false;
  private readonly rhs: Float64Array;
  private readonly bulkX: Float64Array;
  private readonly bulkY: Float64Array;
  private readonly channelMass: Float64Array;
  private readonly faceX: Float64Array;
  private readonly faceY: Float64Array;
  private readonly faceDensityX: Float64Array;
  private readonly faceDensityY: Float64Array;
  private readonly cells = new Int32Array(4);
  private readonly weights = new Float64Array(4);
  private channel = 0;
  private channelFraction = 0;
  private transferCells = new Int32Array(0);
  private transferWeights = new Float64Array(0);
  private transferChannels = new Uint8Array(0);
  private transferFractions = new Float64Array(0);

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
    this.pressureCells=new Int32Array(field.cellCount);this.pressureMarked=new Uint8Array(field.cellCount);
    this.rhs = new Float64Array(field.cellCount);
    this.divergence = new Float64Array(field.cellCount);
    this.correctedDivergence = new Float64Array(field.cellCount);
    this.bulkX = new Float64Array(field.cellCount);
    this.bulkY = new Float64Array(field.cellCount);
    this.channelMass = new Float64Array(field.cellCount);
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
    if(this.backend==='auto'&&this.transferKernel===undefined)this.transferKernel=CrowdTransferKernel.create();
    const kernel=this.backend==='auto'?this.transferKernel:null;
    if(!kernel&&this.transferChannels.length<state.count) {
      this.transferCells=new Int32Array(state.count*4);this.transferWeights=new Float64Array(state.count*4);
      this.transferChannels=new Uint8Array(state.count);this.transferFractions=new Float64Array(state.count);
    }
    if(kernel) {
      kernel.scatter(state,desiredX,desiredY,this.field,this.openRight,this.openDown,options.areaWeights,options.externallyDriven);
      for(const name of ['mass','momentumX','momentumY','desiredX','desiredY'] as const)this[name].set(kernel.arrays[name]);
    } else this.scatter(state, desiredX, desiredY, options.areaWeights, options.externallyDriven);
    this.buildVelocities(options);
    this.project(options);
    if(kernel)kernel.gather(state.count,desiredX,desiredY,this.velocityX,this.velocityY,this.unprojectedX,this.unprojectedY,options.targetDensity,options.maximumSpeed);
    else this.gather(state, desiredX, desiredY, options);
  }

  private scatter(state: AgentBuffer, desiredX: Float64Array, desiredY: Float64Array, areaWeights?: Float64Array, external?: Uint8Array): void {
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
      // Positions, intent and face connectivity stay fixed until gather. Reuse
      // their exact transfer stencil instead of repeating geometry and atan2.
      this.transferChannels[a]=this.channel;this.transferFractions[a]=this.channelFraction;
      for(let k=0;k<4;k++){this.transferCells[a*4+k]=this.cells[k]!;this.transferWeights[a*4+k]=this.weights[k]!;}
      for (let side = 0; side < 2; side++) {
        const offset = ((this.channel + side) % FLOW_CHANNELS) * cells;
        const angularWeight = side === 0 ? 1 - this.channelFraction : this.channelFraction;
        for (let corner = 0; corner < 4; corner++) {
          const weight = this.weights[corner]! * angularWeight * (areaWeights?.[a] ?? 1);
          const i = this.cells[corner]! + offset;
          this.mass[i] = this.mass[i]! + weight;
          this.momentumX[i] = this.momentumX[i]! + (external?.[a] ? desiredX[a]! : state.vx[a]!) * weight;
          this.momentumY[i] = this.momentumY[i]! + (external?.[a] ? desiredY[a]! : state.vy[a]!) * weight;
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
    this.channelMass.fill(0);
    // Channel-major traversal follows the actual contiguous buffer layout.
    // Per-cell sums still visit channels in the original order for exact replay.
    for (let channel = 0; channel < FLOW_CHANNELS; channel++) {
      const offset = channel * cellCount;
      for (let cell = 0; cell < cellCount; cell++) {
        const i = offset + cell;
        const mass = this.mass[i]!;
        if (mass === 0) {
          this.velocityX[i] = 0; this.velocityY[i] = 0;
          this.unprojectedX[i] = 0; this.unprojectedY[i] = 0;
          continue;
        }
        const blend = options.velocityBlend * clamp(density[cell]! / options.targetDensity, 0, 1);
        const inverse = mass > EPSILON ? 1 / mass : 0;
        this.velocityX[i] = (this.desiredX[i]! * (1 - blend) + this.momentumX[i]! * blend) * inverse;
        this.velocityY[i] = (this.desiredY[i]! * (1 - blend) + this.momentumY[i]! * blend) * inverse;
        this.unprojectedX[i] = this.velocityX[i]!;
        this.unprojectedY[i] = this.velocityY[i]!;
        this.bulkX[cell] = this.bulkX[cell]! + this.velocityX[i]! * mass;
        this.bulkY[cell] = this.bulkY[cell]! + this.velocityY[i]! * mass;
        this.channelMass[cell] = this.channelMass[cell]! + mass;
      }
    }
    for (let cell = 0; cell < cellCount; cell++) {
      const total = this.channelMass[cell]!;
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
    const workset=this.pressureWorkset(options.pressureIterations);
    this.pressureWorksetFallback=workset<0;
    this.pressureWorksetSize=workset<0?cellCount:workset;
    for (let iteration = 0; iteration < options.pressureIterations; iteration++) {
      for (let slot = 0; slot < this.pressureWorksetSize; slot++) {
        const i=workset<0?slot:this.pressureCells[slot]!;
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
    this.pressureGradientCells=0;
    for (let i = 0; i < cellCount; i++) {
      const left = i % columns > 0 ? i - 1 : i;
      const up = i >= columns ? i - columns : i;
      const gxRight = this.openRight[i] ? (this.pressure[i+1]! - this.pressure[i]!) / cellSize : 0;
      const gyDown = this.openDown[i] ? (this.pressure[i+columns]! - this.pressure[i]!) / cellSize : 0;
      const gxLeft = left !== i && this.openRight[left] ? (this.pressure[i]! - this.pressure[left]!) / cellSize : 0;
      const gyUp = up !== i && this.openDown[up] ? (this.pressure[i]! - this.pressure[up]!) / cellSize : 0;
      // Require positive zero explicitly: subnormal gradients can underflow
      // to negative zero. Positive gradients of zero give -0 corrections. Adding -0 preserves every finite
      // velocity (including signed zero), and the flux correction is +0.
      if(!this.pressureWorksetFallback&&limit>0&&Object.is(gxRight,0)&&Object.is(gyDown,0)&&Object.is(gxLeft,0)&&Object.is(gyUp,0)) {
        this.correctedDivergence[i]=this.divergence[i]!;
        continue;
      }
      this.pressureGradientCells++;
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

  /** Starting from zero, positive Jacobi pressure can travel at most one
   * positive-weight edge per iteration. Cells outside this bounded closure
   * remain exactly zero. All retained cell arithmetic stays unchanged. */
  private pressureWorkset(iterations:number):number {
    const {cellCount,columns,cellSize}=this.field,marked=this.pressureMarked,cells=this.pressureCells;
    marked.fill(0);let count=0,maximumRhs=0,maximumWeight=0;
    for(let i=0;i<cellCount;i++) {
      const rhs=this.rhs[i]!,x=this.faceDensityX[i]!,y=this.faceDensityY[i]!;
      if(!Number.isFinite(rhs)||!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0)return -1;
      maximumRhs=Math.max(maximumRhs,rhs);maximumWeight=Math.max(maximumWeight,x,y);
      if(rhs>0){marked[i]=1;cells[count++]=i;}
    }
    // Preserve the exhaustive path for data that might overflow intermediate
    // products: zero * Infinity must not be silently turned into a skipped 0.
    const pressureBound=maximumRhs*cellSize*cellSize*Math.max(1,iterations)/EPSILON;
    if(!Number.isFinite(pressureBound)||!Number.isFinite(pressureBound*Math.max(1,maximumWeight)*8))return -1;
    let begin=0,end=count;
    for(let depth=1;depth<iterations&&begin<end;depth++) {
      for(let slot=begin;slot<end;slot++) {
        const i=cells[slot]!,left=i%columns>0?i-1:i,up=i>=columns?i-columns:i;
        if(left!==i&&this.faceDensityX[left]!>0&&!marked[left]){marked[left]=1;cells[count++]=left;}
        if(up!==i&&this.faceDensityY[up]!>0&&!marked[up]){marked[up]=1;cells[count++]=up;}
        if(this.faceDensityX[i]!>0&&!marked[i+1]){marked[i+1]=1;cells[count++]=i+1;}
        if(this.faceDensityY[i]!>0&&!marked[i+columns]){marked[i+columns]=1;cells[count++]=i+columns;}
      }
      begin=end;end=count;
    }
    return count;
  }

  private gather(state: AgentBuffer, desiredX: Float64Array, desiredY: Float64Array,
    options: CrowdFlowOptions): void {
    const count = this.field.cellCount;
    for (let a = 0; a < state.count; a++) {
      if (state.active[a] !== 1) continue;
      const channel=this.transferChannels[a]!,fraction=this.transferFractions[a]!;
      let x = 0;
      let y = 0;
      let weightSum = 0;
      let baseX = 0;
      let baseY = 0;
      let density = 0;
      for (let corner = 0; corner < 4; corner++) {
        const cell = this.transferCells[a*4+corner]!;
        const weight = this.transferWeights[a*4+corner]!;
        density += this.field.density[cell]! * weight;
        for (let side = 0; side < 2; side++) {
          const i = ((channel + side) % FLOW_CHANNELS) * count + cell;
          const w = weight * (side === 0 ? 1 - fraction : fraction);
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
