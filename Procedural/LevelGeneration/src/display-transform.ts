import { Matrix4, Vector3 } from "three";
import { BASES, type Direction, type Vec3 } from "./core/analysis";

// Apply the origin in double precision BEFORE uploading the instance matrix.
// GPU float translation of million-unit coordinates would erase thin relief.
export function setPlacementMatrix(
  matrix: Matrix4,
  position2: Vec3,
  direction: Direction,
  origin: Vector3,
  scale16: Vec3 = [16, 16, 16],
) {
  const { u, v, n } = BASES[direction],
    s = scale16.map((x) => x / 16);
  return matrix.set(
    u[0] * s[0],
    v[0] * s[1],
    n[0] * s[2],
    position2[0] / 2 + origin.x,
    u[1] * s[0],
    v[1] * s[1],
    n[1] * s[2],
    position2[1] / 2 + origin.y,
    u[2] * s[0],
    v[2] * s[1],
    n[2] * s[2],
    position2[2] / 2 + origin.z,
    0,
    0,
    0,
    1,
  );
}
