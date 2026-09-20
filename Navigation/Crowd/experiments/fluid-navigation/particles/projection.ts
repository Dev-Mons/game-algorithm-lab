import type { LinearRow, ProjectionResult } from './types';

/** Weighted Dykstra/dual coordinate ascent for ONE fixed convex problem.
 * Density slack is eliminated analytically: e_c = lambda_c / (eta A_c).
 * Every row and speed ball retains its correction; repeated untracked clamps
 * would not minimize distance to the original preferred velocity.
 */
export function projectVelocity(preferred: Float64Array, mass: Float64Array,
  rows: readonly LinearRow[], maxSpeed: number, tolerance = 1e-7, iterationLimit = 200): ProjectionResult {
  const velocity = preferred.slice(), dual = new Float64Array(rows.length);
  const slack = new Float64Array(rows.length), ballCorrection = new Float64Array(velocity.length);
  const denominator = Float64Array.from(rows, row => {
    let d = row.slackWeight ? 1/row.slackWeight : 0;
    for (let k = 0; k < row.indices.length; k++) d += row.values[k]!**2 / mass[row.indices[k]! >> 1]!;
    return d;
  });
  let primal = Infinity, stationarity = Infinity, complementarity = Infinity, iterations = 0;
  for (let iteration = 0; iteration < iterationLimit; iteration++) {
    iterations = iteration+1;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      let value = -row.bound;
      for (let k = 0; k < row.indices.length; k++) value += row.values[k]!*velocity[row.indices[k]!]!;
      if (row.slackWeight) value -= dual[r]!/row.slackWeight;
      if (denominator[r]! <= 1e-30) continue;
      const change = Math.max(-dual[r]!,value/denominator[r]!);
      if (!change) continue;
      dual[r] = dual[r]!+change;
      for (let k = 0; k < row.indices.length; k++) {
        const i = row.indices[k]!;
        velocity[i] = velocity[i]!-change*row.values[k]!/mass[i >> 1]!;
      }
    }
    for (let a = 0; a < mass.length; a++) {
      const x = velocity[2*a]!+ballCorrection[2*a]!;
      const y = velocity[2*a+1]!+ballCorrection[2*a+1]!;
      const scale = Math.min(1,maxSpeed/Math.max(1e-30,Math.hypot(x,y)));
      velocity[2*a] = x*scale; velocity[2*a+1] = y*scale;
      ballCorrection[2*a] = x*(1-scale); ballCorrection[2*a+1] = y*(1-scale);
    }
    primal = 0; complementarity = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      slack[r] = row.slackWeight ? dual[r]!/row.slackWeight : 0;
      let violation = -row.bound-slack[r]!;
      for (let k = 0; k < row.indices.length; k++) violation += row.values[k]!*velocity[row.indices[k]!]!;
      primal = Math.max(primal,violation);
      complementarity = Math.max(complementarity,Math.abs(dual[r]!*violation));
    }
    if (primal <= tolerance && complementarity <= tolerance) break;
  }
  // Reconstruct stationarity independently from the final multipliers.
  const gradient = Float64Array.from(velocity,(v,i) => mass[i >> 1]!*(v-preferred[i]!+ballCorrection[i]!));
  rows.forEach((row,r) => {
    for (let k = 0; k < row.indices.length; k++) {
      const i = row.indices[k]!;
      gradient[i] = gradient[i]!+dual[r]!*row.values[k]!;
    }
  });
  stationarity = gradient.reduce((m,g) => Math.max(m,Math.abs(g)),0);
  const finite = [...velocity,...dual].every(Number.isFinite);
  return {velocity,dual,slack,iterations,
    converged: finite && primal <= tolerance && complementarity <= tolerance && stationarity <= tolerance,
    primal,stationarity,complementarity,maxSlack: slack.reduce((a,b) => Math.max(a,b),0)};
}
