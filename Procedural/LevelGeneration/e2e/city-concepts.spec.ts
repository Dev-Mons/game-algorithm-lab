import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('city concepts A–D are selectable and render facade, roof and road patterns',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#profile option')).toHaveText(Array.from({length:4},(_,i)=>String.fromCharCode(65+i)));
  await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  await mkdir('artifacts/city-concepts',{recursive:true});
  for(const letter of ['A','B','C','D']){
    await page.locator('#fixture').selectOption(`city${letter}`);
    await expect(page.locator('#status')).toHaveText('OK');
    await expect(page.locator('#profile option:checked')).toHaveText(letter);
    await page.locator('[data-camera="iso"]').click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`artifacts/city-concepts/${letter}.png`});
  }
  await page.locator('[data-camera="top"]').click();
  await page.locator('canvas').screenshot({path:'artifacts/city-concepts/D-top.png'});
  expect(errors).toEqual([]);
});
