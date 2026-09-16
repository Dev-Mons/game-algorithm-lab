import { expect, it } from "vitest";
import { generate, hash33 } from "../src/core/generate";
import {
  canonicalJSON,
  createDocument,
  exportDocument,
  loadDocument,
  profileData,
} from "../src/core/document";
import { FIXTURES } from "../src/fixtures";
import hashVectors from "../fixtures/hash-vectors.json";

it.each(hashVectors)(
  "portable hash $seed/$text",
  ({ seed, text, expected }) => {
    expect(hash33(seed, text)).toBe(expected);
  },
);
it("two candidates are reproducible under cell, rule and candidate permutations and seed change", () => {
  const { catalog, rules } = profileData("variants");
  const cells = FIXTURES.step.cells;
  const result = generate(cells, { seed: 42, catalog, rules });
  expect(
    generate([...cells].reverse(), {
      seed: 42,
      catalog: [...catalog].reverse(),
      rules: [...rules]
        .reverse()
        .map((r) => ({ ...r, tileIds: [...r.tileIds].reverse() })),
    }),
  ).toEqual(result);
  expect(generate(cells, { seed: 43, catalog, rules }).placements).not.toEqual(
    result.placements,
  );
  const doc = createDocument(cells, 42, "variants");
  const loaded = loadDocument(exportDocument(doc));
  expect(
    generate(loaded.grid, {
      seed: loaded.seed,
      ...profileData(loaded.catalog.id),
    }),
  ).toEqual(result);
  expect(exportDocument(loaded)).toBe(exportDocument(doc));
});
it("canonicalizes negative zero, numeric cell order and metadata order without mutating input", () => {
  const document = createDocument(
    [
      [10, 0, 0],
      [-0, 0, 0],
      [-2, 0, 0],
    ],
    0,
  );
  const text = exportDocument(document);
  expect(document.grid).toEqual([
    [-2, 0, 0],
    [0, 0, 0],
    [10, 0, 0],
  ]);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.split("\n")).toHaveLength(2);
  expect(text.startsWith('{"algorithmVersion":')).toBe(true);
  document.grid.reverse();
  document.catalog.tiles.reverse();
  for (const tile of document.catalog.tiles) {
    tile.roles.reverse();
    tile.orientationIds.reverse();
  }
  expect(exportDocument(document)).toBe(text);
});
it("rejects unknown versions, styles, changed catalogs, rules and missing settings", () => {
  const base = createDocument(FIXTURES.single.cells);
  const mutate: ((d: any) => void)[] = [
    (d) => (d.schemaVersion = 2),
    (d) => (d.algorithmVersion = "future"),
    (d) => (d.catalog.version = 2),
    (d) => (d.catalog.id = "unregistered"),
    (d) => (d.catalog.tiles[0].roles = ["wall"]),
    (d) => (d.ruleSet.id = "other"),
    (d) => (d.ruleSet.version = 2),
    (d) => (d.style.id = "other"),
    (d) => (d.style.version = 2),
    (d) => delete d.seed,
    (d) => delete d.settings,
    (d) => (d.settings.connectivity = 26),
    (d) => (d.extra = true),
  ];
  for (const change of mutate) {
    const doc = structuredClone(base);
    change(doc);
    expect(() => loadDocument(JSON.stringify(doc))).toThrow();
  }
});
it.each([
  "single",
  "adjacent",
  "cube",
  "l",
  "step",
  "overhang",
  "sealed",
  "opened",
  "edgeContact",
  "vertexContact",
])("portable golden: %s", async (name) => {
  const input = createDocument(FIXTURES[name].cells, 42, "variants");
  const output = generate(input.grid, {
    seed: input.seed,
    ...profileData(input.catalog.id),
  });
  await expect(canonicalJSON({ input, output })).toMatchFileSnapshot(
    `../fixtures/golden/${name}.json`,
  );
});
