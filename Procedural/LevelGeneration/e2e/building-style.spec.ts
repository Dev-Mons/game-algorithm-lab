import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  createDocument,
  documentOptions,
  loadDocument,
} from "../src/core/document";
import { generate, validateAssembly } from "../src/core/generate";
import { box } from "../src/fixtures";
import { OFFICE_STYLE } from "../src/core/building-style";

test("new styles render real joined windows, floor roles, traces, v4 persistence and direct-edit history", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  const input = createDocument(box(8, 4, 4), 42, "shop");
  await page.locator("#file").setInputFiles({
    name: "shop.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(input)),
  });
  await page.locator(".inspect-details summary").first().click();
  for (const style of ["shop", "office"]) {
    await page.locator("#profile").selectOption(style);
    await expect(page.locator("#status")).toHaveText("OK");
    await expect(page.locator("#version-tag")).toHaveText(
      "BUILDING-PATTERNS-V2",
    );
    await page.locator("#face").selectOption("1,1,3|PZ");
    await expect(page.locator("#facade-info")).toContainText(
      `스타일 ${style} v3`,
    );
    const left = JSON.parse(
      (await page.locator("#trace").textContent())!,
    ).facade;
    expect(left.part).toBe("left");
    await page.locator("#face").selectOption("2,1,3|PZ");
    const right = JSON.parse(
      (await page.locator("#trace").textContent())!,
    ).facade;
    expect(right.part).toBe("right");
    expect(right.groupId).toBe(left.groupId);
    await page.locator("#face").selectOption("3,0,3|PZ");
    await expect(page.locator("#facade-info")).toContainText(
      "층 ground · front",
    );
    await expect(page.locator("#facade-info")).toContainText("패턴 entrance");
    await page.locator("#face").selectOption("1,3,3|PZ");
    await expect(page.locator("#facade-info")).toContainText("층 top");
    await expect(page.locator("#facade-info")).toContainText("상단 마감 있음");
    await page.screenshot({ path: info.outputPath(`${style}-facade.png`) });
    await page.locator("#fixture").selectOption("styleGallery");
    await expect(page.locator("#status")).toHaveText("OK");
    await page.screenshot({
      path: info.outputPath(`${style}-height-gallery.png`),
    });
    await page.locator("#fixture").selectOption("symmetryGallery");
    await page.locator("#face").selectOption("1,1,3|PZ");
    await expect(page.locator("#facade-info")).toContainText("조각 left");
    await page.locator("#face").selectOption("10,1,3|PZ");
    await expect(page.locator("#facade-info")).toContainText("조각 single");
    await page.locator("#face").selectOption("11,1,3|PZ");
    const centerPier = JSON.parse(
      (await page.locator("#trace").textContent())!,
    ).facade;
    expect(centerPier.moduleId).toBe(style === "shop" ? "pier" : "office-pier");
    await page.screenshot({
      path: info.outputPath(`${style}-symmetric-facades.png`),
    });
    await page.locator("#fixture").selectOption("evenEntrance");
    for (const x of [6, 7]) {
      await page.locator("#face").selectOption(`${x},0,2|PZ`);
      const entry = JSON.parse(
        (await page.locator("#trace").textContent())!,
      ).facade;
      expect(entry.patternId).toBe("entrance");
      expect(entry.entranceSpan).toBe(2);
    }
    await page.screenshot({
      path: info.outputPath(`${style}-14-cell-entrance.png`),
    });
    await page.locator("#file").setInputFiles({
      name: "shop.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(input)),
    });
  }
  const custom = structuredClone(OFFICE_STYLE);
  custom.version = 4;
  custom.levels[0].count = 2;
  await page.locator("#file").setInputFiles({
    name: "custom-office.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify(createDocument(box(8, 4, 4), 42, "office", custom)),
    ),
  });
  await page.locator("#face").selectOption("1,1,3|PZ");
  await expect(page.locator("#facade-info")).toContainText(
    "office v4 · 층 ground",
  );
  async function save(name: string) {
    const waiting = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await waiting;
    const path = info.outputPath(name);
    await download.saveAs(path);
    const text = await readFile(path, "utf8");
    return { path, text, doc: loadDocument(text) };
  }
  const before = await save("before.json");
  await page.locator('[data-camera="top"]').click();
  const canvas = (await page.locator("canvas").boundingBox())!;
  const x = canvas.x + canvas.width / 2 + 10,
    y = canvas.y + canvas.height / 2 + 10;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 8, y + 8, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-selection-cells",
    "1",
  );
  const after = await save("removed.json");
  expect(after.doc.grid).toHaveLength(before.doc.grid.length - 1);
  expect(after.doc.buildingDefinition).toEqual(custom);
  const result = generate(after.doc.grid, documentOptions(after.doc));
  validateAssembly(
    result.surfaces.map((s) => s.faceId),
    result.placements,
    result.modules!,
  );
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+z");
  expect((await save("undo.json")).text).toBe(before.text);
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Shift+z");
  expect((await save("redo.json")).text).toBe(after.text);
  await page.locator("#new").click();
  await page.locator("#file").setInputFiles(before.path);
  expect((await save("restored.json")).text).toBe(before.text);
  await page.locator("#face").selectOption("1,1,3|PZ");
  await expect(page.locator("#facade-info")).toContainText(
    "office v4 · 층 ground",
  );
  expect(errors).toEqual([]);
});
