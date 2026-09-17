import {generateDocument} from '../src/core/generate-document';
import { expect, it } from "vitest";
import {
  generate,
  validateAssembly,
  MODULE_ASSETS,
  BASES,
  CRAFTED_CATALOG,
  type ModulePlacement,
  type Vec3,
} from "../src/core/generate";
import {
  createDocument,
  exportDocument,
  loadDocument,
  profileData,
  canonicalJSON,
} from "../src/core/document";
import { FIXTURES } from "../src/fixtures";
import { buildCraftedGeometry } from "../src/crafted-geometry";
const options = { seed: 42, ...profileData("office") };

it("every authored face asset respects its unit footprint and declared relief limit", () => {
  for (const key of new Set(
    CRAFTED_CATALOG.filter((t) => t.assetKey.startsWith("crafted.")).map(
      (t) => t.assetKey,
    ),
  )) {
    const parts = buildCraftedGeometry(key);
    for (const geometry of [parts.panel, parts.relief].filter(Boolean)) {
      const p = geometry!.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(0.5);
        expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(0.5);
        expect(p.getZ(i)).toBeGreaterThanOrEqual(0);
        expect(p.getZ(i)).toBeLessThanOrEqual(0.125);
      }
      geometry!.dispose();
    }
  }
});
it('current structure has exactly one owner for every external face',()=>{for(const fixture of Object.values(FIXTURES)){const r=generateDocument(createDocument(fixture.cells));validateAssembly(r.surfaces.map(s=>s.faceId),r.placements,r.modules!);expect(r.counters.ownedFaceCount).toBe(r.surfaces.length);}});
it("actual shared geometry stays inside declared bounds and roofs have no internal bottom", () => {
  for (const asset of MODULE_ASSETS) {
    const parts = buildCraftedGeometry(asset.assetKey);
    for (const g of [parts.panel, parts.relief].filter(Boolean)) {
      const pos = g!.getAttribute("position");
      for (let i = 0; i < pos.count; i++)
        for (let a = 0; a < 3; a++) {
          const n = pos.getComponent(i, a) * 16;
          expect(n).toBeGreaterThanOrEqual(asset.bounds16.min[a] - 1e-5);
          expect(n).toBeLessThanOrEqual(asset.bounds16.max[a] + 1e-5);
        }
      if (asset.assetKey.startsWith("roof.")) {
        const normal = g!.getAttribute("normal");
        for (let i = 0; i < normal.count; i++)
          expect(normal.getZ(i)).toBeGreaterThanOrEqual(-1e-5);
      }
      g!.dispose();
    }
  }
});
it("3D relief never penetrates an occupied cell and keeps roof/wall boundary coordinates", () => {
  const result = generateDocument(createDocument(FIXTURES.terrace.cells)),
    occupied = new Set(result.cells.map((c) => c.join(",")));
  for (const m of result.modules!) {
    const parts = buildCraftedGeometry(m.assetKey),
      basis = BASES[m.orientationId];
    for (const geometry of [parts.panel, parts.relief].filter(Boolean)) {
      const p = geometry!.getAttribute("position");
      // Vertex samples moved a tiny amount toward the neighboring vertices, away from cell boundaries.
      const index = geometry!.getIndex();
      const triangles = index ? index.count : p.count;
      for (let i = 0; i < triangles; i += 3) {
        const local = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const j = index ? index.getX(i + k) : i + k;
          for (let a = 0; a < 3; a++)
            local[a] += ((p.getComponent(j, a) / 3) * m.scale16[a]) / 16;
        }
        const world = m.position2.map(
          (n, a) =>
            n / 2 +
            local[0] * basis.u[a] +
            local[1] * basis.v[a] +
            local[2] * basis.n[a],
        );
        // Surface points on integer grid boundaries are allowed; strictly interior samples are not.
        if (world.every((n) => Math.abs(n - Math.round(n)) > 1e-6))
          expect(occupied.has(world.map(Math.floor).join(","))).toBe(false);
      }
      geometry!.dispose();
    }
  }
});
it.each(['shop','office'] as const)('%s saves current assembly inputs and deterministically restores planned output',async profile=>{
  const {generateDocument}=await import('../src/core/generate-document');
  const input=createDocument(FIXTURES.facade.cells,42,profile),loaded=loadDocument(exportDocument(input));
  expect(input.schemaVersion).toBe(5);expect(generateDocument(loaded)).toEqual(generateDocument(input));
});
