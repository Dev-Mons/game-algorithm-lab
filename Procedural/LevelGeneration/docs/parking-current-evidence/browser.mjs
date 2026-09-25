import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=process.cwd(),out=resolve(root,'artifacts/parking-audit');
const server=await createServer({root,server:{host:'127.0.0.1',port:5183,strictPort:true}});await server.listen();
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:5183/?measure=1');
 const load=async name=>{await page.locator('#file').setInputFiles(resolve(out,`${name}.json`));await page.waitForFunction(name=>document.querySelector('#scene-name').textContent===`${name}.json`,name);await page.locator('[data-camera="top"]').click();};
 await load('R12');await page.waitForFunction(()=>window.environmentMeasure.snapshot().parking[0].quality.acceptedStalls===18);
 await page.screenshot({path:resolve(out,'R12-before.png')});
 await page.locator('#edit-mode').selectOption('parking');await page.locator('#parking-area').selectOption('R12');
 const point=await page.evaluate(()=>window.environmentMeasure.point([5,0,5]));await page.mouse.click(point.x,point.y);await page.keyboard.press('q');
 await page.waitForFunction(()=>window.environmentMeasure.snapshot().document.sceneInputs.parkingAreas[0].cells.length===143);
 const after=await page.evaluate(()=>{const s=window.environmentMeasure.snapshot();return {cells:s.document.sceneInputs.parkingAreas[0].cells.length,stalls:s.parking[0].quality.acceptedStalls,quality:s.parking[0].quality,edit:s.edit,ms:s.sample?.totalMs};});
 if(after.stalls!==0)throw new Error('Expected one-cell counterexample to reproduce');
 await page.keyboard.press('Escape');await page.screenshot({path:resolve(out,'R12-single-hole-zero-stalls.png')});
 await page.locator('canvas').focus();await page.keyboard.press('Control+z');await page.waitForFunction(()=>window.environmentMeasure.snapshot().parking[0].quality.acceptedStalls===18);
 for(const name of ['L16','U16-arms6','rect-6x16']){await load(name);await page.screenshot({path:resolve(out,`${name}.png`)});}
 await load('parking-building');await page.locator('[data-camera="iso"]').click();await page.screenshot({path:resolve(out,'parking-building-no-access-proof.png')});
 await writeFile(resolve(out,'browser-report.json'),JSON.stringify({browser:browser.version(),operation:'R12 parking mask: actual click at 5,0,5 and Q removes one cell; Ctrl+Z restores 18 stalls',after,errors},null,2));console.log(JSON.stringify({after,errors}));
}finally{await browser.close();await server.close();}
