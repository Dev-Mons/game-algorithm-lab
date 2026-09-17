import { expect, it } from "vitest";
import {
  createDocument,
  documentOptions,
  exportDocument,
  loadDocument,
  replaceGrid,
  setBuildingRule,
  setBuildingTheme,
} from "../src/core/document";
import { generateDocument } from "../src/core/generate-document";
import { generate } from "../src/core/generate";
import {
  registerBuildingRule,
  ruleReference,
} from "../src/core/building-rules";
import { PARKING_RULE } from "../src/core/parking-rule";
import { OFFICE_STYLE } from "../src/core/building-style";
import { DocumentHistory } from "../src/editor";
import { FIXTURES } from "../src/fixtures";
import { buildingComponents } from "../src/core/buildings";
import type { Profile } from "../src/core/document";
it.each(["reference", "village", "crafted-hip", "shop", "office"] as Profile[])(
  "default %s pipeline remains byte-for-byte equivalent, including explicit standard rule",
  (profile) => {
    for (const fixture of [
      FIXTURES.single,
      FIXTURES.step,
      FIXTURES.overhang,
      FIXTURES.quarter,
    ]) {
      const doc = createDocument(fixture.cells, 42, profile);
      const explicit = setBuildingRule(
        doc,
        buildingComponents(doc.grid)[0].id,
        "standard",
      );
      expect(generateDocument(explicit)).toEqual(
        generate(doc.grid, documentOptions(doc)),
      );
      expect(generateDocument(doc)).toEqual(
        generate(doc.grid, documentOptions(doc)),
      );
    }
  },
);
it("mixes rules, keeps theme separate, persists version/definition/metadata through edits and history", () => {
  const doc = createDocument(
      [
        [0, 0, 0],
        [0, 1, 0],
        [5, 0, 0],
      ],
      42,
      "shop",
    ),
    baseline = generateDocument(doc);
  const parking = setBuildingRule(doc, "0,0,0", "parking", { bayStride: 1 }),
    generated = generateDocument(parking);
  expect(
    generated.scenePlacements?.some((p) => p.asset === "parking-column"),
  ).toBe(true);
  expect(
    generated.placements.filter((p) => p.faceId.startsWith("0,")),
  ).toHaveLength(0);
  expect(generated.placements.filter((p) => p.faceId.startsWith("5,"))).toEqual(
    baseline.placements.filter((p) => p.faceId.startsWith("5,")),
  );
  const themed = setBuildingTheme(parking, "0,0,0", OFFICE_STYLE);
  expect(themed.buildings![0].rule).toEqual(parking.buildings![0].rule);
  expect(generateDocument(themed).scenePlacements?.[0].color).not.toBe(
    generated.scenePlacements?.[0].color,
  );
  const edited = replaceGrid(themed, [...themed.grid, [1, 0, 0]]);
  expect(edited.buildings![0].rule).toEqual(
    ruleReference("parking", { bayStride: 1 }),
  );
  const history = new DocumentHistory(parking);
  history.commit(edited);
  expect(history.undo()).toEqual(parking);
  expect(history.redo()).toEqual(edited);
  expect(loadDocument(exportDocument(edited))).toEqual(edited);
  expect(generateDocument(loadDocument(exportDocument(edited)))).toEqual(
    generateDocument(edited),
  );
});
it("rejects unknown IDs, versions, incompatible definitions and invalid per-rule metadata", () => {
  const doc = setBuildingRule(
    createDocument([[0, 0, 0]], 42, "shop"),
    "0,0,0",
    "parking",
  );
  for (const change of [
    { id: "unknown" },
    { version: "99.0.0" },
    { definition: { structure: "different" } },
    { metadata: { bayStride: 0 } },
  ]) {
    const invalid = structuredClone(doc);
    Object.assign(invalid.buildings![0].rule!, change);
    expect(() => loadDocument(JSON.stringify(invalid))).toThrow();
  }
  expect(() => setBuildingRule(doc, "0,0,0", "missing")).toThrow(/Unknown/);
  expect(() =>
    setBuildingRule(doc, "0,0,0", "standard", { bayStride: 2 }),
  ).toThrow();
});
it("registers a new strategy without changing general generation and regenerates only affected components", () => {
  const calls = new Map<string, number>();
  registerBuildingRule({
    ...PARKING_RULE,
    id: "test-parking",
    generate(input) {
      calls.set(input.componentId, (calls.get(input.componentId) ?? 0) + 1);
      return PARKING_RULE.generate(input);
    },
  });
  let doc = setBuildingRule(
    setBuildingRule(
      createDocument(
        [
          [0, 0, 0],
          [6, 0, 0],
        ],
        91,
        "shop",
      ),
      "0,0,0",
      "test-parking",
    ),
    "6,0,0",
    "test-parking",
  );
  generateDocument(doc);
  expect([...calls.values()]).toEqual([1, 1]);
  doc = setBuildingTheme(doc, "0,0,0", OFFICE_STYLE);
  generateDocument(doc);
  expect(calls.get("0,0,0")).toBe(2);
  expect(calls.get("6,0,0")).toBe(1);
  doc = replaceGrid(doc, [...doc.grid, [0, 1, 0]]);
  generateDocument(doc);
  expect(calls.get("0,0,0")).toBe(3);
  expect(calls.get("6,0,0")).toBe(1);
});

it("preserves the legacy non-manifold safety gate in untouched mixed-rule buildings", () => {
  const doc = createDocument(
    [
      [0, 0, 0],
      [1, 1, 1],
      [6, 0, 0],
      [6, 1, 0],
    ],
    42,
    "crafted-hip",
  );
  const baseline = generateDocument(doc),
    mixed = generateDocument(setBuildingRule(doc, "0,0,0", "parking"));
  const belongs = (id: string) => id.startsWith("6,");
  expect(mixed.placements.filter((p) => belongs(p.faceId))).toEqual(
    baseline.placements.filter((p) => belongs(p.faceId)),
  );
  expect(mixed.modules?.filter((m) => belongs(m.hostFaceId))).toEqual(
    baseline.modules?.filter((m) => belongs(m.hostFaceId)),
  );
});
