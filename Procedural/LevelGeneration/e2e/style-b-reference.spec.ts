import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDocument,exportDocument} from '../src/core/document';
import {LEGACY_OFFICE_STYLE} from '../src/core/building-style';
import {generateDocument} from '../src/core/generate-document';
import {FIXTURES} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

test('B reference curtain wall and dark roof render with complete face ownership',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const directory='artifacts/style-b-reference';await mkdir(directory,{recursive:true});
  for(const version of ['before','after'] as const){
    const doc=createDocument(FIXTURES.referenceB.cells,42,'office',version==='before'?LEGACY_OFFICE_STYLE:undefined);
    await page.locator('#file').setInputFiles({name:`B-${version}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');await expectCompleteFaces(page,generateDocument(doc));
    await page.locator('[data-camera="front"]').click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`${directory}/${version}.png`});
    if(version==='after'){
      await writeFile(`${directory}/B-reference.json`,exportDocument(doc));
      const entries=generateDocument(doc).environment!.entrances![0].entrances;
      expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({access:'local',outward:'PZ'});
      await page.locator('canvas').hover();await page.mouse.wheel(0,180);
      await page.mouse.move(0,0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.locator('canvas').screenshot({path:`${directory}/front-entrance.png`});
      await page.locator('[data-camera="iso"]').click();
      await page.locator('canvas').hover();await page.mouse.wheel(0,180);
      await page.mouse.move(0,0);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.locator('canvas').screenshot({path:`${directory}/three-quarter.png`});
      await page.locator('[data-camera="top"]').click();await page.locator('canvas').screenshot({path:`${directory}/top.png`});
    }
  }
  await page.locator('#fixture').selectOption('referenceB');await expect(page.locator('#profile')).toHaveValue('office');
  await expect(page.locator('#status')).toHaveText('OK');expect(errors).toEqual([]);
});
