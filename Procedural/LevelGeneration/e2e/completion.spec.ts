import {generateDocument} from '../src/core/generate-document';
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generate, validateAssembly } from "../src/core/generate";
import {
  createDocument,
  loadDocument,
  profileData,
} from "../src/core/document";

test("current styles, city generation and save/load work together", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("OK");
  await page.locator(".inspect-details summary").first().click();
  await page.locator("#fixture").selectOption("facade");
  for(const profile of ['shop','office']){await page.locator('#profile').selectOption(profile);await expect(page.locator('#status')).toHaveText('OK');await page.locator('#face').selectOption('1,1,2|PZ');await expect(page.locator('#facade-info')).toContainText('스타일');}
  await page.locator("#new").click();
  await page.locator(".city-tools summary").click();
  await page.locator("#city-layout").selectOption("courtyard");
  await page.locator("#city-generate").click();
  await expect(page.locator("#status")).toHaveText("OK");
  await expect(page.locator("#stats strong").nth(3)).toHaveText("8");
  async function save(name: string) {
    const wait = page.waitForEvent("download");
    await page.locator("#save").click();
    const file = await wait,
      path = testInfo.outputPath(name);
    await file.saveAs(path);
    return { path, text: await readFile(path, "utf8") };
  }
  const saved = await save("city-v3.json"),
    doc = loadDocument(saved.text),
    result = generateDocument(doc);
  expect(doc.schemaVersion).toBe(6);
  expect(result.status).toBe("ok");
  expect(result.modules).toEqual([]);
  // B now includes its flush belts and parapets in each authored tile.
  expect(result.placements.flatMap(p=>p.finishIds??[])).toEqual([]);
  expect(result.placements.some(p=>p.tileId.includes('curtain-b-'))).toBe(true);
  validateAssembly(
    result.surfaces.map((s) => s.faceId),
    result.placements,
    result.modules!,
  );
  await page.locator("#new").click();
  await page.locator("#file").setInputFiles(saved.path);
  await expect(page.locator("#status")).toHaveText("OK");
  expect((await save("restored-v3.json")).text).toBe(saved.text);
  await page.screenshot({
    path: testInfo.outputPath("crafted-city.png"),
    fullPage: true,
  });
  const corrupt = JSON.parse(saved.text);
  corrupt.catalog.modules[0].bounds16.max[0] += 1;
  await page.locator("#file").setInputFiles({
    name: "invalid-module.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(corrupt)),
  });
  await expect(page.locator("#error")).toContainText("metadata");
  await page.locator("#retry").click();
  await expect(page.locator("#status")).toHaveText("OK");
  const large = createDocument(
    [[999_999, 0, 999_999]],
    42,
    "office",
  );
  await page.locator("#file").setInputFiles({
    name: "large-coordinate.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(large)),
  });
  await expect(page.locator("#status")).toHaveText("OK");
  await page.getByRole("button", { name: "↓ 상부", exact: true }).click();
  const viewport = (await page.locator("#viewport canvas").boundingBox())!;
  await page
    .locator("#viewport canvas")
    .click({ position: { x: viewport.width / 2, y: viewport.height / 2 } });
  await expect(page.locator("#face")).toHaveValue("999999,0,999999|PY");
  await expect(page.locator("#inspector")).toContainText("building.roof-finish");
  await expect(page.locator("#inspector")).toContainText("curtain-b-roof");
  expect(errors).toEqual([]);
});
