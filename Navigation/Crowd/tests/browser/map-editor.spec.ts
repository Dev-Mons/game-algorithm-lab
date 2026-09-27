import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const canvas = page.locator('#editor-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + from[0] / 1200 * box.width, box.y + from[1] / 720 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] / 1200 * box.width, box.y + to[1] / 720 * box.height, { steps: 8 });
  await page.mouse.up();
}

async function placeGoal(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name: '목적지 배치', exact: true }).click();
  const canvas = page.locator('#editor-canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: x / 1200 * box.width, y: y / 720 * box.height } });
}

const importedMap = {
  version: 1, name: 'JSON 테스트', width: 1200, height: 720,
  obstacles: [{ x: 600, y: 144, width: 48, height: 360 }],
  spawns: [{ x: 48, y: 120, width: 240, height: 360 }, { x: 780, y: 48, width: 240, height: 120 }],
  goal: { x: 1104, y: 600 },
};

test('draws, resizes, moves, undoes, saves, and runs a custom map', async ({ page }, testInfo) => {
  await page.goto('/?agents=120&paused=true');
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await expect(page.locator('#editor-canvas')).toBeVisible();
  await expect(page.locator('#run-toggle')).toBeHidden();
  await page.locator('#editor-name').fill('직접 만든 맵');
  await page.locator('#editor-name').press('Tab');
  await page.getByRole('button', { name: '장애물 그리기' }).click();
  await drag(page, [480, 120], [552, 360]);
  await expect(page.locator('#editor-width')).toHaveValue('72');
  await page.getByRole('button', { name: '선택 / 이동' }).click();
  await drag(page, [552, 360], [624, 456]);
  await expect(page.locator('#editor-width')).toHaveValue('144');
  await expect(page.locator('#editor-height')).toHaveValue('336');
  await page.locator('#editor-x').fill('504');
  await page.locator('#editor-x').press('Tab');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.locator('#editor-objects').selectOption('obstacle:0');
  await expect(page.locator('#editor-x')).toHaveValue('480');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await page.locator('#editor-objects').selectOption('obstacle:0');
  await expect(page.locator('#editor-x')).toHaveValue('504');
  await page.getByRole('button', { name: '생성 영역 그리기' }).click();
  await drag(page, [780, 48], [1020, 144]);
  await placeGoal(page, 1104, 600);
  await page.getByRole('button', { name: '브라우저 저장' }).click();
  await expect(page.locator('#editor-status')).toContainText('브라우저에 저장했습니다');
  await page.screenshot({ path: testInfo.outputPath('map-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await expect(page.locator('#editor-canvas')).toBeHidden();
  await expect(page.locator('#scenario-badge')).toHaveText('직접 만든 맵');
  await expect.poll(() => page.evaluate(() => window.crowdDebug.simulation().stepCount)).toBeGreaterThan(0);
  const applied = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    return { id: s.scenario.id, obstacle: s.scenario.obstacles[0], flows: s.flowCount, goal: s.goal, count: s.state.count };
  });
  expect(applied).toMatchObject({ obstacle: { x: 504, y: 120, width: 144, height: 336 }, flows: 2,
    goal: { x: 1104, y: 600 }, count: 120 });
  expect(applied.id).toMatch(/^custom-/);
  await page.goto('/?paused=true&agents=120');
  await page.locator('#scenario-select').selectOption(applied.id);
  await expect(page.locator('#scenario-badge')).toHaveText('직접 만든 맵');
  expect(await page.evaluate(() => window.crowdDebug.simulation().scenario.obstacles)).toEqual([applied.obstacle]);
  await page.locator('#scenario-select').selectOption('open-field');
  expect(await page.evaluate(() => window.crowdDebug.simulation().scenario.obstacles)).toEqual([]);
});

test('blocks an unreachable map and cancels edits without changing the simulation', async ({ page }) => {
  await page.goto('/?agents=120&paused=true');
  const before = await page.evaluate(() => window.crowdDebug.getSnapshot());
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await page.getByRole('button', { name: '장애물 그리기' }).click();
  // Use numeric editing to make a wall flush with both world edges.
  await drag(page, [600, 24], [648, 696]);
  await page.locator('#editor-y').fill('0');
  await page.locator('#editor-y').press('Tab');
  await page.locator('#editor-height').fill('720');
  await page.locator('#editor-height').press('Tab');
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await expect(page.locator('#editor-status')).toContainText('목적지로 갈 수 없습니다');
  await expect(page.locator('#editor-canvas')).toBeVisible();
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot())).toEqual(before);
  await page.getByRole('button', { name: '편집 취소', exact: true }).click();
  await expect(page.locator('#editor-canvas')).toBeHidden();
  expect(await page.evaluate(() => window.crowdDebug.getSnapshot())).toEqual(before);
});

