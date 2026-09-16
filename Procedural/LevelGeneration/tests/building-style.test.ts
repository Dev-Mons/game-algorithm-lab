import { expect, it } from "vitest";
import { generate, BASES, add, validateAssembly } from "../src/core/generate";
import {
  createDocument,
  documentOptions,
  exportDocument,
  loadDocument,
  profileData,
  canonicalJSON,
  replaceGrid,
} from "../src/core/document";
import {
  SHOP_STYLE,
  OFFICE_STYLE,
  OFFICE_STYLE_V1,
  validateBuildingStyle,
  levelAt,
} from "../src/core/building-style";
import { chooseFacadePattern } from "../src/core/facade-patterns";
import { FACADE_ASSETS, type FacadeAssetKey } from "../src/core/facade-assets";
import { buildCraftedGeometry } from "../src/crafted-geometry";
import { DocumentHistory } from "../src/editor";
import { box, FIXTURES } from "../src/fixtures";
import type { GenerationResult, Vec3 } from "../src/core/generate";
const options = (id: "shop" | "office") => ({ seed: 42, ...profileData(id) });
function checkGroups(r: GenerationResult) {
  const groups = new Map<string, typeof r.traces>();
  for (const trace of r.traces) {
    if (!trace.facade?.groupId) continue;
    if (!groups.has(trace.facade.groupId)) groups.set(trace.facade.groupId, []);
    groups.get(trace.facade.groupId)!.push(trace);
  }
  for (const group of groups.values()) {
    expect(group).toHaveLength(2);
    const left = group.find((t) => t.facade!.part === "left")!;
    const right = group.find((t) => t.facade!.part === "right")!;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left.architecture!.palette).toBe(right.architecture!.palette);
    const cell = r.surfaces.find((s) => s.faceId === left.faceId)!.cell;
    expect(right.faceId).toBe(
      `${add(cell, BASES[left.direction].u).join(",")}|${left.direction}`,
    );
    expect(left.facade!.patternId).toBe(right.facade!.patternId);
    expect(r.placements.some((p) => p.faceId === left.faceId)).toBe(true);
    expect(r.placements.some((p) => p.faceId === right.faceId)).toBe(true);
  }
  validateAssembly(
    r.surfaces.map((s) => s.faceId),
    r.placements,
    r.modules!,
  );
  return groups;
}

it.each(["shop", "office"] as const)(
  "%s assigns 1/2/many floors, exactly one grounded front door and independent top trims",
  (id) => {
    for (const height of [1, 2, 5]) {
      const r = generate(box(7, height, 4), options(id));
      expect(r.status).toBe("ok");
      const entries = r.traces.filter(
        (t) => t.facade?.patternId === "entrance",
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].direction).toBe("PZ");
      expect(entries[0].facade).toMatchObject({
        level: "ground",
        facade: "front",
      });
      for (const t of r.traces.filter((t) => t.facade)) {
        const y = r.surfaces.find((s) => s.faceId === t.faceId)!.cell[1];
        expect(t.facade!.level).toBe(
          y === 0 ? "ground" : y === height - 1 ? "top" : "middle",
        );
        expect(t.facade!.topBoundary).toBe(y === height - 1);
      }
      expect(
        r.modules!.filter((m) => m.ruleId === "attachment.facade-trim"),
      ).toHaveLength(22);
      if (height === 1) expect(entries[0].facade!.topBoundary).toBe(true);
      checkGroups(r);
    }
  },
);

it("caps annexes and terrace steps below component top, without creating floating doors", () => {
  for (const grid of [
    FIXTURES.annex.cells,
    FIXTURES.terrace.cells,
    FIXTURES.coveredTop.cells,
  ]) {
    const r = generate(grid, options("shop"));
    const caps = r.traces.filter(
      (t) => t.facade?.topBoundary && t.facade.level !== "top",
    );
    expect(caps.length).toBeGreaterThan(0);
    for (const t of caps)
      expect(
        r.modules!.some(
          (m) =>
            m.hostFaceId === t.faceId && m.ruleId === "attachment.facade-trim",
        ),
      ).toBe(true);
    checkGroups(r);
  }
  const floating = generate(
    box(4, 3, 3).map((c) => [c[0], c[1] + 3, c[2]]),
    options("office"),
  );
  expect(floating.traces.some((t) => t.facade?.patternId === "entrance")).toBe(
    false,
  );
  expect(floating.traces.some((t) => t.facade?.level === "ground")).toBe(false);
  const belowGround = generate(
    box(4, 3, 3).map((c) => [c[0], c[1] - 1, c[2]]),
    options("office"),
  );
  expect(
    belowGround.traces.some((t) => t.facade?.patternId === "entrance"),
  ).toBe(false);
  const cantilever = generate(FIXTURES.overhang.cells, options("shop"));
  expect(
    cantilever.traces
      .filter((t) => t.facade?.patternId === "entrance")
      .every((t) => t.faceId.split("|")[0].split(",")[1] === "0"),
  ).toBe(true);
});

