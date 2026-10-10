import * as ui from './ui';
import { expect, test, type Page } from '@playwright/test';

async function machineGun(page: Page) {
  await page.goto('/');
  await ui.fileAction(page, 'machinegun');
  await page.locator('#fit').click();
}
const node = (page: Page, id: string) => page.locator(`[data-node=${id}]`);
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('skill-tree-studio.v1')!));

test('playtest invests and refunds with the export rules without touching the project', async ({ page }) => {
  await machineGun(page);
  const before = JSON.stringify(await saved(page));
  await page.locator('#mode-play').click();
  await expect(page.locator('#play-hud')).toContainText('20');
  await expect(node(page, 'MachineGunFireRate')).toHaveClass(/state-locked/);
  await node(page, 'MachineGunFireRate').click();
  await expect(page.locator('#notice')).toContainText('선행 조건');

  await node(page, 'MachineGunDamage').click();
  await node(page, 'MachineGunDamage').click();
  await expect(node(page, 'MachineGunDamage').locator('.investment-limit')).toHaveText('2/5');
  await expect(node(page, 'MachineGunFireRate')).toHaveClass(/state-available/);
  await node(page, 'MachineGunFireRate').click();
  await node(page, 'MachineGunRange').click();
  await expect(node(page, 'MachineGunPierce')).toHaveClass(/state-available/);
  await expect(page.locator('.edge.lit')).toHaveCount(4);
  await expect(page.locator('.stat-total')).toHaveCount(3);
  await expect(page.locator('.play-description')).toContainText('투자 후');

  // Range is required by Pierce only after Pierce is invested.
  await node(page, 'MachineGunPierce').click();
  await node(page, 'MachineGunRange').click({ button: 'right' });
  await expect(page.locator('#notice')).toContainText('회수할 수 없습니다');
  await node(page, 'MachineGunPierce').click({ modifiers: ['Shift'] });
  await expect(node(page, 'MachineGunPierce').locator('.investment-limit')).toHaveText('0/1');

  await page.locator('[name=PlayBudget]').fill('3');
  await page.locator('[name=PlayBudget]').press('Enter');
  await expect(page.locator('#play-hud strong')).toHaveText('-1');
  await node(page, 'MachineGunDamage').click();
  await expect(page.locator('#notice')).toContainText('보유 포인트');
  await page.locator('#play-reset').click();
  await expect(page.locator('#play-hud strong')).toHaveText('3');

  // Playtest state is session-only and edit affordances are hidden.
  await expect(page.locator('.new-connection-pin').first()).toBeHidden();
  expect(JSON.stringify(await saved(page))).toBe(before);
  await page.keyboard.press('p');
  await expect(page.locator('#mode-edit')).toHaveAttribute('aria-pressed', 'true');
  await expect(node(page, 'MachineGunDamage').locator('.investment-limit')).toHaveText('×5');
});

test('multi-select moves, aligns, nudges and deletes several nodes as one undoable step', async ({ page }) => {
  await machineGun(page);
  await node(page, 'MachineGunFireRate').click();
  await node(page, 'MachineGunRange').click({ modifiers: ['Shift'] });
  await expect(page.locator('#inspector-status')).toHaveText('MULTI');
  await expect(page.locator('.skill-node.multi')).toHaveCount(2);

  const box = (await node(page, 'MachineGunRange').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  let nodes = (await saved(page)).nodes;
  const fireRate = nodes.find((item: { Name: string }) => item.Name === 'MachineGunFireRate'), range = nodes.find((item: { Name: string }) => item.Name === 'MachineGunRange');
  expect(fireRate.X).toBe(range.X);
  expect(fireRate.X).toBeGreaterThan(192);

  await page.keyboard.press('ArrowDown');
  nodes = (await saved(page)).nodes;
  expect(nodes.find((item: { Name: string }) => item.Name === 'MachineGunFireRate').Y).toBe(48);
  await page.locator('[data-align=top]').click();
  await page.locator('#issues-toggle').click();
  await expect(page.locator('.issue.level-warning')).toContainText('겹칩니다');
  await expect(page.locator('#issue-count')).toHaveText('1');
  await page.locator('.issue').first().click();
  await expect(page.locator('.skill-node.issue-highlight')).toHaveCount(2);
  await ui.undo(page);
  await expect(page.locator('#issues-panel')).toContainText('문제 없음');
  await expect(page.locator('.issue-highlight')).toHaveCount(0);

  await page.locator('#canvas').click({ position: { x: 20, y: 300 } });
  const canvas = (await page.locator('#canvas').boundingBox())!;
  const damage = (await node(page, 'MachineGunDamage').boundingBox())!;
  const pierce = (await node(page, 'MachineGunPierce').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(damage.x - 10, canvas.y + 60);
  await page.mouse.down();
  await page.mouse.move(pierce.x + 5, canvas.y + canvas.height - 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.skill-node.multi')).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.skill-node')).toHaveCount(0);
  await ui.undo(page);
  await expect(page.locator('.skill-node')).toHaveCount(4);
});