test('imports and exports JSON, rejects invalid input, and preserves bounded simulation work', async ({ page }) => {
  await page.goto('/?agents=120&paused=true');
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await page.locator('#editor-file').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importedMap)) });
  await expect(page.locator('#editor-name')).toHaveValue(importedMap.name);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기' }).click();
  const download = await downloadEvent;
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(importedMap);
  await page.locator('#editor-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
  await expect(page.locator('#editor-status')).toHaveClass(/error/);
  await expect(page.locator('#editor-name')).toHaveValue(importedMap.name);
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await page.getByRole('button', { name: '일시정지' }).click();
  const result = await page.evaluate(() => {
    const s = window.crowdDebug.simulation();
    let walls = 0, work = 0;
    for (let step = 0; step < 360; step += 1) {
      s.step(); walls = Math.max(walls, s.metrics.wallOverlapCount); work = Math.max(work, s.metrics.candidateChecks);
    }
    return { walls, work, count: s.state.count, goal: s.goal, flows: s.flowCount };
  });
  expect(result).toMatchObject({ walls: 0, count: 120, goal: importedMap.goal, flows: 2 });
  expect(result.work).toBeLessThanOrEqual(result.count * 24);
});

test('supports keyboard movement and deletion; keeps one spawn and one goal', async ({ page }) => {
  await page.goto('/?scenario=winding-corners&paused=true');
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await page.locator('#editor-objects').selectOption('obstacle:0');
  await page.locator('#editor-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#editor-x')).toHaveValue('372');
  await page.keyboard.press('Control+z');
  await page.locator('#editor-objects').selectOption('obstacle:0');
  await expect(page.locator('#editor-x')).toHaveValue('360');
  await page.locator('#editor-canvas').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#editor-objects option')).toHaveCount(4);
  await page.locator('#editor-objects').selectOption('spawn:0');
  await expect(page.locator('#editor-delete')).toBeDisabled();
  await page.locator('#editor-objects').selectOption('goal');
  await expect(page.locator('#editor-delete')).toBeDisabled();
  await expect(page.locator('#editor-width')).toBeDisabled();
});

test('a corrupt saved library leaves built-in maps usable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('crowd-lab.maps.v1', '{invalid'));
  await page.goto('/?paused=true');
  await expect(page.locator('#map-library-status')).toBeVisible();
  await expect(page.locator('#scenario-select option')).toHaveCount(10);
  await expect(page.locator('#crowd-canvas')).toBeVisible();
});

