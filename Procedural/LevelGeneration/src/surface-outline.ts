import {BASES, cellId, faceCorners, type Direction, type Surface, type Vec3} from './core/analysis';

/** Retain creases and exposed boundaries; omit shared edges on a flat face. */
export function surfaceOutline(surfaces: readonly Pick<Surface, 'cell' | 'direction'>[], outset = 0): number[] {
  const edges = new Map<string, {a: Vec3; b: Vec3; directions: Direction[]}>();
  const vertexNormals = new Map<string, Set<Direction>>();
  for (const face of surfaces) {
    const corners = faceCorners(face.cell, face.direction);
    for(const corner of corners){const key=cellId(corner),normals=vertexNormals.get(key)??new Set<Direction>();normals.add(face.direction);vertexNormals.set(key,normals);}
    for (let i = 0; i < 4; i++) {
      const [a, b] = [corners[i], corners[(i + 1) % 4]].sort((a,b) => cellId(a).localeCompare(cellId(b)));
      const key = `${cellId(a)}|${cellId(b)}`;
      const edge = edges.get(key) ?? {a, b, directions: []};
      edge.directions.push(face.direction);
      edges.set(key, edge);
    }
  }
  return [...edges.values()].filter(e => e.directions.length !== 2 || e.directions[0] !== e.directions[1]).flatMap(e => {
    return [e.a,e.b].flatMap(p=>p.map((n,axis)=>n+outset*[...vertexNormals.get(cellId(p))!].reduce((sum,d)=>sum+BASES[d].n[axis],0)));
  });
}
