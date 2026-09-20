import type { Box, LinearRow, ParticleState } from './types';

/** Deliberately exhaustive reference broad phase: no candidate/pair cap. */
export function contactRows(state: ParticleState, dt: number, maxSpeed: number,
  world: Box, endpoint = false): LinearRow[] {
  const rows: LinearRow[] = [];
  for (let i = 0; i < state.x.length; i++) {
    for (let j = 0; j < i; j++) {
      const dx = state.x[i]!-state.x[j]!, dy = state.y[i]!-state.y[j]!;
      const distance = Math.hypot(dx,dy), radius = state.radius[i]!+state.radius[j]!;
      const gap = distance-radius;
      if (gap > (endpoint ? 1e-7 : 2*maxSpeed*dt)) continue;
      if (distance < 1e-12) throw new Error('Coincident disks are invalid initial geometry');
      const nx = dx/distance, ny = dy/distance;
      rows.push({indices: [2*i,2*i+1,2*j,2*j+1],values: [-nx,-ny,nx,ny],
        bound: endpoint ? 0 : gap/dt,kind: 'contact'});
    }
    const r = state.radius[i]!;
    const walls = [
      [2*i,-1,state.x[i]!-r-world.minX], [2*i,1,world.maxX-state.x[i]!-r],
      [2*i+1,-1,state.y[i]!-r-world.minY], [2*i+1,1,world.maxY-state.y[i]!-r],
    ];
    for (const [index,normal,gap] of walls) {
      if (gap! <= (endpoint ? 1e-7 : maxSpeed*dt)) {
        rows.push({indices: [index!],values: [normal!],bound: endpoint ? 0 : gap!/dt,kind: 'wall'});
      }
    }
  }
  return rows;
}

export function penetration(state: ParticleState, world?: Box): number {
  let max = 0;
  for (let i = 0; i < state.x.length; i++) {
    if (world) max = Math.max(max,world.minX+state.radius[i]!-state.x[i]!,
      state.x[i]!+state.radius[i]!-world.maxX,world.minY+state.radius[i]!-state.y[i]!,
      state.y[i]!+state.radius[i]!-world.maxY);
    for (let j = 0; j < i; j++) max = Math.max(max,state.radius[i]!+state.radius[j]!
      -Math.hypot(state.x[i]!-state.x[j]!,state.y[i]!-state.y[j]!));
  }
  return max;
}

/** Continuous closest approach for every swept candidate, independent of solve normals. */
export function sweptPenetration(state: ParticleState, velocity: Float64Array, dt: number): number {
  let max = 0;
  for (let i = 0; i < state.x.length; i++) for (let j = 0; j < i; j++) {
    const x = state.x[i]!-state.x[j]!, y = state.y[i]!-state.y[j]!;
    const vx = (velocity[2*i]!-velocity[2*j]!)*dt;
    const vy = (velocity[2*i+1]!-velocity[2*j+1]!)*dt;
    const t = Math.max(0,Math.min(1,-(x*vx+y*vy)/Math.max(1e-30,vx*vx+vy*vy)));
    max = Math.max(max,state.radius[i]!+state.radius[j]!-Math.hypot(x+t*vx,y+t*vy));
  }
  return max;
}
