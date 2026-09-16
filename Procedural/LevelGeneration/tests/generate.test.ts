import { describe, expect, it } from "vitest";
import {
  BASES,
  DIRECTIONS,
  faceCorners,
  generate,
  normalizeGrid,
  type Vec3,
} from "../src/core/generate";
import single from "../fixtures/single.json";
import adjacent from "../fixtures/adjacent-x.json";
import sealed from "../fixtures/sealed-cavity.json";

// Independent cuboid boundary oracle: includes the bottom, never the cavity.
function boxFaces(size: Vec3): string[] {
  const ids: string[] = [];
  for (let x = 0; x < size[0]; x++)
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++) {
        const c = [x, y, z];
        for (let axis = 0; axis < 3; axis++) {
          if (c[axis] === size[axis] - 1)
            ids.push(`${c}|${["PX", "PY", "PZ"][axis]}`);
          if (c[axis] === 0) ids.push(`${c}|${["NX", "NY", "NZ"][axis]}`);
        }
      }
  return ids.sort();
}
describe("external shell vertical slice", () => {
  it.each([
    [single, [1, 1, 1], 6],
    [adjacent, [2, 1, 1], 10],
    [sealed, [3, 3, 3], 54],
  ] as const)(
    "exact faces and one owner per face (%s)",
    (grid, size, count) => {
      const result = generate(grid);
      expect(result.surfaces.map((s) => s.faceId).sort()).toEqual(
        boxFaces([...size] as Vec3),
      );
      expect(result.placements).toHaveLength(count);
      expect(new Set(result.placements.map((p) => p.faceId)).size).toBe(count);
      expect(
        result.placements.filter((p) => p.orientationId === "NY"),
      ).toHaveLength(size[0] * size[2]);
      expect(generate([...grid].reverse())).toEqual(result);
      expect(generate([...grid, ...grid])).toEqual(result);
    },
  );
  it("six integer bases and transformed coverage agree with actual cube planes", () => {
    const result = generate(single);
    expect(result.placements.map((p) => p.position2)).toEqual([
      [2, 1, 1],
      [0, 1, 1],
      [1, 2, 1],
      [1, 0, 1],
      [1, 1, 2],
      [1, 1, 0],
    ]);
    for (const direction of DIRECTIONS) {
      const { u, v, n } = BASES[direction];
      expect(
        [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ].map((x) => x || 0),
      ).toEqual(n);
      const axis = n.findIndex((x) => x !== 0);
      const corners = faceCorners([0, 0, 0], direction);
      expect(new Set(corners.map((c) => c.join(","))).size).toBe(4);
      for (const c of corners) {
        expect(c.every((x) => x === 0 || x === 1)).toBe(true);
        expect(c[axis]).toBe(n[axis] > 0 ? 1 : 0);
      }
    }
  });
  it("empty, invalid, negative and translated inputs", () => {
    expect(generate([]).placements).toEqual([]);
    for (const input of [
      null,
      [new Array(3)],
      [[0.5, 0, 0]],
      [[Infinity, 0, 0]],
      [[1_000_001, 0, 0]],
      [
        [0, 0, 0],
        [32, 0, 0],
      ],
    ])
      expect(() => generate(input)).toThrow();
    const shifted = generate([[-3, -7, 2]]);
    expect(shifted.placements.map((p) => p.position2)).toEqual(
      generate(single).placements.map((p) =>
        p.position2.map((n, a) => n + [-6, -14, 4][a]),
      ),
    );
  });
  it("accepts the exact coordinate/span limits and keeps flood fill inside the padded bounds", () => {
    expect(normalizeGrid([[1_000_000, 0, 0]])).toEqual([[1_000_000, 0, 0]]);
    const result = generate([
      [-1_000_000, 0, 0],
      [-999_969, 31, 31],
    ]);
    expect(result.counters.paddedCells).toBe(34 ** 3);
    expect(result.counters.exteriorAirCells).toBe(34 ** 3 - 2);
    expect(result.placements).toHaveLength(12);
  });
});
