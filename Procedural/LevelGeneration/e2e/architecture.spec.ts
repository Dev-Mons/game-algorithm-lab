import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generate } from "../src/core/generate";
import {
  loadDocument,
  exportDocument,
  profileData,
} from "../src/core/document";

test("region interpretation, architectural style, batched picking and v1/v2 persistence", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".inspect-details summary").first().click();
  await page.locator(".layers summary").click();
  await expect(page.locator("#profile")).toHaveValue("crafted-hip");
  await page.locator("#profile").selectOption("village");
  await expect(page.locator("#timings")).toContainText("출입구 9개");
  await page.locator("#fixture").selectOption("annex");
  await page.locator("#region").selectOption("r:3,1,0|PY");
  await expect(page.locator("#region-info")).toContainText("낮은 별동 지붕");
  await expect(page.locator("#region-info")).toContainText("12면");
  await expect(page.locator("#inspector")).toContainText("ROOF");
  await page.locator("#layer-regions").check();
  await page.locator("#profile").selectOption("reference");
  await page.locator("#face").selectOption("3,1,0|PY");
  await expect(page.locator("#inspector")).toContainText("TERRACE");
  await expect(page.locator("#region")).toBeDisabled();
  await page.locator("#profile").selectOption("village");
  await page.locator("#face").selectOption("3,1,0|PY");
  await expect(page.locator("#inspector")).toContainText("ROOF");
  await page.locator("#fixture").selectOption("facade");
  await page.locator("#face").selectOption("1,0,2|PZ");
  await expect(page.locator("#inspector")).toContainText("facade.entry");
  await page.getByRole("button", { name: "↓ 상부", exact: true }).click();
  const bounds = (await page.locator("#viewport canvas").boundingBox())!;
  await page
    .locator("#viewport canvas")
    .click({ position: { x: bounds.width * 0.53, y: bounds.height * 0.49 } });
  const picked = JSON.parse((await page.locator("#trace").textContent())!);
  expect(picked.direction).toBe("PY");
  expect(picked.selection.ruleId).toBe("architecture.roof");
  await page.locator("#seed").fill("12345");
  await page.locator("#seed").press("Tab");
  await page.locator("#face").selectOption("1,0,2|PZ");
  const trace = await page.locator("#trace").textContent();
  async function save(name: string) {
    const wait = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await wait;
    const path = testInfo.outputPath(name);
    await download.saveAs(path);
    return { path, text: await readFile(path, "utf8") };
  }
  const saved = await save("architecture.json");
  const input = loadDocument(saved.text);
  expect(input.schemaVersion).toBe(2);
  expect(input.algorithmVersion).toBe("architecture-v1");
  const result = generate(input.grid, {
    seed: input.seed,
    ...profileData(input.catalog.id),
  });
  expect(JSON.parse(trace!)).toEqual(
    result.traces.find((t) => t.faceId === "1,0,2|PZ"),
  );
  await page.locator("#new").click();
  await page.locator("#file").setInputFiles(saved.path);
  await expect(page.locator("#profile")).toHaveValue("village");
  await expect(page.locator("#status")).toHaveText("OK");
  await page.locator("#face").selectOption("1,0,2|PZ");
  expect(await page.locator("#trace").textContent()).toBe(trace);
  expect((await save("restored.json")).text).toBe(saved.text);
  const legacy = JSON.parse(
    await readFile("fixtures/golden/step.json", "utf8"),
  );
  const legacyDocument = exportDocument(
    loadDocument(JSON.stringify(legacy.input)),
  );
  await page.locator("#file").setInputFiles({
    name: "legacy-v1.json",
    mimeType: "application/json",
    buffer: Buffer.from(legacyDocument),
  });
  await expect(page.locator("#profile")).toHaveValue("variants");
  await expect(page.locator("#version-tag")).toHaveText("SHELL-V1");
  await expect(page.locator("#face option")).toHaveCount(14);
  expect((await save("legacy-restored.json")).text).toBe(legacyDocument);
  expect(errors).toEqual([]);
});
