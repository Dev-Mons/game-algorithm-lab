import { expect, test, type Page, type Locator } from '@playwright/test';
import { createNode, createProject } from '../../src/model';

async function setup(page: Page, edges: [string, string][] = []) {
  const project = createProject('연결 편집 검증');
  project.nodes = [createNode('A', 0, 0), createNode('B', 240, 0), createNode('C', 240, 240), createNode('D', 0, 240)];
  project.nodes.forEach(node => { node.DisplayName = node.Name; node.NodeSize = 48; });
  project.nodes[1].NodeShape = 'Circle';
  project.nodes[2].NodeShape = 'Diamond';
  for (const [from, to] of edges) project.nodes.find(node => node.Name === to)!.Prerequisites.push(from);
  await page.goto('/');
  await page.locator('#file').setInputFiles({ name: 'connections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('[data-node]')).toHaveCount(4);
}
const node = (page: Page, id: string) => page.locator(`[data-node=${id}]`);
const edge = (page: Page, from: string, to: string) => page.locator(`.edge[data-from=${from}][data-to=${to}]`);
const handle = (page: Page, from: string, to: string, endpoint: 'from' | 'to') => page.locator(`.connection-point[data-from=${from}][data-to=${to}][data-endpoint=${endpoint}]`);
async function center(locator: Locator) {
  const bounds = (await locator.boundingBox())!;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
async function drag(page: Page, from: Locator, to: Locator) {
  const start = await center(from), end = await center(to);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
}

test('drag previews the wire from the border, drops onto B, and keeps node positions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  // A pair of clicks now selects nodes; it must not silently create an edge.
  await node(page, 'A').click(); await node(page, 'B').click();
  await expect(page.locator('.edge')).toHaveCount(0);
  const a = (await node(page, 'A').boundingBox())!, b = await center(node(page, 'B'));
  const pin = await center(page.locator('[data-connect-node=A]'));
  await page.mouse.move(pin.x, pin.y); await page.mouse.down();
  await page.mouse.move((a.x + a.width + b.x) / 2, b.y, { steps: 6 });
  await expect(page.locator('.connection-preview')).toBeAttached();
  const previewStart = (await page.locator('.connection-preview').getAttribute('d'))!;
  expect(previewStart).toMatch(/^M48,24 L/);
  await page.screenshot({ path: 'artifacts/connection-drag.png' });
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await expect(page.locator('.connection-preview')).toHaveCount(0);
  await expect(page.locator('.connection-point')).toHaveCount(2);
  const start = await center(handle(page, 'A', 'B', 'from'));
  expect(start.x).toBeCloseTo(a.x + a.width, 0);
  expect(start.y).toBeCloseTo(a.y + a.height / 2, 0);
  expect((await node(page, 'A').boundingBox())!.x).toBeCloseTo(a.x, 1);
  expect(errors).toEqual([]);
});

test('both endpoint handles rewire atomically; Alt detaches only that connection and undo restores it', async ({ page }) => {
  await setup(page, [['A', 'B'], ['D', 'B']]);
  await drag(page, handle(page, 'A', 'B', 'to'), node(page, 'C'));
  await expect(edge(page, 'A', 'C')).toHaveCount(1);
  await expect(edge(page, 'A', 'B')).toHaveCount(0);
  await expect(edge(page, 'D', 'B')).toHaveCount(1);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await expect(edge(page, 'A', 'C')).toHaveCount(0);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await drag(page, handle(page, 'A', 'C', 'from'), node(page, 'D'));
  await expect(edge(page, 'D', 'C')).toHaveCount(1);
  await expect(edge(page, 'A', 'C')).toHaveCount(0);
  await handle(page, 'D', 'C', 'to').click({ modifiers: ['Alt'] });
  await expect(edge(page, 'D', 'C')).toHaveCount(0);
  await expect(edge(page, 'D', 'B')).toHaveCount(1);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(edge(page, 'D', 'C')).toHaveCount(1);
  await handle(page, 'D', 'C', 'from').click({ modifiers: ['Alt'] });
  await expect(edge(page, 'D', 'C')).toHaveCount(0);
  await expect(edge(page, 'D', 'B')).toHaveCount(1);
  await page.reload();
  await expect(edge(page, 'D', 'B')).toHaveCount(1);
  await expect(page.locator('.edge')).toHaveCount(1);
});

test('cancelled, duplicate, self and cyclic reconnections preserve the original edge', async ({ page }) => {
  await setup(page, [['A', 'B'], ['A', 'C'], ['B', 'C']]);
  const original = handle(page, 'A', 'B', 'to');
  await drag(page, original, node(page, 'C'));
  await expect(page.getByRole('status')).toContainText('이미 연결');
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await drag(page, original, node(page, 'A'));
  await expect(page.getByRole('status')).toContainText('자기 자신');
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await drag(page, handle(page, 'A', 'B', 'from'), node(page, 'C'));
  await expect(page.getByRole('status')).toContainText('순환');
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  // Release outside the canvas, then cancel a second attempt with Escape.
  let point = await center(original);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(20, 20, { steps: 8 }); await page.mouse.up();
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  point = await center(original);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x - 70, point.y + 80, { steps: 5 });
  await expect(page.locator('.connection-preview')).toBeAttached();
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.connection-preview')).toHaveCount(0);
  await expect(page.locator('.edge')).toHaveCount(3);
  await expect(page.locator('#canvas')).not.toHaveClass(/dragging-connection/);
  // Nothing about the failed attempts was persisted.
  await page.reload();
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await expect(edge(page, 'A', 'C')).toHaveCount(1);
  await expect(edge(page, 'B', 'C')).toHaveCount(1);
});

test('boundary points remain usable after zoom and pan', async ({ page }) => {
  await setup(page, [['A', 'B']]);
  await page.getByRole('button', { name: '축소', exact: true }).click();
  const bounds = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 90); await page.mouse.down();
  await page.mouse.move(bounds.x + 80, bounds.y + 120, { steps: 5 }); await page.mouse.up();
  await drag(page, handle(page, 'A', 'B', 'to'), node(page, 'D'));
  await expect(edge(page, 'A', 'D')).toHaveCount(1);
  await expect(edge(page, 'A', 'B')).toHaveCount(0);
  const a = (await node(page, 'A').boundingBox())!, point = await center(handle(page, 'A', 'D', 'from'));
  expect(point.x).toBeCloseTo(a.x + a.width / 2, 0);
  expect(point.y).toBeCloseTo(a.y + a.height, 0);
  await expect(page.locator('.connection-point')).toHaveCount(2);
});

