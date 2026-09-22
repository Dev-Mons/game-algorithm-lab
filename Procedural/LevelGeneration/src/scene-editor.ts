import { add, BASES, cellId, normalizeGrid, type Vec3 } from "./core/analysis";
import { replaceSceneInputs, type GenerationDocument } from "./core/document";
import type { ObjectInput, ObjectCategory } from "./core/scene-inputs";
import type { SurfaceSelection } from "./surface-edit";
// Keep each fragment rectangular and supported along its original installation
// direction. Splitting along vertical runs allows partial roof-height edits.
function objectFragments(
  cells: Vec3[],
  category: ObjectCategory,
  direction: ObjectInput["direction"],
): ObjectInput[] {
  if (!cells.length) return [];
  const axis = BASES[direction].n.findIndex((n) => n !== 0);
  const [u, v] = [0, 1, 2].filter((a) => a !== axis);
  const columns = new Map<string, Vec3[]>();
  for (const cell of normalizeGrid(cells)) {
    const key = `${cell[u]},${cell[v]}`;
    const column = columns.get(key) ?? [];
    column.push(cell);
    columns.set(key, column);
  }
  const bands = new Map<
    string,
    { lo: number; hi: number; points: Map<string, Vec3> }
  >();
  for (const column of columns.values()) {
    column.sort((a, b) => a[axis] - b[axis]);
    let first = 0;
    for (let i = 1; i <= column.length; i++) {
      if (i < column.length && column[i][axis] === column[i - 1][axis] + 1)
        continue;
      const lo = column[first][axis],
        hi = column[i - 1][axis],
        key = `${lo}:${hi}`;
      const band = bands.get(key) ?? {
        lo,
        hi,
        points: new Map<string, Vec3>(),
      };
      band.points.set(`${column[first][u]},${column[first][v]}`, column[first]);
      bands.set(key, band);
      first = i;
    }
  }
  const fragments: ObjectInput[] = [];
  for (const { lo, hi, points } of bands.values()) {
    while (points.size) {
      const root = [...points.values()].sort(
        (a, b) => a[u] - b[u] || a[v] - b[v],
      )[0];
      const left = root[u],
        bottom = root[v];
      let right = left,
        top = bottom;
      while (points.has(`${right + 1},${bottom}`)) right++;
      while (
        Array.from({ length: right - left + 1 }, (_, i) =>
          points.has(`${left + i},${top + 1}`),
        ).every(Boolean)
      )
        top++;
      const fragment: Vec3[] = [];
      for (let a = left; a <= right; a++)
        for (let b = bottom; b <= top; b++) {
          points.delete(`${a},${b}`);
          for (let n = lo; n <= hi; n++) {
            const cell: Vec3 = [0, 0, 0];
            cell[axis] = n;
            cell[u] = a;
            cell[v] = b;
            fragment.push(cell);
          }
        }
      const normalized = normalizeGrid(fragment);
      fragments.push({
        id: `object:${category}:${direction}:${cellId(normalized[0])}`,
        category,
        direction,
        cells: normalized,
      });
    }
  }
  return fragments;
}
export function editObjects(
  document: GenerationDocument,
  selection: SurfaceSelection,
  category: ObjectCategory,
  mode: "add" | "remove",
  options:Pick<ObjectInput,'facilityKind'|'facadeRequest'>={},
) {
  const inputs = document.sceneInputs ?? {
    version: 2 as const,
    roads: [],
    objects: [],
    parkingAreas: [],
  };
  // Automatic wall intent follows the original mount when extending a side/top.
  const selectedOwner = inputs.objects.find(o => selection.cells.some(c => o.cells.some(b => cellId(b) === cellId(c))));
  const mount = selectedOwner?.direction ?? selection.direction;
  if (category === 'facility' && mount !== 'PY' && mount !== 'NY' && !options.facilityKind)
    options = {...options, facilityKind: selectedOwner?.facilityKind ?? 'auto'};
  const normal = BASES[selection.direction].n;
  const targets = normalizeGrid(
    mode === "add"
      ? selection.cells.map((c) => add(c, normal))
      : selection.cells,
  );
  if(mode==='add') {
    const buildings=new Set(document.grid.map(cellId));
    if(targets.some(c=>buildings.has(cellId(c))))throw new Error('오브젝트가 건물과 겹칩니다.');
  }
  const owners = new Map(
    inputs.objects.flatMap((o) => o.cells.map((c) => [cellId(c), o] as const)),
  );
  if (
    !targets.length ||
    targets.some((c) => owners.has(cellId(c)) !== (mode === "remove"))
  )
    return { document, selection, changed: false };
  const affected = new Set<ObjectInput>();
  const additions = new Map<ObjectInput["direction"], Vec3[]>();
  if (mode === "add") {
    for (const cell of targets) {
      const behind = add(cell, normal.map((n) => -n) as Vec3),
        owner = owners.get(cellId(behind));
      if (owner && (owner.category !== category||owner.facilityKind!==options.facilityKind||owner.facadeRequest!==options.facadeRequest))
        throw new Error(
          "다른 카테고리 위에는 쌓을 수 없습니다. 같은 카테고리를 선택하세요.",
        );
      if (owner) affected.add(owner);
      if(options.facilityKind)for(const d of [BASES[selection.direction].u,[0,1,0] as Vec3])for(const sign of [-1,1]){const neighbor=owners.get(cellId(add(cell,d.map(n=>n*sign) as Vec3)));if(neighbor?.direction===selection.direction&&neighbor.facilityKind===options.facilityKind&&neighbor.facadeRequest===options.facadeRequest)affected.add(neighbor);}
      const direction = owner?.direction ?? selection.direction;
      const list = additions.get(direction) ?? [];
      list.push(cell);
      additions.set(direction, list);
    }
  } else for (const cell of targets) affected.add(owners.get(cellId(cell))!);
  const removed = new Set(targets.map(cellId));
  const groups = new Map<
    string,
    {
      category: ObjectCategory;
      direction: ObjectInput["direction"];
      cells: Vec3[];
      options:Pick<ObjectInput,'facilityKind'|'facadeRequest'>;
    }
  >();
  const group = (
    category: ObjectCategory,
    direction: ObjectInput["direction"],
    options:Pick<ObjectInput,'facilityKind'|'facadeRequest'>,
  ) => {
    const key = `${category}:${direction}:${options.facilityKind??''}:${options.facadeRequest??''}`;
    let value = groups.get(key);
    if (!value) {
      value = { category, direction, cells: [],options };
      groups.set(key, value);
    }
    return value;
  };
  for (const object of affected)
    group(object.category, object.direction,{...(object.facilityKind?{facilityKind:object.facilityKind}:{}),...(object.facadeRequest?{facadeRequest:object.facadeRequest}:{})}).cells.push(
      ...object.cells.filter(
        (c) => mode !== "remove" || !removed.has(cellId(c)),
      ),
    );
  for (const [direction, cells] of additions)
    group(category, direction,options).cells.push(...cells);
  const objects = inputs.objects.filter((o) => !affected.has(o));
  const usedIds = new Set(objects.map((o) => o.id));
  for (const value of groups.values())
    for (const fragment of objectFragments(
      value.cells,
      value.category,
      value.direction,
    )) {
      const baseId = fragment.id;
      for (let i = 1; usedIds.has(fragment.id); i++)
        fragment.id = `${baseId}:${i}`;
      usedIds.add(fragment.id);
      Object.assign(fragment,value.options);
      objects.push(fragment);
    }
  const next = replaceSceneInputs(document, {
    ...inputs,
    objects,
    roads:
      mode === "add"
        ? inputs.roads.filter((c) => !removed.has(cellId(c)))
        : inputs.roads,
  });
  const offset = normal.map((n) => n * (mode === "add" ? 1 : -1)) as Vec3;
  return {
    document: next,
    selection: {
      direction: selection.direction,
      cells: selection.cells.map((c) => add(c, offset)),
    },
    changed: true,
  };
}

