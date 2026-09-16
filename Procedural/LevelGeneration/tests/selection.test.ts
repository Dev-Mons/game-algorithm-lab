import { expect, it } from "vitest";
import {
  DEFAULT_CATALOG,
  DEFAULT_RULES,
  generate,
  validateCoverage,
  type Rule,
  type Tile,
} from "../src/core/generate";
import { FIXTURES } from "../src/fixtures";
const input = [[0, 0, 0]];
it("normal fixtures have complete ownership, recorded reasons and no fallback", () => {
  for (const fixture of Object.values(FIXTURES)) {
    const result = generate(fixture.cells);
    expect(result.counters.fallbackCount).toBe(0);
    expect(result.counters.ruleEvaluations).toBe(result.surfaces.length * 4);
    expect(
      validateCoverage(
        result.surfaces.map((s) => s.faceId),
        result.placements,
      ),
    ).toEqual([]);
    for (const t of result.traces) {
      expect(t.rules.filter((r) => r.outcome === "selected")).toHaveLength(1);
      expect(t.rules.some((r) => r.conditions.includes("role-mismatch"))).toBe(
        true,
      );
    }
  }
});
it("priority, ASCII ties, empty candidates and ownership competitors are explicit", () => {
  const rule: Rule = {
    ruleId: "a.wall",
    priority: 200,
    roles: ["wall"],
    orientationIds: ["PX", "NX", "PZ", "NZ"],
    tileIds: ["panel.wall", "panel.roof", "absent"],
  };
  const rules = [
    ...DEFAULT_RULES,
    { ...rule, ruleId: "z.wall" },
    rule,
    { ...rule, ruleId: "first.empty", priority: 300, tileIds: ["absent"] },
  ];
  const result = generate(input, { rules });
  const trace = result.traces[0];
  expect(trace.selection.ruleId).toBe("a.wall");
  expect(trace.rules[0].outcome).toBe("no-compatible-tile");
  expect(trace.rules[1].rejected).toEqual([
    { tileId: "absent", reason: "tile-not-in-catalog" },
    { tileId: "panel.roof", reason: "role-mismatch" },
  ]);
  expect(trace.rules[2].outcome).toBe("coverage-owned");
  expect(
    generate(input, {
      rules: [...rules].reverse(),
      catalog: [...DEFAULT_CATALOG].reverse(),
    }),
  ).toEqual(result);
});
it("missing candidates produce visible fallback, broken fallback and contracts are refused", () => {
  const result = generate(input, { rules: [] });
  expect(result.status).toBe("degraded");
  expect(result.counters.fallbackCount).toBe(6);
  expect(result.placements.every((p) => p.tileId === "debug.missing")).toBe(
    true,
  );
  for (const catalog of [
    [],
    [...DEFAULT_CATALOG, DEFAULT_CATALOG[0]],
    DEFAULT_CATALOG.map((t) => ({
      ...t,
      pivot: "corner",
    })) as unknown as Tile[],
  ])
    expect(() => generate(input, { catalog })).toThrow();
  expect(() =>
    generate(input, { rules: [...DEFAULT_RULES, DEFAULT_RULES[0]] }),
  ).toThrow();
  expect(() => generate(input, { style: "unknown" })).toThrow(
    "Unsupported style",
  );
  for (const seed of [-1, 0x1_0000_0000, 0.5])
    expect(() => generate(input, { seed })).toThrow("Seed");
});
it("detects missing, duplicate and unexpected face owners independently", () => {
  const { placements, surfaces } = generate(input);
  const altered = [
    ...placements.slice(1),
    placements[1],
    { ...placements[0], faceId: "internal" },
  ];
  expect(
    validateCoverage(
      surfaces.map((s) => s.faceId),
      altered,
    ).map((d) => d.code),
  ).toEqual(["MISSING_COVERAGE", "DUPLICATE_COVERAGE", "UNEXPECTED_COVERAGE"]);
});
