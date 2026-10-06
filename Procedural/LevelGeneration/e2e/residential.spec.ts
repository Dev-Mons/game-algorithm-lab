import {test,expect} from '@playwright/test';
import {createDocument,replaceGrid,exportDocument} from '../src/core/document';
import {RESIDENTIAL_KIT} from '../src/core/residential-kit';
import reproduction from '../tests/fixtures/residential-rotation.json' with {type:'json'};

test('Blender homes render their atlas, survive volume editing, undo and JSON load',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const failedAssets:string[]=[];
  page.on('response',r=>{if(r.url().includes('/assets/residential/')&&!r.ok())failedAssets.push(r.url());});
  await page.goto('/');
  for(let i=1;i<=6;i++){
    await page.locator('#fixture').selectOption(`house${i}`);
    await expect(page.locator('#status')).toHaveText('OK');
    await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',i<=4?/SM_Roof_ValleyJunction/:/SM_House_GaragePortal/);
    await expect(page.locator('canvas')).not.toHaveAttribute('data-scene-assets',/Porch|Carport|Chimney|DoorLanding|EntryLamp|Roof_Shed/);
    await page.getByRole('button',{name:'↗ 전체',exact:true}).click();
    await page.waitForFunction(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/residential/')).length>=3);
    await page.screenshot({path:info.outputPath(`house-${i}.png`)});
  }
  const example=RESIDENTIAL_KIT.examples[0],doc=createDocument(example.cells,42,'residential-cream');
  const load=async(d:typeof doc)=>{
    await page.locator('#file').setInputFiles({name:'house.json',mimeType:'application/json',buffer:Buffer.from(exportDocument(d))});
    await expect(page.locator('#status')).toHaveText('OK');
  };
  await load(doc);
  const before=await page.locator('canvas').getAttribute('data-scene-assets');
  const edited=replaceGrid(doc,[...doc.grid,[0,2,0]]);
  await load(edited);
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',/SM_Roof_SlopeCharcoal/);
  expect(await page.locator('canvas').getAttribute('data-scene-assets')).not.toBe(before);
  await page.screenshot({path:info.outputPath('house-edited.png')});
  await page.keyboard.press('Control+z');
  await expect(page.locator('canvas')).toHaveAttribute('data-scene-assets',before!);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('canvas')).not.toHaveAttribute('data-scene-assets',before!);
  await page.locator('#fixture').selectOption('house1');
  await page.getByRole('button',{name:'↓ 상부',exact:true}).click();
  const canvas=page.locator('canvas'),bounds=await canvas.boundingBox();
  await canvas.click({position:{x:bounds!.width*.5,y:bounds!.height*.5}});
  await page.keyboard.press('e');
  await expect(page.locator('#stats strong').first()).not.toHaveText('24');
  await page.screenshot({path:info.outputPath('house-direct-edit.png')});
  await page.keyboard.press('Control+z');
  await expect(page.locator('#stats strong').first()).toHaveText('24');
  expect(failedAssets).toEqual([]);expect(errors).toEqual([]);
});

test('the edited two-house scene completes both roof designs without creating entrance props or chimneys',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  const doc=createDocument(reproduction.grid,42,'residential-cream',undefined,reproduction.buildings as Parameters<typeof createDocument>[4]);
  await page.locator('#file').setInputFiles({name:'user-houses.json',mimeType:'application/json',buffer:Buffer.from(exportDocument(doc))});
  await expect(page.locator('#status')).toHaveText('OK');
  await expect(page.locator('#stats strong').first()).toHaveText('48');
  await page.getByRole('button',{name:'↗ 전체',exact:true}).click();
  const assets=(await page.locator('canvas').getAttribute('data-scene-assets'))!.split(',');
  expect(assets.filter(a=>a.includes('ValleyJunction'))).toHaveLength(4);
  expect(assets.some(a=>/Porch|Carport|Chimney|DoorLanding|EntryLamp|Roof_Shed/.test(a))).toBe(false);
  const entrances=JSON.parse((await page.locator('canvas').getAttribute('data-entrances'))!);
  expect(entrances.map((p:{entrances:{outward:string}[]})=>p.entrances[0].outward)).toEqual(['PZ','PX']);
  await page.waitForFunction(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/assets/residential/')).length>=3);
  await page.screenshot({path:info.outputPath('rotated-houses-fixed.png')});
  expect(errors).toEqual([]);
});
