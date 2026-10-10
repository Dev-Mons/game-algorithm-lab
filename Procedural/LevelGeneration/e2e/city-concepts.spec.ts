import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('city concepts A–D are selectable and render facade, roof and road patterns',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  expect(await page.locator('[data-style]').evaluateAll(b=>b.map(e=>e.getAttribute('aria-label')))).toEqual(['건물 · A','건물 · B','건물 · C','건물 · D','건물 · 집 · 크림 사이딩','건물 · 집 · 붉은 사이딩','건물 · 집 · 벽돌과 기와','건물 · 집 · 차고']);
  await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  await mkdir('artifacts/city-concepts',{recursive:true});
  for(const letter of ['A','B','C','D']){
    await page.locator('#fixture').selectOption(`city${letter}`);
    await expect(page.locator('#status')).toHaveText('OK');
    await expect(page.locator('[data-style][aria-pressed="true"]')).toHaveAttribute('aria-label',`건물 · ${letter}`);
    await page.locator('[data-camera="iso"]').click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`artifacts/city-concepts/${letter}.png`});
  }
  await page.locator('[data-camera="top"]').click();
  await page.locator('canvas').screenshot({path:'artifacts/city-concepts/D-top.png'});
  expect(errors).toEqual([]);
});
