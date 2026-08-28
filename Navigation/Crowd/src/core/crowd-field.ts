import type { AgentBuffer } from './agent-state';
import { clamp } from './math';
import type { Rect, Vec2 } from './types';

const EPSILON = 1e-9;
const OCCUPIED_DENSITY = 0.01;

/**
 * Reusable low-resolution Eulerian crowd field.
 *
 * Coordinates outside the world are clamped to the nearest field sample.
 * Blocked cells never receive deposits. Blur and gradient stencils use the
 * current cell value for blocked/out-of-bounds neighbours (a no-flux rule), so
 * an obstacle cannot create an artificial low-pressure attraction.
 */
export class CrowdField {
  readonly columns: number;
  readonly rows: number;
  readonly cellCount: number;
  readonly density: Float64Array;
  readonly momentumX: Float64Array;
  readonly momentumY: Float64Array;
  readonly averageVelocityX: Float64Array;
  readonly averageVelocityY: Float64Array;
  readonly pressure: Float64Array;
  readonly gradientX: Float64Array;
  readonly gradientY: Float64Array;
  readonly counterFlow: Float64Array;
  readonly overloadAge: Float64Array;
  readonly blocked: Uint8Array;
  occupiedCellCount = 0;
  overloadedCellCount = 0;
  maximumOverloadAge = 0;

