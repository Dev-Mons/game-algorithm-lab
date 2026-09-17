import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const VEGETATION_ASSETS = new Set([
  "shrub",
  "roof-planter",
  "median-planter",
  "tree-bottom",
  "tree-middle",
  "tree-top",
]);

// All assets occupy one cell, centered on the placement pivot. Bottom/middle
// trunks and middle/top foliage meet on the same boundary across repeated tiles.
export class VegetationGeometryLibrary {
  private geometries = new Map<string, THREE.BufferGeometry>();
  readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    flatShading: true,
  });

  get(asset: string): THREE.BufferGeometry | undefined {
    if (!VEGETATION_ASSETS.has(asset)) return undefined;
    const cached = this.geometries.get(asset);
    if (cached) return cached;
    const pieces: THREE.BufferGeometry[] = [];
    const add = (geometry: THREE.BufferGeometry, color: string) => {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (g !== geometry) geometry.dispose();
      g.deleteAttribute("uv");
      const c = new THREE.Color(color),
        colors: number[] = [];
      for (let i = 0; i < g.getAttribute("position").count; i++)
        colors.push(c.r, c.g, c.b);
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      g.translate(0, -0.5, 0);
      pieces.push(g);
    };
    const branch = (
      from: number[],
      to: number[],
      radius: number,
      color = "#826147",
    ) => {
      const a = new THREE.Vector3(...from),
        b = new THREE.Vector3(...to),
        delta = b.clone().sub(a);
      const g = new THREE.CylinderGeometry(
        radius * 0.78,
        radius,
        delta.length(),
        7,
      );
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.clone().normalize(),
        ),
      );
      g.translate(...a.add(b).multiplyScalar(0.5).toArray());
      add(g, color);
    };
    const leaves = (at: number[], size: number[], color: string) => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(...(size as [number, number, number]));
      g.translate(...(at as [number, number, number]));
      add(g, color);
    };
    const canopy = (rings: [number, number][]) => {
      const points: number[] = [],
        colors: number[] = [],
        shades = ["#63964f", "#79a55b", "#528541", "#6b9b50"];
      const segments = 9;
      const point = (ring: number, side: number) => {
        const [y, r] = rings[ring],
          angle = (side / segments) * Math.PI * 2;
        return [Math.cos(angle) * r, y, Math.sin(angle) * r];
      };
      for (let ring = 0; ring < rings.length - 1; ring++)
        for (let side = 0; side < segments; side++) {
          const a = point(ring, side),
            b = point(ring, side + 1),
            c = point(ring + 1, side),
            d = point(ring + 1, side + 1);
          const color = new THREE.Color(shades[(ring + side) % shades.length]);
          for (const p of [a, c, b, b, c, d]) {
            points.push(...p);
            colors.push(color.r, color.g, color.b);
          }
        }
      // Close the foliage underside so a two-cell tree has a visible crown base.
      for (let side = 0; side < segments; side++) {
        const color = new THREE.Color("#4d7c3f");
        for (const p of [
          [0, rings[0][0], 0],
          point(0, side),
          point(0, side + 1),
        ]) {
          points.push(...p);
          colors.push(color.r, color.g, color.b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      g.translate(0, -0.5, 0);
      pieces.push(g);
    };
    if (asset === "tree-bottom") {
      branch([0, 0, 0], [0, 1, 0], 0.11);
      for (const [x, z] of [
        [1, 0],
        [-0.6, 0.8],
        [-0.6, -0.8],
      ]) {
        branch([x * 0.22, 0.06, z * 0.22], [0, 0.28, 0], 0.06, "#76553f");
        branch([0, 0.62, 0], [x * 0.27, 0.94, z * 0.27], 0.048);
      }
    } else if (asset === "tree-middle") {
      branch([0, 0, 0], [0, 1, 0], 0.086);
      canopy([
        [0, 0.36],
        [0.25, 0.43],
        [0.65, 0.43],
        [1, 0.36],
      ]);
    } else if (asset === "tree-top") {
      branch([0, 0, 0], [0, 0.48, 0], 0.086);
      canopy([
        [0, 0.36],
        [0.3, 0.46],
        [0.65, 0.34],
        [0.9, 0.17],
        [1, 0],
      ]);
    } else {
      const planter = asset !== "shrub";
      if (planter) {
        add(
          new THREE.BoxGeometry(0.94, 0.16, 0.94).translate(0, 0.08, 0),
          asset === "median-planter" ? "#b8b2a0" : "#a58e77",
        );
        add(
          new THREE.BoxGeometry(0.8, 0.035, 0.8).translate(0, 0.17, 0),
          "#624a35",
        );
      }
      branch([0, planter ? 0.18 : 0.02, 0], [0, 0.45, 0], 0.065);
      leaves([0, 0.49, 0], [0.35, 0.32, 0.34], "#74a45a");
      leaves([-0.19, 0.38, 0.12], [0.26, 0.23, 0.27], "#68954d");
      leaves([0.18, 0.4, 0.1], [0.26, 0.26, 0.27], "#83af62");
      leaves([0.06, 0.43, -0.19], [0.28, 0.25, 0.25], "#5b8b48");
    }
    const merged = mergeGeometries(pieces, false)!;
    pieces.forEach((g) => g.dispose());
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    this.geometries.set(asset, merged);
    return merged;
  }
  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.geometries.clear();
    this.material.dispose();
  }
}