it("widths 1 through 11, holes, doors and corners never leave half a connected design", () => {
  for (const id of ["shop", "office"] as const)
    for (let width = 1; width <= 11; width++) {
      const grid = box(width, 4, 3);
      const full = generate(grid, options(id));
      checkGroups(full);
      const cut = grid.filter(
        ([x, y, z]) => !(x === Math.floor(width / 2) && y === 1 && z === 2),
      );
      const r = generate(cut, options(id));
      checkGroups(r);
      for (const group of checkGroups(full).values())
        expect(
          group.every(
            (t) =>
              t.facade!.patternId !== "corner" &&
              t.facade!.patternId !== "entrance",
          ),
        ).toBe(true);
    }
  // Two adjacent unit cells form one long design in every facade orientation.
  const two = generate(box(2, 3, 2), options("office"));
  for (const d of ["PX", "NX", "PZ", "NZ"])
    expect(
      two.traces.filter(
        (t) =>
          t.direction === d && t.facade?.level === "middle" && t.facade.groupId,
      ),
    ).toHaveLength(2);
});

it("repeated floors share motif columns even when a row loses cells or a region has a hole", () => {
  const grid = box(10, 5, 4).filter(
    ([x, y, z]) => !(z === 3 && y === 2 && x === 4),
  );
  const r = generate(grid, options("office"));
  const baseline = new Map(
    r.traces
      .filter((t) => t.direction === "PZ" && t.faceId.split(",")[1] === "1")
      .map((t) => [t.faceId.split(",")[0], t]),
  );
  for (const t of r.traces.filter(
    (t) =>
      t.direction === "PZ" &&
      t.faceId.split(",")[1] === "2" &&
      t.facade?.groupId,
  )) {
    const b = baseline.get(t.faceId.split(",")[0]);
    if (b?.facade?.groupId) expect(t.facade?.moduleId).toBe(b.facade.moduleId);
  }
  checkGroups(r);
});

it("pattern ranking prefers exact fill then fewer integer fillers before style priority and stable ID", () => {
  const s = structuredClone(OFFICE_STYLE_V1);
  const level = s.levels[1];
  const run = {
    width: 5,
    start: 0,
    anchor: 0,
    level,
    kind: "side" as const,
    direction: "PZ" as const,
  };
  expect(chooseFacadePattern(s, run).best!.pattern.id).toBe("office-bays");
  expect(chooseFacadePattern(s, { ...run, width: 4 }).best!.pattern.id).toBe(
    "office-pairs",
  );
  expect(chooseFacadePattern(s, { ...run, width: 1 }).best).toBeUndefined();
  const twin = {
    ...s.patterns.find((p) => p.id === "office-pairs")!,
    id: "aaa",
  };
  s.patterns.push(twin);
  level.patterns.push(twin.id);
  expect(chooseFacadePattern(s, { ...run, width: 4 }).best!.pattern.id).toBe(
    "aaa",
  );
});

it("style data changes the generated pattern and level plan without renderer conditions", () => {
  const opts = options("shop");
  const original = generate(box(8, 5, 3), opts);
  const style = structuredClone(SHOP_STYLE);
  style.patterns.find((p) => p.id === "shop-pair")!.repeat = [
    "window-single",
    "pier",
  ];
  style.levels[0].count = 2;
  style.version = 4;
  const changed = generate(box(8, 5, 3), { ...opts, architecture: style });
  expect(changed.traces).not.toEqual(original.traces);
  expect(levelAt(style, 1, 0, 4).role).toBe("ground");
  expect(changed.traces.some((t) => t.facade?.patternId === "shop-pair")).toBe(
    true,
  );
  const office = generate(box(8, 5, 3), options("office"));
  expect(office.placements.map((p) => p.tileId)).not.toEqual(
    original.placements.map((p) => p.tileId),
  );
});

