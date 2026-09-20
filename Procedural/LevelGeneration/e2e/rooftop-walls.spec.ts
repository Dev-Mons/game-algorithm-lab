import { test, expect, type Page } from '@playwright/test';
import { createDocument } from '../src/core/document';
import { box } from '../src/fixtures';
import { expectCompleteFaces } from './complete-faces';
import { generateDocument } from '../src/core/generate-document';

async function load(page: Page, document: ReturnType<typeof createDocument>) {
  await page.locator('#file').setInputFiles({ name: 'rooftop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.locator('#status')).toHaveText('OK');
}
async function inspect(page: Page, faceId: string, rooftop: boolean) {
  await page.locator('#face').selectOption(faceId);
  await expect(page.locator('#facade-info')).toContainText(rooftop ? '옥상 외벽' : '일반 외벽');
  const trace = JSON.parse((await page.locator('#trace').textContent())!);
  expect(trace.wallKind).toBe(rooftop ? 'rooftop' : 'regular');
  expect(trace.selection.tileId.startsWith('facade.rooftop-')).toBe(rooftop);
}

test('setback roofs render style variants and live height edits move the rooftop rule with Undo/Redo', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.locator('.inspect-details > summary').click();
  for (const profile of ['shop', 'office'] as const) {
    const document=createDocument(box(6,5,4).filter(([x,y]) => y < 2 || x >= 3), 42, profile);
    await load(page, document);
    await expectCompleteFaces(page,generateDocument(document));
    await inspect(page, '0,1,0|NX', true);
    await inspect(page, '5,4,3|PX', true);
    await inspect(page, '5,3,3|PX', false);
    await page.screenshot({ path: info.outputPath(`rooftop-${profile}.png`) });
  }
  await load(page, createDocument([[0,0,0]], 42, 'shop'));
  await inspect(page, '0,0,0|NX', true);
  await page.locator('[data-camera="top"]').click();
  const canvas = page.locator('canvas'), b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('#face')).toHaveValue('0,0,0|PY');
  await expect(page.locator('#inspector')).toContainText('face-v1|facade.city-roof|plain');
  await expect(canvas).toHaveAttribute('data-selection-direction', 'PY');
  await page.keyboard.press('e');
  await inspect(page, '0,0,0|NX', false);
  await inspect(page, '0,1,0|NX', true);
  await canvas.focus();
  await page.keyboard.press('q');
  await inspect(page, '0,0,0|NX', true);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await inspect(page, '0,0,0|NX', false);
  await canvas.focus();
  await page.keyboard.press('Control+Shift+z');
  await inspect(page, '0,0,0|NX', true);
  expect(errors).toEqual([]);
});
