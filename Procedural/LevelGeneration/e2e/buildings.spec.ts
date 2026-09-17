import { test, expect } from "@playwright/test";
import { createDocument } from "../src/core/document";
test("click selects whole building, theme preserves volume, Escape hides panel and history restores theme", async ({ page }) => {
  await page.goto("/");
  await page.locator("#file").setInputFiles({ name: "building.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createDocument([[0,0,0],[0,1,0]],42,"shop"))) });
  await page.locator('[data-camera="top"]').click();
  const b = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  await expect(page.locator("#building-selection")).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute("data-building-id","0,0,0");
  await page.locator("#building-theme").selectOption("office");
  await expect(page.locator("#stats strong").first()).toHaveText("2");
  await page.locator("canvas").focus(); await page.keyboard.press("Control+z");
  await expect(page.locator("#building-theme")).toHaveValue("shop");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#building-theme")).toHaveValue("office");
  await page.keyboard.press("Escape");
  await expect(page.locator("#building-selection")).toBeHidden();
});
