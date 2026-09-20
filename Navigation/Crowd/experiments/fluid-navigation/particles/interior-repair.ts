import { AreaTransfer } from './area-transfer';
import type { ParticleScene, ParticleState } from './types';

export interface RepairResult {
  velocity: Float64Array;
  patchDensity: number;
  fluxBalance: number;
  insufficientMass: boolean;
}

/** P2a oracle region only. No automatic interior detection is claimed here.
 * Opposite face fluxes conserve area on the grid. Particle gather is an intent;
 * actual transported density is always recomputed after collision projection.
 */
export function interiorRepair(field: AreaTransfer, state: ParticleState,
  scene: ParticleScene, dt: number): RepairResult {
  const mask = new Uint8Array(field.phi.length), count = field.phi.length;
  const fx = new Float64Array(count), fy = new Float64Array(count), balance = new Float64Array(count);
  const {columns,rows,h} = field, region = scene.repairRegion;
  let mass = 0, cells = 0;
  const inside = (x: number,y: number) => 'radius' in region
    ? Math.hypot(x-region.x,y-region.y) <= region.radius
    : x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  for (let c = 0; c < count; c++) {
    if (inside((c%columns+.5)*h,(Math.floor(c/columns)+.5)*h)) {
      mask[c] = 1; mass += field.phi[c]!; cells++;
    }
  }
  const patchDensity = mass/Math.max(1,cells);
  const result = {velocity: new Float64Array(state.velocity.length),patchDensity,
    fluxBalance: 0,insufficientMass: patchDensity < .60};
  if (result.insufficientMass) return result;
  const speed = .15*scene.speed;
  const face = (c: number,n: number): number => {
    if (!mask[c] || !mask[n]) return 0;
    const raw = -.6*(field.phi[n]!-field.phi[c]!)/h;
    const donor = raw > 0 ? field.phi[c]! : field.phi[n]!;
    const limit = Math.min(donor*h/(4*dt),speed*(field.phi[c]!+field.phi[n]!)*.5);
    const flux = Math.sign(raw)*Math.min(Math.abs(raw),limit);
    balance[c] = balance[c]!-flux*dt*h; balance[n] = balance[n]!+flux*dt*h;
    return flux;
  };
  for (let c = 0; c < count; c++) {
    if (c%columns+1 < columns) fx[c] = face(c,c+1);
    if (Math.floor(c/columns)+1 < rows) fy[c] = face(c,c+columns);
  }
  const bx = new Float64Array(count), by = new Float64Array(count);
  for (let c = 0; c < count; c++) {
    if (!mask[c]) continue;
    const density = Math.max(.05,field.phi[c]!);
    bx[c] = .5*(fx[c]!+(c%columns ? fx[c-1]! : 0))/density;
    by[c] = .5*(fy[c]!+(c >= columns ? fy[c-columns]! : 0))/density;
    const scale = Math.min(1,speed/Math.max(1e-30,Math.hypot(bx[c]!,by[c]!)));
    bx[c] = bx[c]!*scale; by[c] = by[c]!*scale;
    for (const term of field.terms[c]!) {
      const i = 2*term.agent;
      result.velocity[i] = result.velocity[i]!+term.weight*bx[c]!;
      result.velocity[i+1] = result.velocity[i+1]!+term.weight*by[c]!;
    }
  }
  for (let a = 0; a < state.x.length; a++) {
    const x = state.x[a]!-field.originX, y = state.y[a]!-field.originY;
    if (!inside(x,y)) { result.velocity[2*a] = 0; result.velocity[2*a+1] = 0; continue; }
    // Oracle outer boundary: suppress its normal intent smoothly, retain tangents.
    // This is part of the supplied P2a support, not an inferred free surface.
    const sx = Math.max(0,Math.min(1,(Math.min(x-scene.support.minX,scene.support.maxX-x)-state.radius[a]!)));
    const sy = Math.max(0,Math.min(1,(Math.min(y-scene.support.minY,scene.support.maxY-y)-state.radius[a]!)));
    result.velocity[2*a] = result.velocity[2*a]!*sx;
    result.velocity[2*a+1] = result.velocity[2*a+1]!*sy;
  }
  result.fluxBalance = balance.reduce((a,b) => a+b,0);
  return result;
}
