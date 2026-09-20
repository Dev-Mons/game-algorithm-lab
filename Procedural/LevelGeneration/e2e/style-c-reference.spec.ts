import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDocument,exportDocument} from '../src/core/document';
import {LEGACY_URBAN_SHOP_STYLE} from '../src/core/building-style';
import {generateDocument} from '../src/core/generate-document';
import {FIXTURES,box} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

test('C low, high and portal references render with complete ownership and saveable volumes',async({page})=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const directory='artifacts/style-c-reference';await mkdir(directory,{recursive:true});
  for(const name of ['referenceCLow','referenceCHigh','referenceCPortal']){
    for(const version of ['before','after'] as const){
      const doc=createDocument(FIXTURES[name].cells,42,'urban-shop',version==='before'?LEGACY_URBAN_SHOP_STYLE:undefined);
      await page.locator('#file').setInputFiles({name:`${name}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
      await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
      await page.locator('[data-camera="front"]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.locator('canvas').screenshot({path:`${directory}/${name}-${version}.png`});
      if(version==='after'){
        await writeFile(`${directory}/${name}.json`,exportDocument(doc));
        await page.locator('[data-camera="iso"]').click();
        await page.locator('canvas').screenshot({path:`${directory}/${name}-iso.png`});
      }
    }
    await page.locator('#fixture').selectOption(name);await expect(page.locator('#profile')).toHaveValue('urban-shop');
    await expect(page.locator('#status')).toHaveText('OK');
  }
  expect(errors).toEqual([]);
});

test('C short returns keep matching bevels through floor changes and roof parapets',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const doc=createDocument(box(9,8,6).filter(([x,y,z])=>(x<2||x>=7||z<3)&&(x<7||y<5)),42,'urban-shop');
  await page.locator('#file').setInputFiles({name:'C-corner-returns.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
  await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
  await page.locator('[data-camera="iso"]').click();
  const directory='artifacts/style-c-reference';await mkdir(directory,{recursive:true});
  await page.locator('canvas').screenshot({path:`${directory}/corners-fixed.png`});
  await page.locator('canvas').hover();await page.mouse.wheel(0,-320);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.locator('canvas').screenshot({path:`${directory}/corners-closeup.png`});
  await writeFile(`${directory}/C-corner-returns.json`,exportDocument(doc));
  expect(errors).toEqual([]);
});

test('C full-height ground glazing and half-height transom render on low and tall buildings',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const directory='artifacts/style-c-reference';await mkdir(directory,{recursive:true});
  for(const height of [1,2,8]){
    const doc=createDocument(box(8,height,4),42,'urban-shop');
    await page.locator('#file').setInputFiles({name:`C-shopfront-${height}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
    await page.locator('[data-camera="front"]').click();
    await page.locator('canvas').screenshot({path:`${directory}/shopfront-${height}.png`});
  }
  expect(errors).toEqual([]);
});
