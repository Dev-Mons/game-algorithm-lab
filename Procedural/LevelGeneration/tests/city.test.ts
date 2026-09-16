import { expect, it } from "vitest";
import { generateCity, type CitySettings } from "../src/core/city";
import { generate } from "../src/core/generate";
import {
  createDocument,
  exportDocument,
  loadDocument,
  profileData,
  canonicalJSON,
} from "../src/core/document";
const settings: CitySettings = {
  seed: 42,
  blocks: 3,
  lotSize: 4,
  streetWidth: 2,
  maxHeight: 6,
  density: 100,
  layout: "grid",
};
it("seeded city generation creates separated, bounded lots through the common navigation-free shell path", () => {
  const city = generateCity(settings);
  expect(city.lots).toHaveLength(9);
  expect(generateCity(settings)).toEqual(city);
  expect(generateCity({ ...settings, seed: 43 }).cells).not.toEqual(city.cells);
  for (const c of city.cells) {
    expect(c[0] % 6).toBeLessThan(4);
    expect(c[2] % 6).toBeLessThan(4);
    expect(c[1]).toBeLessThan(6);
  }
  const result = generate(city.cells, {
    seed: 42,
    ...profileData("crafted-hip"),
  });
  expect(result.status).toBe("ok");
  expect(result.counters.componentCount).toBe(9);
  expect(result.counters.fallbackCount).toBe(0);
  const doc = loadDocument(
    exportDocument(createDocument(city.cells, 42, "crafted-hip")),
  );
  expect(
    generate(doc.grid, { seed: doc.seed, ...profileData(doc.catalog.id) }),
  ).toEqual(result);
});
it("courtyard, density and size limits have explicit behavior", () => {
  expect(generateCity({ ...settings, layout: "courtyard" }).lots).toHaveLength(
    8,
  );
  expect(generateCity({ ...settings, density: 0 }).cells).toEqual([]);
  expect(() =>
    generateCity({ ...settings, blocks: 4, lotSize: 6, streetWidth: 4 }),
  ).toThrow("32");
  expect(() => generateCity({ ...settings, maxHeight: 2.5 })).toThrow("정수");
  expect(() => generateCity({ ...settings, seed: -1 })).toThrow("seed");
});
it("portable city authoring golden", async () => {
  await expect(canonicalJSON(generateCity(settings))).toMatchFileSnapshot(
    "../fixtures/city-golden.json",
  );
});
