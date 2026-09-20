import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
test('regions, shared facade plans, picking and current document persistence',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.locator('.inspect-details summary').first().click();await expect(page.locator('#profile')).toHaveValue('office');
 await page.locator('#fixture').selectOption('annex');await page.locator('#region').selectOption('r:3,1,0|PY');await expect(page.locator('#region-info')).toContainText('낮은 별동 지붕');
 await expect(page.locator('#inspector')).toContainText('ROOF');
 await page.locator('#profile').selectOption('shop');await page.locator('#fixture').selectOption('facade');
 await page.locator('[data-camera="top"]').click();const b=(await page.locator('canvas').boundingBox())!;await page.locator('canvas').click({position:{x:b.width*.53,y:b.height*.49}});
 expect(JSON.parse((await page.locator('#trace').textContent())!).direction).toBe('PY');
 await page.locator('#seed').fill('12345');await page.locator('#seed').press('Tab');await page.locator('#face').selectOption('1,0,2|PZ');const trace=await page.locator('#trace').textContent();
 const save=async()=>{const w=page.waitForEvent('download');await page.locator('#save').click();return readFile((await(await w).path())!,'utf8');};
 const text=await save(),doc=loadDocument(text);expect(doc.schemaVersion).toBe(6);expect(JSON.parse(trace!)).toEqual(generateDocument(doc).traces.find(t=>t.faceId==='1,0,2|PZ'));
 await page.locator('#new').click();await page.locator('#file').setInputFiles({name:'current.json',mimeType:'application/json',buffer:Buffer.from(text)});await page.locator('#face').selectOption('1,0,2|PZ');expect(await page.locator('#trace').textContent()).toBe(trace);expect(await save()).toBe(text);
 await page.screenshot({path:info.outputPath('current-architecture.png')});expect(errors).toEqual([]);
});
