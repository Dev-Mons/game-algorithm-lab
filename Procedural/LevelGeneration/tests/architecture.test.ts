import type {SelectionOptions} from '../src/core/selection';
import { expect, it } from "vitest";
import {

  analyzeVolume,
  selectTiles,
  BASES,
  DIRECTIONS,
  faceCenter2,
  faceCorners,
  validateCoverage,
  type Vec3,
} from "../src/core/generate";
import {
  createDocument,
  loadDocument,
  exportDocument,
  canonicalJSON,
  profileData,
} from "../src/core/document";
import { FIXTURES, box } from "../src/fixtures";
const generate=(grid:unknown,options:SelectionOptions={})=>selectTiles(analyzeVolume(grid,options.rolePolicy),options);
const options = { seed: 42, ...profileData("office"),architecture:undefined };

it("rejects incompatible analysis/selection policies and incomplete asset metadata", () => {
  const unitResult = analyzeVolume(FIXTURES.single.cells);
  expect(() => selectTiles(unitResult, options)).toThrow("role policy");
  expect(() => selectTiles(unitResult, { style: "environment-panels" })).toThrow(
    "require region-context",
  );
  const catalog = options.catalog.map((t) => ({ ...t }));
  delete catalog.find((t) => t.assetKey === "crafted.plaster")!.palette;
  expect(() =>
    generate(FIXTURES.facade.cells, { ...options, catalog }),
  ).toThrow("Invalid unit panel");
});
it("seed changes component palettes without changing facade layout or geometry", () => {
  const results = Array.from({ length: 6 }, (_, seed) =>
    generate(FIXTURES.facade.cells, { ...options, seed }),
  );
  expect(
    new Set(results.map((r) => r.traces[0].architecture!.palette)).size,
  ).toBeGreaterThan(1);
  for (const r of results) {
    expect(r.surfaces).toEqual(results[0].surfaces);
    expect(
      r.placements.map((p) => [
        p.faceId,
        p.position2,
        p.orientationId,
        p.ruleId,
      ]),
    ).toEqual(
      results[0].placements.map((p) => [
        p.faceId,
        p.position2,
        p.orientationId,
        p.ruleId,
      ]),
    );
  }
});