it("invalid half groups, mixed connection geometry, unsupported sizes and broken references are rejected", () => {
  for (const change of [
    (s: typeof SHOP_STYLE) => {
      s.patterns[0].repeat = ["shop-left"];
    },
    (s: typeof SHOP_STYLE) => {
      s.modules[0].width = 2;
    },
    (s: typeof SHOP_STYLE) => {
      s.levels[0].patterns = ["missing"];
    },
    (s: typeof SHOP_STYLE) => {
      s.patterns[0].remainder = "shop-left";
    },
    (s: typeof SHOP_STYLE) => {
      s.modules.find((m) => m.id === "shop-right")!.assetId =
        "facade.window-right";
    },
  ]) {
    const s = structuredClone(SHOP_STYLE);
    change(s);
    expect(() => validateBuildingStyle(s)).toThrow();
  }
});

it("two unit asset halves join in all four directions with continuous glass/rails and no seam mullion", () => {
  for (const family of ["window", "shop", "office"]) {
    const leftKey = `facade.${family}-left` as FacadeAssetKey;
    const rightKey = `facade.${family}-right` as FacadeAssetKey;
    const left = buildCraftedGeometry(leftKey),
      right = buildCraftedGeometry(rightKey);
    for (const direction of ["PX", "NX", "PZ", "NZ"] as const) {
      const basis = BASES[direction];
      const edge = (g: typeof left, x: number, offset: number) => {
        const p = g.glass!.getAttribute("position");
        const values: number[][] = [];
        for (let i = 0; i < p.count; i++)
          if (Math.abs(p.getX(i) - x) < 1e-6)
            values.push(
              basis.u.map(
                (v, a) =>
                  v * (p.getX(i) + offset) +
                  basis.v[a] * p.getY(i) +
                  basis.n[a] * p.getZ(i),
              ),
            );
        return values.sort((a, b) => a.join().localeCompare(b.join()));
      };
      expect(edge(left, 0.5, 0)).toEqual(edge(right, -0.5, 1));
    }
    for (const [key, g, x] of [
      [leftKey, left, 0.5],
      [rightKey, right, -0.5],
    ] as const) {
      const o = (FACADE_ASSETS[key] as any).opening;
      const pos = g.relief!.getAttribute("position");
      for (let i = 0; i < pos.count; i++)
        if (Math.abs(pos.getX(i) - x) < 1e-6)
          expect(
            pos.getY(i) < o.minY + 0.041 || pos.getY(i) > o.maxY - 0.041,
          ).toBe(true);
      for (const geometry of [g.panel, g.relief!, g.glass!]) {
        geometry.computeBoundingBox();
        expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.5);
        expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(0.5);
        geometry.dispose();
      }
    }
  }
});

it("v4 embeds custom style data and restores exact patterns through edits and history", () => {
  const style = structuredClone(OFFICE_STYLE);
  style.version = 4;
  style.patterns.find((p) => p.id === "office-pairs")!.priority = 17;
  const a = createDocument(box(4, 3, 3), 123, "office", style);
  const b = replaceGrid(
    a,
    a.grid.filter((c) => c.join() !== "1,1,2"),
  );
  const history = new DocumentHistory(a);
  history.commit(b);
  const restored = history.undo()!;
  expect(exportDocument(restored)).toBe(exportDocument(a));
  expect(history.redo()).toEqual(b);
  const loaded = loadDocument(exportDocument(a));
  expect(loaded.schemaVersion).toBe(4);
  expect(loaded.buildingDefinition).toEqual(style);
  const r = generate(loaded.grid, documentOptions(loaded));
  expect(generate([...loaded.grid].reverse(), documentOptions(loaded))).toEqual(
    r,
  );
  checkGroups(r);
  checkGroups(generate(b.grid, documentOptions(b)));
  const added = replaceGrid(b, [...b.grid, [1, 1, 2]]);
  expect(generate(added.grid, documentOptions(added))).toEqual(r);
});

it.each(["shop", "office"] as const)(
  "%s has a separate v4 golden without rewriting legacy outputs",
  async (id) => {
    const input = createDocument(box(4, 3, 2), 42, id);
    await expect(
      canonicalJSON({
        input,
        output: generate(input.grid, documentOptions(input)),
      }),
    ).toMatchFileSnapshot(`../fixtures/golden-v4-style-v3/${id}.json`);
  },
);

