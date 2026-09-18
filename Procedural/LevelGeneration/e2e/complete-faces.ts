import { expect, type Page } from '@playwright/test';
import type { GenerationResult } from '../src/core/generate';

/** Counts come from the actual Viewer placement children, not generation counters. */
export async function expectCompleteFaces(page: Page, result: GenerationResult) {
  const report = JSON.parse((await page.locator('canvas').getAttribute('data-face-meshes'))!);
  expect(report).toMatchObject({
    count: result.placements.length,
    uniqueFaces: result.placements.length,
    instanced: 0,
    childObjects: 0,
    extraPlacementObjects: 0,
    finishedFaces: result.placements.filter(p=>p.finishIds?.length).length,
  });
  if(result.placements.some(p=>p.tileId.includes('single')||p.tileId.includes('left')))expect(report.glassFaces).toBeGreaterThan(0);
  return report;
}
