import { expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";
import {
  BASES,
  faceCorners,
  generate,
  MODULE_ASSETS,
  type Vec3,
} from "../src/core/generate";
import {
  profileData,
  createDocument,
  exportDocument,
} from "../src/core/document";
import { buildCraftedGeometry } from "../src/crafted-geometry";
import { setPlacementMatrix } from "../src/display-transform";
import { FIXTURES } from "../src/fixtures";

it("corner prototype vertices/normals match precisely the two replaced grid faces", () => {
  const result = generate(FIXTURES.facade.cells, {
    ...profileData("crafted-hip"),
  });
  for (const module of result.modules!.filter((m) =>
    m.assetKey.startsWith("corner."),
  )) {
    const parts = buildCraftedGeometry(module.assetKey),
      p = parts.panel.getAttribute("position"),
      normals = parts.panel.getAttribute("normal");
    const matrix = setPlacementMatrix(
      new Matrix4(),
      module.position2,
      module.orientationId,
      new Vector3(),
    );
    const vertices = new Set<string>();
    for (let i = 0; i < p.count; i++) {
      const point = new Vector3()
        .fromBufferAttribute(p, i)
        .applyMatrix4(matrix);
      vertices.add(
        point
          .toArray()
          .map((n) => Math.round(n * 1e6) / 1e6)
          .join(","),
      );
      const normal = new Vector3()
        .fromBufferAttribute(normals, i)
        .transformDirection(matrix);
      expect(
        module.faceIds.some(
          (id) =>
            normal.dot(
              new Vector3(
                ...BASES[
                  result.surfaces.find((s) => s.faceId === id)!.direction
                ].n,
              ),
            ) > 0.99999,
        ),
      ).toBe(true);
    }
    const expected = new Set(
      module.faceIds.flatMap((id) => {
        const s = result.surfaces.find((s) => s.faceId === id)!;
        return faceCorners(s.cell, s.direction).map((c) => c.join(","));
      }),
    );
    expect(vertices).toEqual(expected);
    parts.panel.dispose();
    parts.relief?.dispose();
  }
});
it("roof projected triangles cover the unit footprint exactly once and meet the four base corners", () => {
  for (const asset of MODULE_ASSETS.filter((a) =>
    a.assetKey.startsWith("roof."),
  )) {
    const parts = buildCraftedGeometry(asset.assetKey),
      p = parts.panel.getAttribute("position");
    const triangles: number[][][] = [];
    for (let i = 0; i < p.count; i += 3)
      triangles.push([0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k)]));
    const cross = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 16; y++) {
        const point = [(x + 0.37) / 16 - 0.5, (y + 0.29) / 16 - 0.5];
        const count = triangles.filter((t) =>
          [0, 1, 2].every((i) => cross(t[i], t[(i + 1) % 3], point) > -1e-8),
        ).length;
        expect(count).toBe(1);
      }
    const base = new Set<string>(),
      q = parts.relief!.getAttribute("position");
    for (let i = 0; i < q.count; i++)
      if (Math.abs(q.getZ(i)) < 1e-8)
        base.add(
          [q.getX(i), q.getY(i)].map((n) => Math.round(n * 2) / 2).join(","),
        );
    expect(base).toEqual(
      new Set(["-0.5,-0.5", "0.5,-0.5", "0.5,0.5", "-0.5,0.5"]),
    );
    parts.panel.dispose();
    parts.relief!.dispose();
  }
});
it("large-coordinate display origin preserves identical GPU transforms and thin relief", () => {
  for (const direction of ["PX", "NX", "PY", "NY", "PZ", "NZ"] as const) {
    const a = setPlacementMatrix(
      new Matrix4(),
      [1, 1, 0],
      direction,
      new Vector3(-0.5, -0.5, -0.5),
    );
    const b = setPlacementMatrix(
      new Matrix4(),
      [2_000_001, 1, -2_000_000],
      direction,
      new Vector3(-1_000_000.5, -0.5, 999_999.5),
    );
    expect([...new Float32Array(a.elements)]).toEqual([
      ...new Float32Array(b.elements),
    ]);
    const vertices = [
      [0, 0, 0],
      [0, 0, 1 / 32],
    ].map((v) => new Vector3(...(v as Vec3)).applyMatrix4(b));
    expect(vertices[0].distanceTo(vertices[1])).toBeCloseTo(1 / 32, 12);
  }
});
it("module metadata is canonical and cannot mutate the registered catalog through a document", () => {
  const before = exportDocument(
    createDocument(FIXTURES.single.cells, 0, "crafted-hip"),
  );
  const doc = createDocument(FIXTURES.single.cells, 0, "crafted-hip");
  doc.catalog.modules!.reverse();
  expect(exportDocument(doc)).toBe(before);
  (doc.catalog.modules![0].bounds16.max as number[])[0] = 999;
  expect(() => exportDocument(doc)).toThrow("metadata");
  expect(
    exportDocument(createDocument(FIXTURES.single.cells, 0, "crafted-hip")),
  ).toBe(before);
});
