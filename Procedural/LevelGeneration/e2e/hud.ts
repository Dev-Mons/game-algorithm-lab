import type { Page } from "@playwright/test";

/** Opens a viewport HUD menu (generate · layers · help · inspect) unless it is already open. */
export async function openMenu(page: Page, menu: "generate" | "layers" | "help" | "inspect") {
  const details = page.locator(`details[data-menu="${menu}"]`);
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open))) await details.locator(":scope > summary").click();
}