// Keep unaffected columns when a road/object cuts through an existing area.
// Removing a column's support also removes its dependent upper modules.
function carveObjects(
  objects: ObjectInput[],
  overwritten: Set<string>,
): ObjectInput[] {
  return objects.flatMap((o) => {
    if (!o.cells.some((c) => overwritten.has(cellId(c)))) return [o];
    const cells = o.cells.filter(
      (c) =>
        !overwritten.has(cellId(c)) &&
        !o.cells.some(
          (b) =>
            b[0] === c[0] &&
            b[2] === c[2] &&
            b[1] < c[1] &&
            overwritten.has(cellId(b)),
        ),
    );
    const columns = new Map<string, Vec3[]>();
    for (const c of cells) {
      const key = `${c[0]},${c[2]}`;
      const list = columns.get(key) ?? [];
      list.push(c);
      columns.set(key, list);
    }
    return [...columns.values()].map((cells) => ({
      ...o,
      cells,
      id: `object:${o.category}:${o.direction}:${cellId(cells[0])}`,
    }));
  });
}
export function editRoads(
  document: GenerationDocument,
  selection: SurfaceSelection,
  mode: "add" | "remove",
) {
  if (selection.direction !== "PY" || selection.cells.some((c) => c[1] !== -1))
    throw new Error("도로는 지면 Y=0에서만 설치/제거할 수 있습니다.");
  const cells = normalizeGrid(selection.cells.map((c) => add(c, [0, 1, 0])));
  const ids = new Set(cells.map(cellId));
  const inputs = document.sceneInputs ?? {
    version: 2 as const,
    roads: [],
    objects: [],
    parkingAreas: [],
  };
  return replaceSceneInputs(document, {
    ...inputs,
    roads:
      mode === "add"
        ? normalizeGrid([...inputs.roads, ...cells])
        : inputs.roads.filter((c) => !ids.has(cellId(c))),
    objects:
      mode === "add" ? carveObjects(inputs.objects, ids) : inputs.objects,
  });
}