it("preserves both original v4 style-v1 goldens with their embedded definitions", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const folder of ["golden-v4", "golden-v4-style-v2"])
    for (const id of ["shop", "office"]) {
      const text = await readFile(`fixtures/${folder}/${id}.json`, "utf8");
      const expected = JSON.parse(text);
      const input = loadDocument(JSON.stringify(expected.input));
      expect(input.buildingDefinition!.version).toBe(
        folder === "golden-v4" ? 1 : 2,
      );
      expect(
        canonicalJSON({
          input,
          output: generate(input.grid, documentOptions(input)),
        }),
      ).toBe(text);
    }
});
it.each(["shop", "office"] as const)(
  "%s frames both ends and uses a symmetric interior for odd/even widths",
  (id) => {
    for (let width = 3; width <= 10; width++) {
      const r = generate(box(width, 4, width), options(id));
      for (const direction of ["PX", "NX", "PZ", "NZ"] as const) {
        for (const y of [1, 2, 3]) {
          const row = r.surfaces
            .filter((s) => s.direction === direction && s.cell[1] === y)
            .sort((a, b) =>
              a.cell.reduce(
                (sum, v, i) => sum + (v - b.cell[i]) * BASES[direction].u[i],
                0,
              ),
            );
          const symbols = row
            .map((s) => {
              const f = r.traces.find((t) => t.faceId === s.faceId)!.facade!;
              return f.part ? "O" : "X";
            })
            .join("");
          const expected =
            width % 2 === 0
              ? `X${"O".repeat(width - 2)}X`
              : `X${"OX".repeat((width - 1) / 2)}`;
          expect(symbols, `${id}/${direction}/${width}/${y}`).toBe(expected);
        }
      }
      checkGroups(r);
    }
  },
);

it.each(["shop", "office"] as const)(
  "%s balances an even ground floor around two central entrance cells",
  (id) => {
    for (const width of [1, 2, 3, 4, 5, 6, 13, 14, 15, 16]) {
      for (const direction of ["PX", "NX", "PZ", "NZ"] as const) {
        const opts = options(id);
        const definition = structuredClone(opts.architecture!);
        definition.frontOrder = [
          direction,
          ...definition.frontOrder.filter((d) => d !== direction),
        ];
        const grid = box(width, 3, width);
        const r = generate(grid, { ...opts, architecture: definition });
        const row = r.surfaces
          .filter((s) => s.direction === direction && s.cell[1] === 0)
          .sort((a, b) =>
            a.cell.reduce(
              (sum, v, i) => sum + (v - b.cell[i]) * BASES[direction].u[i],
              0,
            ),
          );
        const facades = row.map(
          (s) => r.traces.find((t) => t.faceId === s.faceId)!.facade!,
        );
        const positions = facades.flatMap((f, i) =>
          f.patternId === "entrance" ? [i] : [],
        );
        expect(positions).toEqual(
          width % 2 === 0 ? [width / 2 - 1, width / 2] : [(width - 1) / 2],
        );
        expect(
          r.traces.filter((t) => t.facade?.patternId === "entrance"),
        ).toHaveLength(positions.length);
        const symbol = (f: (typeof facades)[number]) =>
          f.patternId === "entrance" ? "D" : f.part ? "O" : "X";
        const symbols = facades.map(symbol).join("");
        expect(symbols).toBe([...symbols].reverse().join(""));
        for (let i = 0; i < Math.floor(width / 2); i++) {
          const a = facades[i],
            b = facades[width - 1 - i];
          const counterpart =
            a.part === "left" ? "right" : a.part === "right" ? "left" : a.part;
          expect(b.part).toBe(counterpart);
          if (!a.part) expect(b.moduleId).toBe(a.moduleId);
        }
        checkGroups(r);
      }
    }
  },
);
it("ground entrance parity is recalculated after deletion and restored through history", () => {
  const a = createDocument(box(14, 3, 3), 42, "shop");
  const b = replaceGrid(
    a,
    a.grid.filter((c) => c[0] !== 13),
  );
  const history = new DocumentHistory(a);
  history.commit(b);
  const doors = (doc: typeof a) =>
    generate(doc.grid, documentOptions(doc))
      .traces.filter((t) => t.facade?.patternId === "entrance")
      .map((t) => t.faceId);
  expect(doors(a)).toEqual(["6,0,2|PZ", "7,0,2|PZ"]);
  expect(doors(b)).toEqual(["6,0,2|PZ"]);
  expect(doors(history.undo()!)).toEqual(doors(a));
  expect(doors(history.redo()!)).toEqual(doors(b));
});