test('node movement, new connections, right-button pan and Escape work without switching modes', async ({ page }) => {
  await setup(page);
  await expect(page.locator('#select-mode, #connect-mode')).toHaveCount(0);
  const a = await center(node(page, 'A'));
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 30, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.edge')).toHaveCount(0);
  const moved = await center(node(page, 'A'));
  expect(moved.x).toBeGreaterThan(a.x);
  await drag(page, page.locator('[data-connect-node=A]'), node(page, 'B'));
  await drag(page, page.locator('[data-connect-node=A]'), node(page, 'C'));
  await expect(edge(page, 'A', 'B')).toHaveCount(1);
  await expect(edge(page, 'A', 'C')).toHaveCount(1);
  // Right drag from the node body pans the viewport without moving world coordinates.
  await node(page, 'A').click();
  const x = await page.locator('[name=X]').inputValue();
  const y = await page.locator('[name=Y]').inputValue();
  await page.mouse.move(moved.x, moved.y); await page.mouse.down({ button: 'right' });
  await page.mouse.move(moved.x + 45, moved.y + 20, { steps: 5 }); await page.mouse.up({ button: 'right' });
  expect((await center(node(page, 'A'))).x).toBeCloseTo(moved.x + 45, 0);
  await expect(page.locator('[name=X]')).toHaveValue(x);
  await expect(page.locator('[name=Y]')).toHaveValue(y);
  // Escape cancels movement; the next pin drag remains usable.
  const before = await center(node(page, 'A'));
  await page.mouse.move(before.x, before.y); await page.mouse.down();
  await page.mouse.move(before.x + 80, before.y + 50, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await center(node(page, 'A'))).x).toBeCloseTo(before.x, 0);
  await drag(page, page.locator('[data-connect-node=A]'), node(page, 'D'));
  await expect(edge(page, 'A', 'D')).toHaveCount(1);
});
