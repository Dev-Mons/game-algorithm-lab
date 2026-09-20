import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {createDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {FIXTURES} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

test('Tower11 D is a white preset with editable setbacks and no custom parameter controls',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.locator('#fixture').selectOption('cityD');
  await expect(page.locator('#profile')).toHaveValue('tower11-d');
  await expect(page.locator('#status')).toHaveText('OK');
  const f=FIXTURES.cityD,doc=createDocument(f.cells,42,'tower11-d',undefined,undefined,f.sceneInputs);
  await expectCompleteFaces(page,generateDocument(doc));
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'building',id:'0,0,0'}));
  await expect(page.locator('#building-theme')).toHaveValue('tower11-d');
  await expect(page.locator('#building-use, #band-setting, #environment-setting, #design-palette')).toHaveCount(0);
  await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  await page.locator('canvas').focus();await page.keyboard.press('Escape');
  await mkdir('artifacts/tower11-d',{recursive:true});
  for(const camera of ['iso','front','top']){
    await page.locator(`[data-camera="${camera}"]`).click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`artifacts/tower11-d/${camera}.png`});
  }
  const waiting=page.waitForEvent('download');await page.locator('#save').click();
  const path=await(await waiting).path(),saved=loadDocument(await readFile(path!,'utf8'));
  expect(saved).toEqual(doc);
  await page.locator('#new').click();await page.locator('#file').setInputFiles(path!);
  await expect(page.locator('#profile')).toHaveValue('tower11-d');await expect(page.locator('#status')).toHaveText('OK');
  expect(errors).toEqual([]);
});