  private readonly desiredX: Float64Array;
  private readonly desiredY: Float64Array;
  private readonly smoothDensity: Float64Array;
  private readonly smoothMomentumX: Float64Array;
  private readonly smoothMomentumY: Float64Array;
  private readonly smoothDesiredX: Float64Array;
  private readonly smoothDesiredY: Float64Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cellSize: number,
  ) {
    if (!(width > 0) || !(height > 0) || !(cellSize > 0)) {
      throw new RangeError('CrowdField dimensions and cellSize must be positive.');
    }
    this.columns = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellCount = this.columns * this.rows;
    this.density = new Float64Array(this.cellCount);
    this.momentumX = new Float64Array(this.cellCount);
    this.momentumY = new Float64Array(this.cellCount);
    this.averageVelocityX = new Float64Array(this.cellCount);
    this.averageVelocityY = new Float64Array(this.cellCount);
    this.pressure = new Float64Array(this.cellCount);
    this.gradientX = new Float64Array(this.cellCount);
    this.gradientY = new Float64Array(this.cellCount);
    this.counterFlow = new Float64Array(this.cellCount);
    this.overloadAge = new Float64Array(this.cellCount);
    this.blocked = new Uint8Array(this.cellCount);
    this.desiredX = new Float64Array(this.cellCount);
    this.desiredY = new Float64Array(this.cellCount);
    this.smoothDensity = new Float64Array(this.cellCount);
    this.smoothMomentumX = new Float64Array(this.cellCount);
    this.smoothMomentumY = new Float64Array(this.cellCount);
    this.smoothDesiredX = new Float64Array(this.cellCount);
    this.smoothDesiredY = new Float64Array(this.cellCount);
  }

  setObstacles(obstacles: readonly Rect[], clearance = 0): void {
    this.blocked.fill(0);
    for (let row = 0; row < this.rows; row += 1) {
      const y = Math.min(this.height, (row + 0.5) * this.cellSize);
      for (let column = 0; column < this.columns; column += 1) {
        const x = Math.min(this.width, (column + 0.5) * this.cellSize);
        for (const obstacle of obstacles) {
          if (
            x < obstacle.x - clearance
            || x > obstacle.x + obstacle.width + clearance
            || y < obstacle.y - clearance
            || y > obstacle.y + obstacle.height + clearance
          ) continue;
          this.blocked[row * this.columns + column] = 1;
          break;
        }
      }
    }
  }

  reset(): void {
    this.clearDynamicBuffers();
    this.overloadAge.fill(0);
    this.occupiedCellCount = 0;
    this.overloadedCellCount = 0;
    this.maximumOverloadAge = 0;
  }

  update(state: AgentBuffer, pressureThreshold: number, fixedDelta: number): void {
    this.clearDynamicBuffers();
    for (let agent = 0; agent < state.count; agent += 1) {
      if (state.active[agent] !== 1) continue;
      this.deposit(
        state.x[agent]!,
        state.y[agent]!,
        state.vx[agent]!,
        state.vy[agent]!,
        state.intentX[agent]!,
        state.intentY[agent]!,
      );
    }
    this.blurHorizontal();
    this.blurVertical();
    this.finishCells(Math.max(EPSILON, pressureThreshold), Math.max(0, fixedDelta));
    this.computeGradients();
  }

  sampleDensity(x: number, y: number): number {
    return this.sample(this.density, x, y);
  }

  samplePressureGradient(x: number, y: number, out: Vec2): void {
    out.x = this.sample(this.gradientX, x, y);
    out.y = this.sample(this.gradientY, x, y);
  }

  sampleAverageVelocity(x: number, y: number, out: Vec2): void {
    out.x = this.sample(this.averageVelocityX, x, y);
    out.y = this.sample(this.averageVelocityY, x, y);
  }

  sampleCounterFlow(x: number, y: number, desiredX: number, desiredY: number): number {
    const desiredLength = Math.hypot(desiredX, desiredY);
    if (desiredLength <= EPSILON) return 0;
    const averageX = this.sample(this.averageVelocityX, x, y);
    const averageY = this.sample(this.averageVelocityY, x, y);
    return Math.max(0, -(averageX * desiredX + averageY * desiredY) / desiredLength);
  }

  sampleStoredCounterFlow(x: number, y: number): number {
    return this.sample(this.counterFlow, x, y);
  }

  sampleOverloadAge(x: number, y: number): number {
    return this.sample(this.overloadAge, x, y);
  }

  private clearDynamicBuffers(): void {
    this.density.fill(0);
    this.momentumX.fill(0);
    this.momentumY.fill(0);
    this.averageVelocityX.fill(0);
    this.averageVelocityY.fill(0);
    this.pressure.fill(0);
    this.gradientX.fill(0);
    this.gradientY.fill(0);
    this.counterFlow.fill(0);
    this.desiredX.fill(0);
    this.desiredY.fill(0);
    this.smoothDensity.fill(0);
    this.smoothMomentumX.fill(0);
    this.smoothMomentumY.fill(0);
    this.smoothDesiredX.fill(0);
    this.smoothDesiredY.fill(0);
  }

  private deposit(
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
    intentX: number,
    intentY: number,
  ): void {
    const gridX = clamp(x / this.cellSize - 0.5, 0, this.columns - 1);
    const gridY = clamp(y / this.cellSize - 0.5, 0, this.rows - 1);
    const column0 = Math.floor(gridX);
    const row0 = Math.floor(gridY);
    const column1 = Math.min(this.columns - 1, column0 + 1);
    const row1 = Math.min(this.rows - 1, row0 + 1);
    const tx = gridX - column0;
    const ty = gridY - row0;
    const index00 = row0 * this.columns + column0;
    const index10 = row0 * this.columns + column1;
    const index01 = row1 * this.columns + column0;
    const index11 = row1 * this.columns + column1;
    const weight00 = (1 - tx) * (1 - ty);
    const weight10 = tx * (1 - ty);
    const weight01 = (1 - tx) * ty;
    const weight11 = tx * ty;
    const availableWeight = (this.blocked[index00] === 0 ? weight00 : 0)
      + (this.blocked[index10] === 0 ? weight10 : 0)
      + (this.blocked[index01] === 0 ? weight01 : 0)
      + (this.blocked[index11] === 0 ? weight11 : 0);
    if (availableWeight <= EPSILON) return;
    const inverseWeight = 1 / availableWeight;
    this.addDeposit(index00, weight00 * inverseWeight, velocityX, velocityY, intentX, intentY);
    this.addDeposit(index10, weight10 * inverseWeight, velocityX, velocityY, intentX, intentY);
    this.addDeposit(index01, weight01 * inverseWeight, velocityX, velocityY, intentX, intentY);
    this.addDeposit(index11, weight11 * inverseWeight, velocityX, velocityY, intentX, intentY);
  }

  private addDeposit(
    index: number,
    weight: number,
    velocityX: number,
    velocityY: number,
    intentX: number,
    intentY: number,
  ): void {
    if (weight <= 0 || this.blocked[index] === 1) return;
    this.density[index] = this.density[index]! + weight;
    this.momentumX[index] = this.momentumX[index]! + velocityX * weight;
    this.momentumY[index] = this.momentumY[index]! + velocityY * weight;
    this.desiredX[index] = this.desiredX[index]! + intentX * weight;
    this.desiredY[index] = this.desiredY[index]! + intentY * weight;
  }

  private blurHorizontal(): void {
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (this.blocked[index] === 1) continue;
        const left = column > 0 && this.blocked[index - 1] === 0 ? index - 1 : index;
        const right = column + 1 < this.columns && this.blocked[index + 1] === 0
          ? index + 1
          : index;
        this.smoothDensity[index] = (
          this.density[left]! + this.density[index]! * 2 + this.density[right]!
        ) * 0.25;
        this.smoothMomentumX[index] = (
          this.momentumX[left]! + this.momentumX[index]! * 2 + this.momentumX[right]!
        ) * 0.25;
        this.smoothMomentumY[index] = (
          this.momentumY[left]! + this.momentumY[index]! * 2 + this.momentumY[right]!
        ) * 0.25;
        this.smoothDesiredX[index] = (
          this.desiredX[left]! + this.desiredX[index]! * 2 + this.desiredX[right]!
        ) * 0.25;
        this.smoothDesiredY[index] = (
          this.desiredY[left]! + this.desiredY[index]! * 2 + this.desiredY[right]!
        ) * 0.25;
      }
    }
  }

  private blurVertical(): void {
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (this.blocked[index] === 1) continue;
        const up = row > 0 && this.blocked[index - this.columns] === 0
          ? index - this.columns
          : index;
        const down = row + 1 < this.rows && this.blocked[index + this.columns] === 0
          ? index + this.columns
          : index;
        this.density[index] = (
          this.smoothDensity[up]! + this.smoothDensity[index]! * 2 + this.smoothDensity[down]!
        ) * 0.25;
        this.momentumX[index] = (
          this.smoothMomentumX[up]!
          + this.smoothMomentumX[index]! * 2
          + this.smoothMomentumX[down]!
        ) * 0.25;
        this.momentumY[index] = (
          this.smoothMomentumY[up]!
          + this.smoothMomentumY[index]! * 2
          + this.smoothMomentumY[down]!
        ) * 0.25;
        this.desiredX[index] = (
          this.smoothDesiredX[up]! + this.smoothDesiredX[index]! * 2 + this.smoothDesiredX[down]!
        ) * 0.25;
        this.desiredY[index] = (
          this.smoothDesiredY[up]! + this.smoothDesiredY[index]! * 2 + this.smoothDesiredY[down]!
        ) * 0.25;
      }
    }
  }

  private finishCells(pressureThreshold: number, fixedDelta: number): void {
    this.occupiedCellCount = 0;
    this.overloadedCellCount = 0;
    this.maximumOverloadAge = 0;
    for (let index = 0; index < this.cellCount; index += 1) {
      if (this.blocked[index] === 1) {
        this.overloadAge[index] = 0;
        continue;
      }
      const density = this.density[index]!;
      if (density > OCCUPIED_DENSITY) this.occupiedCellCount += 1;
      if (density > EPSILON) {
        const inverseDensity = 1 / density;
        this.averageVelocityX[index] = this.momentumX[index]! * inverseDensity;
        this.averageVelocityY[index] = this.momentumY[index]! * inverseDensity;
        const desiredX = this.desiredX[index]!;
        const desiredY = this.desiredY[index]!;
        const desiredLength = Math.hypot(desiredX, desiredY);
        this.counterFlow[index] = desiredLength > EPSILON
          ? Math.max(0, -(
              this.averageVelocityX[index]! * desiredX
              + this.averageVelocityY[index]! * desiredY
            ) / desiredLength)
          : 0;
      }
      const excessRatio = Math.max(0, density / pressureThreshold - 1);
      this.pressure[index] = excessRatio * excessRatio;
      if (density > pressureThreshold) {
        this.overloadAge[index] = this.overloadAge[index]! + fixedDelta;
        this.overloadedCellCount += 1;
      } else {
        this.overloadAge[index] = 0;
      }
      this.maximumOverloadAge = Math.max(this.maximumOverloadAge, this.overloadAge[index]!);
    }
  }

  private computeGradients(): void {
    const inverseSpan = 1 / (2 * this.cellSize);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        if (this.blocked[index] === 1) continue;
        const left = column > 0 && this.blocked[index - 1] === 0 ? index - 1 : index;
        const right = column + 1 < this.columns && this.blocked[index + 1] === 0
          ? index + 1
          : index;
        const up = row > 0 && this.blocked[index - this.columns] === 0
          ? index - this.columns
          : index;
        const down = row + 1 < this.rows && this.blocked[index + this.columns] === 0
          ? index + this.columns
          : index;
        this.gradientX[index] = (this.pressure[right]! - this.pressure[left]!) * inverseSpan;
        this.gradientY[index] = (this.pressure[down]! - this.pressure[up]!) * inverseSpan;
      }
    }
  }

  private sample(buffer: Float64Array, x: number, y: number): number {
    const gridX = clamp(x / this.cellSize - 0.5, 0, this.columns - 1);
    const gridY = clamp(y / this.cellSize - 0.5, 0, this.rows - 1);
    const column0 = Math.floor(gridX);
    const row0 = Math.floor(gridY);
    const column1 = Math.min(this.columns - 1, column0 + 1);
    const row1 = Math.min(this.rows - 1, row0 + 1);
    const tx = gridX - column0;
    const ty = gridY - row0;
    const index00 = row0 * this.columns + column0;
    const index10 = row0 * this.columns + column1;
    const index01 = row1 * this.columns + column0;
    const index11 = row1 * this.columns + column1;
    return buffer[index00]! * (1 - tx) * (1 - ty)
      + buffer[index10]! * tx * (1 - ty)
      + buffer[index01]! * (1 - tx) * ty
      + buffer[index11]! * tx * ty;
  }
}
