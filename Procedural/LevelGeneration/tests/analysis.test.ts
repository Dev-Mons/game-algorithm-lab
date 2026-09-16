import { expect, it } from "vitest";
import { generate, type Vec3 } from "../src/core/generate";
import { FIXTURES, box } from "../src/fixtures";

it.each([
  ["cube", 24, { wall: 16, roof: 4, underside: 4 }],
  ["l", 14, { wall: 8, roof: 3, underside: 3 }],
  ["step", 14, { wall: 10, roof: 1, terrace: 1, underside: 2 }],
  ["overhang", 14, { wall: 10, roof: 2, underside: 2 }],
  ["sealed", 54, { wall: 36, roof: 9, underside: 9 }],
  ["opened", 62, { wall: 40, roof: 9, terrace: 2, underside: 11 }],
] as const)("%s exact boundary and role counts", (name, count, roles) => {
  const result = generate(FIXTURES[name].cells);
  expect(result.status).toBe("ok");
  expect(result.surfaces).toHaveLength(count);
  expect(
    result.surfaces.reduce<Record<string, number>>((acc, s) => {
      acc[s.role] = (acc[s.role] ?? 0) + 1;
      return acc;
    }, {}),
  ).toEqual(roles);
  expect(new Set(result.placements.map((p) => p.faceId))).toEqual(
    new Set(result.surfaces.map((s) => s.faceId)),
  );
  // Outside the sealed case, all empty adjacent cells are reachable for these fixtures.
  if (name !== "sealed") {
    const occupied = new Set(FIXTURES[name].cells.map((c) => c.join(","))),
      expected: string[] = [];
    const offsets = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const c of FIXTURES[name].cells)
      offsets.forEach((offset, i) => {
        if (!occupied.has(c.map((n, a) => n + offset[a]).join(",")))
          expected.push(`${c}|${["PX", "NX", "PY", "NY", "PZ", "NZ"][i]}`);
      });
    expect(result.surfaces.map((s) => s.faceId).sort()).toEqual(
      expected.sort(),
    );
  }
});
it("classifies exact convex, flat and concave edge positions", () => {
  const l = generate(FIXTURES.l.cells);
  expect(l.features.find((e) => e.edgeId === "1,0,1:1,1,1")?.kind).toBe(
    "concave",
  );
  expect(l.features.find((e) => e.edgeId === "0,0,0:0,1,0")?.kind).toBe(
    "convex",
  );
  expect(l.features.find((e) => e.edgeId === "1,1,0:1,1,1")?.kind).toBe("flat");
  expect(
    generate([[0, 0, 0]]).features.filter((e) => e.kind === "convex"),
  ).toHaveLength(12);
});
it("component heights, lower annex, covered terrace, and translation stay consistent", () => {
  const separated = generate(FIXTURES.separated.cells);
  expect(separated.surfaces.find((s) => s.faceId === "3,0,0|PY")?.role).toBe(
    "roof",
  );
  expect(separated.counters.componentCount).toBe(2);
  const overhang = generate(FIXTURES.overhang.cells);
  expect(
    overhang.surfaces
      .filter((s) => s.role === "underside")
      .map((s) => s.undersideKind),
  ).toEqual(["base", "overhang"]);
  const covered = generate([
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
    [1, 0, 0],
    [1, 2, 0],
  ]);
  expect(covered.surfaces.find((s) => s.faceId === "1,0,0|PY")?.role).toBe(
    "terrace",
  );
  const grid = box(3, 1, 3).concat([[0, 1, 0]]),
    original = generate(grid);
  const shifted = generate(
    grid.map((c) => c.map((n, a) => n + [-12, 47, -6][a]) as Vec3),
  );
  expect(shifted.surfaces.map((s) => s.role)).toEqual(
    original.surfaces.map((s) => s.role),
  );
  expect(shifted.features.map((e) => e.kind)).toEqual(
    original.features.map((e) => e.kind),
  );
});
it("edge/vertex-only contacts keep all faces and report the exact unsupported location", () => {
  for (const [name, code, location] of [
    ["edgeContact", "NON_MANIFOLD_EDGE", "1,1,0:1,1,1"],
    ["vertexContact", "NON_MANIFOLD_VERTEX", "1,1,1"],
  ]) {
    const result = generate(FIXTURES[name].cells);
    expect(result.status).toBe("degraded");
    expect(result.placements).toHaveLength(12);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, location }),
    );
  }
});
it("an edge or point gap does not connect a sealed cavity to exterior air", () => {
  const cavityFaces = [
    "0,1,1|PX",
    "2,1,1|NX",
    "1,0,1|PY",
    "1,2,1|NY",
    "1,1,0|PZ",
    "1,1,2|NZ",
  ];
  for (const [removed, count] of [
    ["0,0,0", 54],
    ["1,0,0", 56],
  ] as const) {
    const result = generate(
      FIXTURES.sealed.cells.filter((c) => c.join(",") !== removed),
    );
    expect(result.surfaces).toHaveLength(count);
    expect(result.surfaces.some((s) => cavityFaces.includes(s.faceId))).toBe(
      false,
    );
  }
});
