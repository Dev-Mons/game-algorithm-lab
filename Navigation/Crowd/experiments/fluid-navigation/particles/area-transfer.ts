import type { LinearRow, ParticleState } from './types';

interface Term { agent: number; weight: number; dx: number; dy: number }
function spline(x: number): [number, number] {
  const a = Math.abs(x), s = Math.sign(x);
  if (a < 1) return [2/3-a*a+.5*a*a*a, s*(-2*a+1.5*a*a)];
  if (a < 2) return [(2-a)**3/6, -s*(2-a)**2/2];
  return [0,0];
}

/** Smooth, radius-aware seven-point disk quadrature convolved with cubic B-splines.
 * This is an explicit quadrature approximation, not exact circle/cell intersection.
 * Boundary renormalization and its derivative preserve each disk's area exactly.
 */
export class AreaTransfer {
  readonly columns: number;
  readonly rows: number;
  readonly phi: Float64Array;
  readonly terms: Term[][];
  originX = 0;
  originY = 0;
  constructor(readonly width: number, readonly height: number, readonly h = 1) {
    this.columns = Math.ceil(width/h); this.rows = Math.ceil(height/h);
    this.phi = new Float64Array(this.columns*this.rows);
    this.terms = Array.from({length: this.phi.length}, () => []);
  }
  scatter(state: ParticleState, originX = 0, originY = 0): void {
    this.originX = originX; this.originY = originY;
    this.phi.fill(0);
    for (const row of this.terms) row.length = 0;
    for (let a = 0; a < state.x.length; a++) {
      const weights = new Map<number, [number,number,number]>();
      const r = state.radius[a]! * Math.sqrt(2/3);
      for (let q = 0; q < 7; q++) {
        const angle = (q-1)*Math.PI/3;
        const x = (state.x[a]!-originX+(q ? r*Math.cos(angle) : 0))/this.h-.5;
        const y = (state.y[a]!-originY+(q ? r*Math.sin(angle) : 0))/this.h-.5;
        const qw = q ? .125 : .25;
        for (let iy = Math.floor(y)-1; iy <= Math.floor(y)+2; iy++) {
          if (iy < 0 || iy >= this.rows) continue;
          const [wy,gy] = spline(y-iy);
          for (let ix = Math.floor(x)-1; ix <= Math.floor(x)+2; ix++) {
            if (ix < 0 || ix >= this.columns) continue;
            const [wx,gx] = spline(x-ix), cell = iy*this.columns+ix;
            const entry = weights.get(cell) ?? [0,0,0];
            entry[0] += qw*wx*wy; entry[1] += qw*gx*wy/this.h; entry[2] += qw*wx*gy/this.h;
            weights.set(cell,entry);
          }
        }
      }
      let total = 0, dx = 0, dy = 0;
      for (const w of weights.values()) { total += w[0]; dx += w[1]; dy += w[2]; }
      if (total < 1e-12) throw new Error(`Disk ${a} outside transfer grid`);
      const areaScale = state.mass[a]!/(this.h*this.h);
      for (const [cell,w] of weights) {
        const weight = w[0]/total;
        this.phi[cell] = this.phi[cell]!+areaScale*weight;
        this.terms[cell]!.push({agent: a, weight,
          dx: areaScale*(w[1]*total-w[0]*dx)/(total*total),
          dy: areaScale*(w[2]*total-w[0]*dy)/(total*total)});
      }
    }
  }
  jacobian(velocity: Float64Array): Float64Array {
    return Float64Array.from(this.terms, terms => terms.reduce((sum,t) =>
      sum+t.dx*velocity[2*t.agent]!+t.dy*velocity[2*t.agent+1]!,0));
  }
  transpose(pressure: Float64Array, count: number): Float64Array {
    const result = new Float64Array(2*count);
    this.terms.forEach((terms,cell) => {
      for (const t of terms) {
        result[2*t.agent] = result[2*t.agent]!+t.dx*pressure[cell]!;
        result[2*t.agent+1] = result[2*t.agent+1]!+t.dy*pressure[cell]!;
      }
    });
    return result;
  }
  constraints(dt: number, gridSpeed: number, cap: number, eta = 100): LinearRow[] {
    const result: LinearRow[] = [];
    this.terms.forEach((terms,cell) => {
      if (!terms.length) return;
      const indices: number[] = [], values: number[] = [];
      let frameDerivative = 0;
      for (const t of terms) {
        indices.push(2*t.agent,2*t.agent+1); values.push(dt*t.dx,dt*t.dy);
        frameDerivative += t.dx*gridSpeed;
      }
      result.push({indices,values,bound: cap-this.phi[cell]!+dt*frameDerivative,
        slackWeight: eta*this.h*this.h,cell,kind: 'density'});
    });
    return result;
  }
}
