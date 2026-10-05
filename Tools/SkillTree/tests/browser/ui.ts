import type { Page } from '@playwright/test';

export async function closeSettings(page: Page) {
  if (await page.locator('#settings-dialog').isVisible()) await page.locator('#settings-done').click();
}
export async function settings(page: Page) {
  if (!await page.locator('#settings-dialog').isVisible()) await page.locator('#open-settings').click();
}
export async function editPreset(page: Page, id?: string) {
  await settings(page);
  if (await page.locator('#settings-presets').getAttribute('aria-selected') !== 'true') await page.locator('#settings-presets').click();
  if (id) await page.locator(`[data-preset=${id}]`).click();
}
export async function newPreset(page: Page) { await editPreset(page); await page.locator('#new-preset').click(); }
export async function targets(page: Page) { await settings(page); await page.locator('#manage-targets').click(); }
export async function selectNode(page: Page, id: string) {
  await closeSettings(page);
  await placedList(page);
  await page.locator(`[data-select=${id}]`).click();
}
export async function placedList(page: Page) {
  if (await page.locator('#placed-nodes').getAttribute('open') === null) await page.locator('#placed-nodes>summary').click();
}
export async function place(page: Page, id: string) { await closeSettings(page); await page.locator(`[data-place=${id}]`).click(); }
export async function fileAction(page: Page, id: string) {
  await closeSettings(page);
  if (await page.locator('#file-menu').getAttribute('open') === null) await page.locator('#file-menu>summary').click();
  await page.locator('#' + id).click();
}
export async function exportProject(page: Page) {
  await closeSettings(page);
  if (!await page.locator('#settings-dialog').isVisible()) await page.locator('#export').click();
}
export async function saveProject(page: Page) { await closeSettings(page); await page.locator('#save').click(); }
export async function undo(page: Page) { await closeSettings(page); await page.locator('#undo').click(); }
