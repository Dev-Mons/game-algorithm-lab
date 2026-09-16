import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generate, validateAssembly } from "../src/core/generate";
import {
  createDocument,
  loadDocument,
  profileData,
} from "../src/core/document";

test("3D styles, city generation and v3 save/load work together", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("OK");
  await page.locator(".inspect-details summary").first().click();
  await page.locator("#fixture").selectOption("facade");
  for (const [profile, roof] of [
    ["crafted-hip", "roof.hip-x"],
    ["crafted-gable", "roof.gable-x"],
    ["crafted-flat", "roof.flat"],
  ]) {
    await page.locator("#profile").selectOption(profile);
    await page.locator("#face").selectOption("0,2,0|PY");
    await expect(page.locator("#inspector")).toContainText(roof);
    await expect(page.locator("#inspector")).toContainText("12면을 대체");
    await page.locator("#attachment").selectOption({ index: 1 });
    await expect(page.locator("#inspector")).toContainText("eave.straight");
    const attachment = JSON.parse(
      (await page.locator("#trace").textContent())!,
    ).attachment;
    expect(attachment.faceIds).toEqual([]);
    expect(attachment.clearanceCell).toEqual([-1, 3, 0]);
    await page.locator("#attachment").selectOption("");
  }
  await page.locator("#profile").selectOption("crafted-hip");
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
    result = generate(doc.grid, {
      seed: doc.seed,
      ...profileData(doc.catalog.id),
    });
  expect(doc.schemaVersion).toBe(3);
  expect(result.status).toBe("ok");
  expect(result.modules!.length).toBeGreaterThan(0);
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
    [[1_000_000, 0, 1_000_000]],
    42,
    "crafted-gable",
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
  await expect(page.locator("#face")).toHaveValue("1000000,0,1000000|PY");
  await expect(page.locator("#inspector")).toContainText("roof.gable-x");
  expect(errors).toEqual([]);
});
