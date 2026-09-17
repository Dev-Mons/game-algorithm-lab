import { test, expect } from "@playwright/test";
import { createDocument, setBuildingRule } from "../src/core/document";
test("special rule renders, remains selectable, preserves theme independence and supports edit/history/JSON", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const grid = Array.from({ length: 18 }, (_, i) => [
    i % 3,
    Math.floor(i / 9),
    Math.floor(i / 3) % 3,
  ]);
  const doc = createDocument(grid, 42, "shop");
  await page
    .locator("#file")
    .setInputFiles({
      name: "rule.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(doc)),
    });
  await page.locator('[data-camera="top"]').click();
  const canvas = page.locator("canvas"),
    b = (await canvas.boundingBox())!,
    x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  await page.mouse.click(x, y);
  await page.locator("#building-rule").selectOption("parking");
  await expect(canvas).toHaveAttribute("data-scene-assets", /parking-deck/);
  await expect(page.locator("#stats strong").first()).toHaveText("18");
  await page.locator("#building-theme").selectOption("office");
  await expect(page.locator("#building-rule")).toHaveValue("parking");
  await page.locator('[data-camera="iso"]').click();
  await page.screenshot({ path: info.outputPath("parking-rule.png") });
  await page.locator('[data-camera="top"]').click();
  await canvas.focus();
  await page.keyboard.press("Escape");
  await page.mouse.click(x, y);
  await expect(page.locator("#building-rule")).toHaveValue("parking");
  await page.mouse.move(x - 5, y - 5);
  await page.mouse.down();
  await page.mouse.move(x + 5, y + 5, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#stats strong").first()).not.toHaveText("18");
  await expect(page.locator("#building-rule")).toHaveValue("parking");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#stats strong").first()).toHaveText("18");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save").click();
  const path = await (await downloadPromise).path();
  await page.locator("#new").click();
  await page.locator("#file").setInputFiles(path!);
  await expect(canvas).toHaveAttribute("data-scene-assets", /parking-deck/);
  const invalid = setBuildingRule(doc, "0,0,0", "parking");
  invalid.buildings![0].rule!.version = "99.0.0";
  await page
    .locator("#file")
    .setInputFiles({
      name: "unknown-rule.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(invalid)),
    });
  await expect(page.locator("#error")).toContainText(
    "Unsupported building rule version",
  );
  expect(errors).toEqual([]);
});