test('draws and edits multiple exit regions, saves them and routes a crowd into both', async ({ page }, testInfo) => {
  await page.goto('/?agents=120&paused=true');
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await page.locator('#editor-name').fill('두 출구 시험장');
  await page.locator('#editor-name').press('Tab');
  await page.getByRole('button', { name: '목적지 영역 그리기' }).click();
  await drag(page, [960, 72], [1128, 168]);
  await drag(page, [960, 528], [1128, 624]);
  await expect(page.locator('#editor-objects option[value^="goal-region:"]')).toHaveCount(2);
  await expect(page.locator('#editor-objects option[value="goal"]')).toHaveCount(0);
  await page.getByRole('button', { name: '선택 / 이동' }).click();
  await drag(page, [1128, 624], [1152, 648]);
  await expect(page.locator('#editor-width')).toHaveValue('192');
  await expect(page.locator('#editor-height')).toHaveValue('120');
  await page.locator('#editor-canvas').focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('#editor-x')).toHaveValue('959');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.locator('#editor-objects').selectOption('goal-region:1');
  await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
  await expect(page.locator('#editor-objects option[value^="goal-region:"]')).toHaveCount(1);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.locator('#editor-objects').selectOption('goal-region:1');
  await expect(page.locator('#editor-x')).toHaveValue('960');
  await page.getByRole('button', { name: '브라우저 저장' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 내보내기' }).click();
  const saved = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
  expect(saved.version).toBe(2);
  expect(saved.goalRegions).toEqual([
    { x: 960, y: 72, width: 168, height: 96 }, { x: 960, y: 528, width: 192, height: 120 },
  ]);
  await page.screenshot({ path: testInfo.outputPath('multi-region-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await page.getByRole('button', { name: /일시정지/ }).click();
  await expect(page.locator('#canvas-hint')).toContainText('사각형 2곳');
  await expect(page.locator('#goal-radius')).toBeDisabled();
  const result = await page.evaluate(() => {
    const simulation = window.crowdDebug.simulation();
    let walls = 0;
    for (let tick = 0; tick < 1500; tick++) {
      simulation.step(); walls = Math.max(walls, simulation.metrics.wallOverlapCount);
    }
    return { id: simulation.scenario.id, arrived: simulation.metrics.arrivedCount, walls,
      counts: simulation.goalRegions.map(region => Array.from(simulation.state.active).filter((active, i) =>
        !active && simulation.state.x[i]! >= region.x && simulation.state.x[i]! <= region.x + region.width
        && simulation.state.y[i]! >= region.y && simulation.state.y[i]! <= region.y + region.height).length) };
  });
  expect(result.walls).toBe(0);
  expect(result.arrived).toBe(120);
  expect(result.counts.every(count => count > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('multi-region-arrived.png'), fullPage: true });
  await page.goto('/?agents=120&paused=true');
  await page.locator('#scenario-select').selectOption(result.id);
  expect(await page.evaluate(() => window.crowdDebug.simulation().goalRegions)).toEqual(saved.goalRegions);
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  await placeGoal(page, 1104, 360);
  await expect(page.locator('#editor-objects option[value^="goal-region:"]')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('#editor-objects option[value^="goal-region:"]')).toHaveCount(2);
});

test('imports v2 regions and reports an entirely obstructed exit before applying', async ({ page }) => {
  await page.goto('/?agents=120&paused=true');
  await page.getByRole('button', { name: '맵 편집', exact: true }).click();
  const input = { ...importedMap, version: 2, goalRegions: [{ x: 600, y: 200, width: 48, height: 48 }] };
  await page.locator('#editor-file').setInputFiles({ name: 'regions.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await expect(page.locator('#editor-objects option[value^="goal-region:"]')).toHaveCount(1);
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await expect(page.locator('#editor-status')).toContainText('목적지 영역 1');
  await expect(page.locator('#editor-canvas')).toBeVisible();
  await page.locator('#editor-objects').selectOption('goal-region:0');
  await expect(page.locator('#editor-delete')).toBeDisabled();
  await page.locator('#editor-x').fill('1080');
  await page.locator('#editor-x').press('Tab');
  await page.getByRole('button', { name: '적용하고 실행' }).click();
  await expect(page.locator('#editor-canvas')).toBeHidden();
  expect(await page.evaluate(() => window.crowdDebug.simulation().goalRegions[0]!.x)).toBe(1080);
});
