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

it('the shared roof panel covers its unit footprint once with outward normals',()=>{
 const parts=buildCraftedGeometry('crafted.roof'),g=parts.panel.toNonIndexed(),p=g.getAttribute('position'),normal=g.getAttribute('normal');
 const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const triangles:number[][][]=[];for(let i=0;i<p.count;i+=3)triangles.push([0,1,2].map(k=>[p.getX(i+k),p.getY(i+k)]));
 for(let x=0;x<16;x++)for(let y=0;y<16;y++){const q=[(x+.37)/16-.5,(y+.29)/16-.5];expect(triangles.filter(t=>[0,1,2].every(i=>cross(t[i],t[(i+1)%3],q)>-1e-8)).length).toBe(1);}
 for(let i=0;i<normal.count;i++)expect(normal.getZ(i)).toBeGreaterThan(.99);g.dispose();parts.panel.dispose();
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
    createDocument(FIXTURES.single.cells, 0, "office"),
  );
  const doc = createDocument(FIXTURES.single.cells, 0, "office");
  doc.catalog.modules!.reverse();
  expect(exportDocument(doc)).toBe(before);
  (doc.catalog.modules![0].bounds16.max as number[])[0] = 999;
  expect(() => exportDocument(doc)).toThrow("metadata");
  expect(
    exportDocument(createDocument(FIXTURES.single.cells, 0, "office")),
  ).toBe(before);
});
