import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDocument,exportDocument} from '../src/core/document';
import {LEGACY_SHOP_STYLE} from '../src/core/building-style';
import {generateDocument} from '../src/core/generate-document';
import {REFERENCE_A_CELLS} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

test('A reference towers use continuous ribbons and preserve the editable entry and terrace',async({page})=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const directory='artifacts/style-a-reference';await mkdir(directory,{recursive:true});
  for(const version of ['before','after'] as const){
    const doc=createDocument(REFERENCE_A_CELLS,42,'shop',version==='before'?LEGACY_SHOP_STYLE:undefined);
    await page.locator('#file').setInputFiles({name:`A-${version}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');
    const result=generateDocument(doc);await expectCompleteFaces(page,result);
    if(version==='after'){
      expect(result.placements.filter(p=>p.tileId.includes('ribbon-a-')).length).toBeGreaterThan(1000);
      await writeFile(`${directory}/A-reference.json`,exportDocument(doc));
    }
    await page.locator('[data-camera="front"]').click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`${directory}/${version}.png`});
    if(version==='after'){
      await page.locator('[data-camera="iso"]').click();await page.locator('canvas').screenshot({path:`${directory}/three-quarter.png`});
      await page.locator('[data-camera="top"]').click();await page.locator('canvas').screenshot({path:`${directory}/top.png`});
    }
  }
  // The built-in example is also accessible without importing a file.
  await page.locator('#fixture').selectOption('referenceA');await expect(page.locator('#profile')).toHaveValue('shop');
  await expect(page.locator('#status')).toHaveText('OK');expect(errors).toEqual([]);
});
