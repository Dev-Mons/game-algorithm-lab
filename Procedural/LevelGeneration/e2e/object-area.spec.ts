import { test, expect } from "@playwright/test";
import { createDocument, loadDocument } from "../src/core/document";
import { generateDocument } from "../src/core/generate-document";

for (const category of ["lighting", "vegetation", "facility"] as const) {
  test(`${category} drag preserves a multi-cell installation area`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const grid = Array.from({ length: 9 }, (_, i) => [
      i % 3,
      0,
      Math.floor(i / 3),
    ]);
    await page
      .locator("#file")
      .setInputFiles({
        name: "area.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(createDocument(grid, 42, "shop"))),
      });
    await page.locator('[data-camera="top"]').click();
    await page.locator("#edit-mode").selectOption("object");
    await page.locator("#object-category").selectOption(category);
    const b = (await page.locator("canvas").boundingBox())!,
      x = b.x + b.width / 2,
      y = b.y + b.height / 2,
      extent = b.height * 0.15;
    await page.mouse.move(x - extent, y - extent);
    await page.mouse.down();
    await page.mouse.move(x + extent, y + extent, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator("#edit-note")).toContainText("설치 완료");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#save").click();
    const stream = await (await downloadPromise).createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const saved = loadDocument(Buffer.concat(chunks).toString());
    const input = saved.sceneInputs!.objects[0];
    expect(input.cells).toHaveLength(9);
    const placements = generateDocument(saved).scenePlacements!;
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-scene-assets",
      placements.map((p) => p.asset).join(","),
    );
    if (category === "lighting") {
      const lamps = placements.filter((p) => p.asset === "roof-beacon");
      expect(lamps).toHaveLength(9);
      expect(
        new Set(lamps.map((p) => `${p.center[0]},${p.center[2]}`)).size,
      ).toBe(9);
    } else {
      expect(placements.some((p) => p.size[0] > 1 && p.size[2] > 1)).toBe(true);
    }
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-selection-cells",
      "9",
    );
    await page.mouse.click(x, y);
    if (category === "vegetation")
      await expect(page.locator("canvas")).toHaveAttribute(
        "data-scene-assets",
        "tree-bottom,tree-top",
      );
    await page.mouse.click(x, y, { button: "right" });
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-scene-assets",
      placements.map((p) => p.asset).join(","),
    );
    if (category === "facility") {
      await page.keyboard.press("Escape");
      await page.mouse.move(x - 5, y - 5);
      await page.mouse.down();
      await page.mouse.move(x + 5, y + 5, { steps: 4 });
      await page.mouse.up();
      await expect(page.locator("canvas")).toHaveAttribute(
        "data-selection-cells",
        "1",
      );
      const partialDownload = page.waitForEvent("download");
      await page.locator("#save").click();
      const partialStream = await (await partialDownload).createReadStream(),
        partialChunks: Buffer[] = [];
      for await (const chunk of partialStream!)
        partialChunks.push(Buffer.from(chunk));
      const partial = loadDocument(Buffer.concat(partialChunks).toString());
      expect(partial.sceneInputs!.objects.flatMap((o) => o.cells)).toHaveLength(
        10,
      );
      expect(partial.grid).toEqual(saved.grid);
    }
    await page.screenshot({ path: info.outputPath(`${category}-area.png`) });
  });
}
