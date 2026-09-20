/**
 * Disc ORCA geometry derived from the velocity-obstacle definition in
 * van den Berg et al., Reciprocal n-body Collision Avoidance, §§4–5:
 * https://gamma.cs.unc.edu/ORCA/publications/ORCA.pdf
 * Original implementation here; no third-party source code was copied.
 * Polygon obstacle constraints are intentionally outside this module.
 */
export interface VelocityPlane { nx: number; ny: number; offset: number }
export interface Velocity { x: number; y: number }

const EPS = 1e-9;

/** Normal points into the permitted half-plane: n · velocity >= offset. */
export function discOrcaPlane(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
  radius: number, horizon: number, dt: number, responsibility: number,
  fallbackX = 1, fallbackY = 0,
): VelocityPlane {
  const vx = ax - bx;
  const vy = ay - by;
  const distance = Math.hypot(px, py);
  // A tangent pair is not an overlap. The short-horizon recovery circle alone
  // would allow endpoint-safe velocities that cross before dt at this boundary.
  const overlapping = distance < radius - 1e-7;
  const tau = overlapping ? dt : horizon;
  const cx = px / tau;
  const cy = py / tau;
  const cr = radius / tau;
  const wx = vx - cx;
  const wy = vy - cy;
  const length = Math.hypot(wx, wy);
  let nx = length > EPS ? wx / length : fallbackX;
  let ny = length > EPS ? wy / length : fallbackY;
  let boundaryX = cx + cr * nx;
  let boundaryY = cy + cr * ny;

  if (!overlapping && (length <= EPS || nx * px + ny * py > -radius)) {
    // The nearest cutoff-circle point is outside its visible arc. The closest
    // boundary lies on one of the two tangent rays, including their endpoints.
    // At the cutoff centre all directions tie: use a consistent tangent side
    // instead of purely braking both agents into an exact symmetric deadlock.
    const ux = px / distance;
    const uy = py / distance;
    const sine = Math.min(1, radius / distance);
    const cosine = Math.sqrt(Math.max(0, 1 - sine * sine));
    const rayStart = Math.sqrt(Math.max(0, distance * distance - radius * radius)) / tau;
    let best = Number.POSITIVE_INFINITY;
    for (const side of [1, -1]) {
      const qx = ux * cosine - side * uy * sine;
      const qy = uy * cosine + side * ux * sine;
      const along = Math.max(rayStart, vx * qx + vy * qy);
      const tx = qx * along;
      const ty = qy * along;
      const squared = (tx - vx) ** 2 + (ty - vy) ** 2;
      if (squared < best - EPS) {
        best = squared;
        boundaryX = tx;
        boundaryY = ty;
        nx = -side * qy;
        ny = side * qx;
      }
    }
  }
  const pointX = ax + responsibility * (boundaryX - vx);
  const pointY = ay + responsibility * (boundaryY - vy);
  return { nx, ny, offset: nx * pointX + ny * pointY };
}

/** Closest preferred velocity inside the speed disc and all half-planes. */
export function projectVelocity(
  planes: readonly VelocityPlane[], speed: number, preferredX: number, preferredY: number,
  slack = 0,
): Velocity | null {
  const preferredLength = Math.hypot(preferredX, preferredY);
  let x = preferredLength > speed ? preferredX * speed / preferredLength : preferredX;
  let y = preferredLength > speed ? preferredY * speed / preferredLength : preferredY;
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i]!;
    const offset = plane.offset - slack;
    if (plane.nx * x + plane.ny * y >= offset - EPS) continue;
    if (offset > speed + EPS) return null;
    // Offset below -speed cannot reject a point in the disc.
    const baseX = plane.nx * offset;
    const baseY = plane.ny * offset;
    const tx = -plane.ny;
    const ty = plane.nx;
    const extent = Math.sqrt(Math.max(0, speed * speed - offset * offset));
    let low = -extent;
    let high = extent;
    for (let j = 0; j < i; j++) {
      const other = planes[j]!;
      const amount = other.nx * tx + other.ny * ty;
      const required = other.offset - slack - other.nx * baseX - other.ny * baseY;
      if (Math.abs(amount) <= EPS) {
        if (required > EPS) return null;
      } else if (amount > 0) low = Math.max(low, required / amount);
      else high = Math.min(high, required / amount);
      if (low > high + EPS) return null;
    }
    const optimal = (preferredX - baseX) * tx + (preferredY - baseY) * ty;
    const along = Math.max(low, Math.min(high, optimal));
    x = baseX + tx * along;
    y = baseY + ty * along;
  }
  return { x, y };
}

/**
 * Infeasible dense configurations use a bounded minimax relaxation. This is an
 * explicit numerical variant of the paper's 3D fallback, not RVO2's exact LP3.
 */
export function solveOrcaVelocity(
  planes: readonly VelocityPlane[], speed: number, preferredX: number, preferredY: number,
): Velocity & { feasible: boolean } {
  const exact = projectVelocity(planes, speed, preferredX, preferredY);
  if (exact) return { ...exact, feasible: true };
  let low = 0;
  let high = 0;
  for (const plane of planes) high = Math.max(high, plane.offset + speed);
  let best: Velocity = { x: 0, y: 0 };
  for (let iteration = 0; iteration < 16; iteration++) {
    const slack = (low + high) * 0.5;
    const candidate = projectVelocity(planes, speed, preferredX, preferredY, slack);
    if (candidate) { high = slack; best = candidate; }
    else low = slack;
  }
  return { ...best, feasible: false };
}

/** Earliest hit of two swept discs in normalized step time; Infinity is clear. */
export function sweptDiscTime(
  relativeX: number, relativeY: number, displacementX: number, displacementY: number, radius: number,
): number {
  const c = relativeX ** 2 + relativeY ** 2 - radius ** 2;
  const approach = relativeX * displacementX + relativeY * displacementY;
  if (c <= EPS) return approach < -EPS ? 0 : Number.POSITIVE_INFINITY;
  if (approach >= 0) return Number.POSITIVE_INFINITY;
  const a = displacementX ** 2 + displacementY ** 2;
  if (a <= EPS) return Number.POSITIVE_INFINITY;
  const discriminant = approach ** 2 - a * c;
  if (discriminant <= EPS) return Number.POSITIVE_INFINITY;
  // Stable smaller quadratic root avoids cancellation at large distances.
  const time = c / (-approach + Math.sqrt(discriminant));
  return time >= 0 && time < 1 ? time : Number.POSITIVE_INFINITY;
}
