import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createDocument,loadDocument} from '../src/core/document';
import {generateDocument} from '../src/core/generate-document';
import {validateAssembly,type Vec3} from '../src/core/generate';
import {OFFICE_STYLE} from '../src/core/building-style';
import {emptySceneInputs} from '../src/core/scene-inputs';
import {box} from '../src/fixtures';
import {expectCompleteFaces} from './complete-faces';
async function load(page:Page,input:ReturnType<typeof createDocument>){await page.locator('#file').setInputFiles({name:'banded.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});await expect(page.locator('#status')).toHaveText('OK');}
async function save(page:Page){const waiting=page.waitForEvent('download');await page.locator('#save').click();const path=await(await waiting).path();const text=await readFile(path!,'utf8');return {text,document:loadDocument(text)};}

test('A–D style menus apply C globally and per building and preserve it on reload',async({page})=>{
  await page.goto('/');await load(page,createDocument(box(8,10,4),42,'office'));
  await expect(page.locator('#profile option')).toHaveText(Array.from({length:4},(_,i)=>String.fromCharCode(65+i)));
  await expect(page.locator('#building-theme option')).toHaveText(['전역 스타일 사용',...Array.from({length:4},(_,i)=>String.fromCharCode(65+i))]);
  await page.locator('#profile').selectOption({label:'C'});
  await expect(page.locator('#status')).toHaveText('OK');
  const saved=await save(page),result=generateDocument(saved.document);
  expect(saved.document.buildingDefinition.label).toBe('C');
  expect(saved.document.buildingDefinition.roofAsset).toBe('facade.streamline-c-roof');
  expect(result.placements.some(p=>p.tileId.includes('streamline-c-'))).toBe(true);
  await expectCompleteFaces(page,result);
  await load(page,saved.document);await expect(page.locator('#profile')).toHaveValue('urban-shop');
  await page.locator('#source-select').selectOption(JSON.stringify({kind:'building',id:'0,0,0'}));
  await page.locator('#building-theme').selectOption({label:'A'});
  await page.locator('#building-theme').selectOption({label:'C'});
  const themed=await save(page);expect(themed.document.buildings[0].theme!.label).toBe('C');
  await load(page,themed.document);await expectCompleteFaces(page,generateDocument(themed.document));
});
test('banded H1/H2/H12, annex cap, setback and accessible portal are real shared geometry',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  const grid=[...box(3,1,4),...box(3,2,4).map(([x,y,z])=>[x+5,y,z] as Vec3),...box(10,12,5).filter(([x,y,z])=>y<8||x>=1&&x<=8&&z<3).map(([x,y,z])=>[x+10,y,z] as Vec3),...box(4,4,5).map(([x,y,z])=>[x+20,y,z] as Vec3)];
  const scene=emptySceneInputs();scene.roads=box(24,1,2).map(([x,y,z])=>[x,y,z+7]);
  const doc=createDocument(grid,42,'shop',undefined,undefined,scene);await load(page,doc);
  const output=generateDocument(doc);expect(output.placements.some(p=>p.faceAssetKey?.includes('outer-'))).toBe(true);
  await info.attach('actual-face-meshes',{body:JSON.stringify(await expectCompleteFaces(page,output)),contentType:'application/json'});
  expect(output.placements.some(p=>p.tileId.includes('base-foot'))).toBe(true);expect(output.placements.some(p=>p.tileId.includes('body-repeat'))).toBe(true);expect(output.placements.some(p=>p.tileId.includes('crown-single-cap'))).toBe(true);
  await expect(page.locator('[data-stage="attachments"]')).toHaveAttribute('data-state','ready');
  await page.locator('.layers > summary').click();await page.locator('#environment-inputs').uncheck();await page.locator('#environment-plans').uncheck();await page.locator('#layer-edges').uncheck();
  await page.screenshot({path:info.outputPath('banded-gallery.png')});
  await page.locator('[data-camera="top"]').click();await page.screenshot({path:info.outputPath('banded-joints-top.png')});expect(errors).toEqual([]);
});
test('preset bands, direct edit, JSON and Undo/Redo preserve real facade output',async({page})=>{
  await page.goto('/');const custom=structuredClone(OFFICE_STYLE);
  const input=createDocument(box(8,8,4),42,'office',custom);await load(page,input);
  await expectCompleteFaces(page,generateDocument(input));
  await page.locator('.inspect-details > summary').click();await page.locator('#face').selectOption('3,1,3|PZ');
  await expect(page.locator('#facade-info')).toContainText('층 base');expect(JSON.parse((await page.locator('#trace').textContent())!).selection.tileId).toContain('base-head');
  const before=await save(page);await page.locator('[data-camera="top"]').click();
  const canvas=page.locator('canvas'),b=(await canvas.boundingBox())!,x=b.x+b.width/2+10,y=b.y+b.height/2+10;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+8,y+8,{steps:4});await page.mouse.up();
  await page.keyboard.press('q');
  const after=await save(page);expect(after.document.grid).toHaveLength(before.document.grid.length-1);expect(after.document.buildingDefinition).toEqual(custom);
  const result=generateDocument(after.document);validateAssembly(result.surfaces.map(s=>s.faceId),result.placements,result.modules!);
  await expectCompleteFaces(page,result);
  await canvas.focus();await page.keyboard.press('Control+z');expect((await save(page)).text).toBe(before.text);
  await expectCompleteFaces(page,generateDocument(before.document));
  await canvas.focus();await page.keyboard.press('Control+Shift+z');expect((await save(page)).text).toBe(after.text);
  await expectCompleteFaces(page,result);
  await load(page,before.document);expect((await save(page)).text).toBe(before.text);
  await expectCompleteFaces(page,generateDocument(before.document));
});
