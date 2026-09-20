import {generateDocument} from '../src/core/generate-document';
import { expect, test } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { createDocument, loadDocument, profileData } from "../src/core/document";
import { generate } from "../src/core/generate";

test("edit stepped volume, inspect overhang, save/reload, display invariance and errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("OK");
  await page.locator(".inspect-details summary").first().click();
  await page.locator(".layers summary").click();
  await page.locator("#fixture").selectOption("single");
  await page.locator("#profile").selectOption("office");
  async function importGrid(grid: number[][]) {
    await page.locator("#file").setInputFiles({ name: "edit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createDocument(grid, 42, "office"))) });
  }
  await importGrid([[0,0,0],[1,0,0],[1,1,0]]);
  await expect(page.locator("#face option")).toHaveCount(14);
  await page.locator("#face").selectOption("0,0,0|PY");
  await expect(page.locator("#inspector")).toContainText("TERRACE");
  await page
    .locator("summary")
    .filter({ hasText: "선택 Trace · 전체 근거" })
    .click();
  const trace = await page.locator("#trace").textContent();
  expect(JSON.parse(trace!).selection.ruleId).toBe("building.roof-finish");
  expect(JSON.parse(trace!).selection.tileId).toContain("facade.city-terrace.");
  await importGrid([[0,0,0],[1,0,0],[1,1,0],[2,1,0]]);
  await page.locator("#face").selectOption("2,1,0|NY");
  await expect(page.locator("#inspector")).toContainText("overhang");
  await page.getByRole("button", { name: "↥ 하부", exact: true }).click();
  await page.getByLabel("표시용 기준면 높이", { exact: true }).fill("-4");
  await page.getByLabel("표시용 기준면 높이", { exact: true }).press("Tab");
  await page.locator("#layer-voxels").check();
  await page.locator("#layer-surfaces").check();
  await page.locator("#layer-normals").check();
  async function save(name: string) {
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await downloadPromise;
    const path = testInfo.outputPath(name);
    await download.saveAs(path);
    return { path, text: await readFile(path, "utf8") };
  }
  const saved = await save("city.json"),
    input = loadDocument(saved.text);
  const expected = generateDocument(input);
  expect(expected.status).toBe("ok");
  expect(expected.cells).toHaveLength(4);
  await page.locator("#new").click();
  await expect(page.locator("#face option")).toHaveCount(0);
  await page.locator("#file").setInputFiles(saved.path);
  await expect(page.locator("#status")).toHaveText("OK");
  await expect(page.locator("#face option")).toHaveCount(
    expected.surfaces.length,
  );
  const restored = await save("restored.json");
  expect(restored.text).toBe(saved.text);
  await page.locator("#face").selectOption("2,1,0|NY");
  expect(JSON.parse((await page.locator("#trace").textContent())!)).toEqual(
    expected.traces.find((t) => t.faceId === "2,1,0|NY"),
  );
  await page.getByRole("button", { name: "↓ 상부", exact: true }).click();
  await page.locator("#layer-placements").uncheck();
  expect((await save("display-changed.json")).text).toBe(saved.text);
  const invalid = JSON.parse(saved.text);
  invalid.grid.push([32,0,0]);
  await page.locator("#file").setInputFiles({ name: "too-wide.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator("#status")).toHaveText("ERROR");
  await expect(page.locator("#error")).toContainText("32 cells");
  await expect(page.locator("#save")).toBeEnabled();
  await expect(page.locator("#face option")).toHaveCount(expected.surfaces.length);
  await page.locator("#retry").click();
  await expect(page.locator("#status")).toHaveText("OK");
  await page.locator("#file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(page.locator("#error")).toContainText("UNSUPPORTED_DOCUMENT_VERSION");
  await page.locator("#fixture").selectOption("vertexContact");
  await expect(page.locator("#status")).toHaveText("DEGRADED");
  await expect(page.locator("#diagnostics")).toContainText(
    "NON_MANIFOLD_VERTEX",
  );
  await expect(page.locator("#face option")).toHaveCount(12);
  expect(errors).toEqual([]);
});