it("a low rectangular annex becomes one roof, while a surrounding platform remains terrace", () => {
  const unitResult = generate(FIXTURES.annex.cells),
    result = generate(FIXTURES.annex.cells, options);
  const annex = result.regions!.find((r) => r.regionId === "r:3,1,0|PY")!;
  expect(annex).toMatchObject({
    width: 4,
    height: 3,
    rectangular: true,
    coveredFaceCount: 0,
    tallBoundarySides: ["NX"],
    interpretation: "annex-roof",
  });
  expect(annex.faceIds).toEqual(
    box(4, 1, 3).map(([x, , z]) => `${x + 3},1,${z}|PY`),
  );
  expect(annex.boundaryEdges).toHaveLength(14);
  for (const id of annex.faceIds) {
    expect(unitResult.surfaces.find((s) => s.faceId === id)?.role).toBe("terrace");
    expect(result.surfaces.find((s) => s.faceId === id)?.role).toBe("roof");
  }
  expect(result.surfaces.map((s) => s.faceId)).toEqual(
    unitResult.surfaces.map((s) => s.faceId),
  );
  const terrace = generate(FIXTURES.terrace.cells, options).regions!.filter(
    (r) => r.interpretation === "terrace",
  );
  expect(terrace).toHaveLength(1);
  expect(terrace[0].faceIds).toHaveLength(21);
  expect(terrace[0].tallBoundarySides).toEqual(["PX", "NX", "PZ", "NZ"]);
});
it("narrow ledges remain terraces and overhanging cells prevent annex-roof inference", () => {
  const narrow = generate(FIXTURES.step.cells, options);
  expect(
    narrow.surfaces.find((s) => s.faceId === "0,0,0|PY")?.architecture
      ?.interpretation,
  ).toBe("terrace");
  const covered = generate(FIXTURES.coveredTop.cells, options);
  expect(covered.surfaces.find((s) => s.faceId === "1,0,0|PY")).toMatchObject({
    role: "terrace",
    architecture: { interpretation: "covered-terrace" },
  });
  const opening = generate(FIXTURES.opened.cells, options);
  expect(opening.surfaces.filter((s) => s.role === "terrace")).toHaveLength(2);
});
it("coplanar regions partition only exterior faces; all positions and coverage remain exact", () => {
  for (const fixture of Object.values(FIXTURES)) {
    const result = generate(fixture.cells, options),
      unitResult = generate(fixture.cells);
    const members = result.regions!.flatMap((r) => r.faceIds);
    expect(members.length).toBe(result.surfaces.length);
    expect(new Set(members)).toEqual(
      new Set(result.surfaces.map((s) => s.faceId)),
    );
    expect(
      validateCoverage(
        result.surfaces.map((s) => s.faceId),
        result.placements,
      ),
    ).toEqual([]);
    expect(result.counters.fallbackCount).toBe(0);
    expect(
      result.placements.map((p) => [p.faceId, p.position2, p.orientationId]),
    ).toEqual(
      unitResult.placements.map((p) => [p.faceId, p.position2, p.orientationId]),
    );
    for (const r of result.regions!) {
      const surfaces = r.faceIds.map(
        (id) => result.surfaces.find((s) => s.faceId === id)!,
      );
      const n = BASES[r.direction].n;
      expect(
        new Set(
          surfaces.map((s) =>
            faceCenter2(s.cell, s.direction).reduce(
              (sum, v, i) => sum + v * n[i],
              0,
            ),
          ),
        ).size,
      ).toBe(1);
    }
  }
});
it("unsupported contacts use basic coverage and remain degraded without architectural inference", () => {
  for (const name of ["edgeContact", "vertexContact"]) {
    const result = generate(FIXTURES[name].cells, options);
    expect(result.status).toBe("degraded");
    expect(result.placements).toHaveLength(12);
    expect(result.placements.every((p) => p.tileId.startsWith("panel."))).toBe(
      true,
    );
    expect(
      result.regions!.every((r) => r.interpretation === "unsupported"),
    ).toBe(true);
  }
});
it("region policy is deterministic under permutations and translations, and saved version is explicit", () => {
  const grid = FIXTURES.annex.cells,
    result = generate(grid, options);
  expect(
    generate([...grid].reverse(), {
      ...options,
      catalog: [...options.catalog].reverse(),
      rules: [...options.rules].reverse(),
    }),
  ).toEqual(result);
  const shifted = generate(
    grid.map((c) => c.map((n, a) => n + [-20, 12, -8][a]) as Vec3),
    options,
  );
  expect(
    shifted.surfaces.map((s) => [
      s.role,
      s.architecture!.column,
      s.architecture!.row,
      s.architecture!.facadeElement,
    ]),
  ).toEqual(
    result.surfaces.map((s) => [
      s.role,
      s.architecture!.column,
      s.architecture!.row,
      s.architecture!.facadeElement,
    ]),
  );
  const input = createDocument(grid, 42, "office");
  expect(input.schemaVersion).toBe(5);
  expect(input.algorithmVersion).toBe("environment-plans-v1");
  const loaded = loadDocument(exportDocument(input));
  expect(
    generate(loaded.grid, {
      seed: loaded.seed,
      ...profileData(loaded.catalog.id),architecture:undefined,
    }),
  ).toEqual(result);
  for (const change of [
    (d: any) => (d.algorithmVersion = "shell-v1"),
    (d: any) => (d.settings.minAnnexWidth = 1),
    (d: any) => (d.catalog.tiles.at(-1).palette = "unknown"),
    (d: any) => (d.style.id = "unit-panels"),
  ]) {
    const doc = structuredClone(input);
    change(doc);
    expect(() => loadDocument(JSON.stringify(doc))).toThrow();
  }
  expect(() => analyzeVolume(grid, "unknown" as any)).toThrow(
    "Unsupported role policy",
  );
});
