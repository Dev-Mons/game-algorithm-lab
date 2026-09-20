import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {exportDocument} from '../src/core/document';
import {createDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';

test('three refreshed styles render complete real meshes and export editable examples',async({page})=>{
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
  const directory='artifacts/facade-refresh';await mkdir(directory,{recursive:true});
  const grid=box(10,8,5).filter(([x,y,z])=>y<6||(x>=1&&x<9&&z<4));
  const scene=emptySceneInputs();scene.roads=box(12,1,1).map(([x,y])=>[x-1,y,7]);
  for(const style of ['shop','office','urban-shop'] as const){
    const doc=createDocument(grid,17,style,undefined,undefined,scene);

    const result=generateDocument(doc);
    await writeFile(`${directory}/${style}.json`,exportDocument(doc));
    await page.locator('#file').setInputFiles({name:`${style}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await expect(page.locator('#status')).toHaveText('OK');
    await expectCompleteFaces(page,result);
    await page.locator('[data-camera="iso"]').click();
    // Two animation frames let the existing renderer present the selected view.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.locator('canvas').screenshot({path:`${directory}/${style}.png`});
  }
  expect(errors).toEqual([]);
  const cards=[['shop','상가형','석재 창턱 · 층간 몰딩 · 처마 장식'],['office','업무형','넓은 창 · 수직 금속 핀 · 슬림 난간'],['urban-shop','도시형 복합 상가','테라코타 프레임 · 2층 연속 유리']];
  await writeFile(`${directory}/index.html`,`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>건물 스타일 · 메쉬 업데이트</title><style>body{margin:0;background:#152229;color:#e9eee9;font:15px/1.6 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:40px}h1{font-size:32px;margin:0}header p{color:#a5b9b7}section{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{background:#203139;border:1px solid #3b4e53;border-radius:12px;overflow:hidden}img{display:block;width:100%}article div{padding:18px 24px}h2{margin:0;font-size:22px}p{margin:6px 0}a{color:#b3d8c5}footer{margin-top:28px;color:#a5b9b7}@media(max-width:700px){main{padding:20px}section{grid-template-columns:1fr}}</style><main><header><h1>건물 스타일 · 메쉬 업데이트</h1><p>같은 건물 형태와 카메라에서 비교한 프로토타입 실제 렌더. JSON은 편집기에서 불러올 수 있습니다.</p></header><section>${cards.map(([id,title,description])=>`<article><img src="${id}.png" alt="${title} 실제 렌더"><div><h2>${title}</h2><p>${description}</p><a href="${id}.json" download>편집 가능한 JSON</a></div></article>`).join('')}</section><footer>형태 참고: <a href="https://www.loopnet.co.uk/listing/new-st-burton-on-trent/28018541/">Brigade House</a> · <a href="https://www.scottbrownrigg.com/company/news/expansion-of-peterhouse-technology-park-in-cambridge-completes/">The Optic</a> · <a href="https://www.moeding.de/referenzen/28-7/?lang=en">28 &amp; 7</a>. 외부 이미지·메쉬는 앱에 포함하지 않았습니다.</footer></main></html>`);
});
