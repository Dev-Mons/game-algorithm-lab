import { test, expect, type Page } from "@playwright/test";
import { createDocument } from "../src/core/document";

async function load(page: Page, grid: number[][]) {
  await page.locator("#file").setInputFiles({ name: "surface.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(createDocument(grid, 42, "office"))) });
  await page.locator('[data-camera="top"]').click();
}
async function center(page: Page) {
  const b = (await page.locator("canvas").boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, height: b.height, width: b.width };
}
async function drag(page: Page, button: "left" | "right", extent = 8) {
  const c = await center(page);
  await page.mouse.move(c.x - extent, c.y - extent);
  await page.mouse.down({ button });
  await page.mouse.move(c.x + extent, c.y + extent, { steps: 8 });
  await page.mouse.up({ button });
}
const count = (page: Page) => page.locator("#stats strong").first();

test("left drag adds on release, selection follows, alternating clicks and Escape gate edits", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await load(page, [[0, 0, 0]]);
  await expect(page.locator("#cell-form, #extrude-one, #box-add, #region-extrude, #undo, #redo")).toHaveCount(0);
  const c = await center(page);
  await page.mouse.click(c.x, c.y);
  await expect(count(page)).toHaveText("1");
  await page.mouse.move(c.x - 8, c.y - 8);
  await page.mouse.down();
  await page.mouse.move(c.x + 8, c.y + 8, { steps: 6 });
  await expect(count(page)).toHaveText("1");
  await page.mouse.up();
  await expect(count(page)).toHaveText("2");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "1");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-direction", "PY");
  await page.mouse.click(c.x, c.y);
  await expect(count(page)).toHaveText("3");
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(c.x, c.y, { button: "right" });
    await expect(count(page)).toHaveText("2");
    await page.mouse.click(c.x, c.y);
    await expect(count(page)).toHaveText("3");
  }
  await page.screenshot({ path: info.outputPath("surface-selection.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "0");
  await page.mouse.click(c.x, c.y);
  await page.mouse.click(c.x, c.y, { button: "right" });
  await expect(count(page)).toHaveText("3");
  await page.keyboard.press("Control+z");
  await expect(count(page)).toHaveText("2");
  await page.keyboard.press("Control+Shift+z");
  await expect(count(page)).toHaveText("3");
  expect(errors).toEqual([]);
});

test("right drag removes the last layer, empty selection can restore, empty ground starts a new volume", async ({ page }) => {
  await page.goto("/");
  await load(page, [[0,0,0]]);
  const c = await center(page);
  await drag(page, "right");
  await expect(count(page)).toHaveText("0");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "1");
  await page.mouse.click(c.x, c.y, { button: "right" });
  await expect(count(page)).toHaveText("0");
  await page.mouse.click(c.x, c.y);
  await expect(count(page)).toHaveText("1");
  await page.mouse.click(c.x, c.y, { button: "right" });
  await expect(count(page)).toHaveText("0");
  await page.keyboard.press("Escape");
  await drag(page, "left");
  await expect(count(page)).toHaveText("1");
  await page.locator("#fixture").selectOption("single");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "0");
});

test("multi-cell rectangle stays selected across whole-layer edits; cancellation and camera never commit", async ({ page }, info) => {
  await page.goto("/");
  const grid = Array.from({length:9}, (_,i) => [i % 3, 0, Math.floor(i / 3)]);
  await load(page, grid);
  const c = await center(page);
  await drag(page, "left", c.height * .15);
  await expect(count(page)).toHaveText("18");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "9");
  await page.mouse.click(c.x, c.y, {button:"right"});
  await expect(count(page)).toHaveText("9");
  await page.mouse.click(c.x, c.y);
  await expect(count(page)).toHaveText("18");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({button:"middle"});
  await page.mouse.move(c.x + 100, c.y + 70, {steps:12});
  await page.mouse.up({button:"middle"});
  await page.mouse.wheel(0, 100);
  await expect(count(page)).toHaveText("18");
  await page.screenshot({path:info.outputPath("area-on-roof.png")});
  await page.keyboard.press("Escape");
  await page.locator('[data-camera="top"]').click();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(count(page)).toHaveText("18");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-cells", "0");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(10,10);
  await page.mouse.up();
  await expect(count(page)).toHaveText("18");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x+20,c.y+20);
  await page.locator("canvas").dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(count(page)).toHaveText("18");
});

test("side faces use their normal and narrow viewport supports direct editing", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await load(page, [[0,0,0]]);
  await page.locator('[data-camera="iso"]').click();
  const c = await center(page);
  // The lower-right quadrant of the cube is its positive Z wall.
  await page.mouse.move(c.x+10,c.y+10);
  await page.mouse.down();
  await page.mouse.move(c.x+18,c.y+18,{steps:5});
  await page.mouse.up();
  await expect(count(page)).toHaveText("2");
  await expect(page.locator("canvas")).toHaveAttribute("data-selection-direction", /P[ZX]/);
  await page.mouse.click(c.x,c.y,{button:"right"});
  await expect(count(page)).toHaveText("1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
