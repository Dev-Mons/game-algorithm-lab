import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {conceptPreservationCases} from '../tests/concept-preservation-fixtures';
import {generateDocument} from '../src/core/generate-document';
import {expectCompleteFaces} from './complete-faces';

// Opt in because the baseline belongs to the pre-refactor checkout, not snapshots
// captured from whatever implementation happens to be under test.
test('@preservation A–D production renders match the captured pre-refactor views',async({page,browser})=>{
  test.skip(!process.env.CONCEPT_PRESERVATION_PHASE,'Run with the preserved baseline checkout and explicit baseline/after phase.');
  test.setTimeout(240_000);
  const phase=process.env.CONCEPT_PRESERVATION_PHASE!,root=process.env.CONCEPT_PRESERVATION_OUTPUT??'artifacts/concept-preservation';
  const directory=path.join(root,phase);await mkdir(directory,{recursive:true});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const shots:Record<string,{sha256:string;bytes:number;meshes:unknown}>={};
  for(const {id,document} of conceptPreservationCases().filter(c=>c.render)){
    await page.locator('#file').setInputFiles({name:`${id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
    await expect(page.locator('#status')).toHaveText('OK');
    const meshes=await expectCompleteFaces(page,generateDocument(document,{cache:false}));
    for(const camera of id.endsWith('-reference')?['iso','front']:['iso']){
      await page.locator(`[data-camera="${camera}"]`).click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const image=await page.locator('canvas').screenshot({path:path.join(directory,`${id}-${camera}.png`)});
      shots[`${id}-${camera}`]={sha256:createHash('sha256').update(image).digest('hex'),bytes:image.length,meshes};
    }
  }
  expect(errors).toEqual([]);
  await writeFile(path.join(root,`${phase}.json`),JSON.stringify({browser:browser.version(),viewport:{width:1440,height:960},seed:42,shots},null,2)+'\n');
  if(phase==='after'){
    const baseline=JSON.parse(await readFile(path.join(root,'baseline.json'),'utf8'));
    expect(browser.version()).toBe(baseline.browser);
    expect(Object.keys(shots)).toEqual(Object.keys(baseline.shots));
    for(const [id,shot] of Object.entries(shots))expect(shot,id).toEqual(baseline.shots[id]);
  }
});
