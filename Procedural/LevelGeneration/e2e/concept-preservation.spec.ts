import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {conceptPreservationCases} from '../tests/concept-preservation-fixtures';
import {generateDocument} from '../src/core/generate-document';
import {expectCompleteFaces} from './complete-faces';
import {createDocument,type GenerationDocument} from '../src/core/document';
import {box} from '../src/fixtures';

// Reuse the PNG reader in the pinned Playwright dependency; no runtime dependency
// enters the application. Compare decoded pixels, not PNG compressor output.
const require=createRequire(import.meta.url);
const {PNG}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js')) as {PNG:{sync:{read(buffer:Buffer):{width:number;height:number;data:Buffer}}}};
type ExcludedOverlay={xMin:number;yMin:number;xMaxExclusive:number;yMaxExclusive:number;boxShadow:string;shadowMargin:number};
async function cameraOverlay(page:Page):Promise<ExcludedOverlay>{
  return page.locator('.camera-bar').evaluate(element=>{
    const bar=element.getBoundingClientRect(),canvas=document.querySelector('canvas')!.getBoundingClientRect();
    return {xMin:Math.floor(bar.left-canvas.left),yMin:Math.floor(bar.top-canvas.top),xMaxExclusive:Math.ceil(bar.right-canvas.left),yMaxExclusive:Math.ceil(bar.bottom-canvas.top),boxShadow:getComputedStyle(element).boxShadow,shadowMargin:0};
  });
}
async function compareCapturedRenders(root:string,overlay:ExcludedOverlay){
  const before=JSON.parse(await readFile(path.join(root,'baseline.json'),'utf8'));
  const after=JSON.parse(await readFile(path.join(root,'after.json'),'utf8'));
  expect(after.browser).toBe(before.browser);expect(Object.keys(after.shots)).toEqual(Object.keys(before.shots));
  // Current CSS has no shadow: only its measured, occluding DOM rectangle is excluded.
  expect(overlay.boxShadow).toBe('none');
  const comparisons=[];
  for(const id of Object.keys(after.shots)){
    expect(after.shots[id].meshes,id).toEqual(before.shots[id].meshes);
    const buffers=await Promise.all(['baseline','after'].map(phase=>readFile(path.join(root,phase,`${id}.png`))));
    expect(createHash('sha256').update(buffers[0]).digest('hex')).toBe(before.shots[id].sha256);
    expect(createHash('sha256').update(buffers[1]).digest('hex')).toBe(after.shots[id].sha256);
    const [a,b]=buffers.map(buffer=>PNG.sync.read(buffer));expect([a.width,a.height]).toEqual([b.width,b.height]);
    let differentPixels=0,outsideOverlayPixels=0,maxChannelDelta=0;
    let xMin=Infinity,yMin=Infinity,xMax=-1,yMax=-1;
    for(let offset=0;offset<a.data.length;offset+=4){
      let changed=false;
      for(let channel=0;channel<4;channel++){
        const delta=Math.abs(a.data[offset+channel]-b.data[offset+channel]);
        if(delta){changed=true;maxChannelDelta=Math.max(maxChannelDelta,delta);}
      }
      if(!changed)continue;
      const x=offset/4%a.width,y=Math.floor(offset/4/a.width);differentPixels++;
      xMin=Math.min(xMin,x);yMin=Math.min(yMin,y);xMax=Math.max(xMax,x);yMax=Math.max(yMax,y);
      if(x<overlay.xMin||x>=overlay.xMaxExclusive||y<overlay.yMin||y>=overlay.yMaxExclusive)outsideOverlayPixels++;
    }
    comparisons.push({id,byteIdentical:buffers[0].equals(buffers[1]),differentPixels,outsideOverlayPixels,maxChannelDelta,differingBounds:differentPixels?{xMin,yMin,xMaxInclusive:xMax,yMaxInclusive:yMax}:null});
  }
  await writeFile(path.join(root,'comparison.json'),JSON.stringify({browser:after.browser,viewport:after.viewport,excludedOverlay:{selector:'.camera-bar',...overlay},modelPixelTolerance:0,comparisons},null,2)+'\n');
  for(const row of comparisons)expect(row.outsideOverlayPixels,`${row.id}: pixels outside the camera controls`).toBe(0);
}

async function hideAnalysis(page:Page){
  await page.locator('.layers summary').click();
  for(const id of ['layer-edges','environment-inputs','environment-plans'])await page.locator(`#${id}`).uncheck();
  await page.locator('.layers summary').click();
}

// Opt in because the baseline belongs to the pre-refactor checkout, not snapshots
// captured from whatever implementation happens to be under test.
test('@preservation A–D production renders match the captured pre-refactor views',async({page,browser})=>{
  test.skip(!process.env.CONCEPT_PRESERVATION_PHASE,'Run with the preserved baseline checkout and explicit baseline/after phase.');
  test.setTimeout(240_000);
  const phase=process.env.CONCEPT_PRESERVATION_PHASE!,root=process.env.CONCEPT_PRESERVATION_OUTPUT??'artifacts/concept-preservation';
  const directory=path.join(root,phase);await mkdir(directory,{recursive:true});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await hideAnalysis(page);
  if(process.env.CONCEPT_PRESERVATION_REVIEW_ONLY==='1'){
    await compareCapturedRenders(root,await cameraOverlay(page));return;
  }
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
  const buildArtifacts=Object.fromEntries(await Promise.all((await readdir('dist/assets')).filter(f=>/\.(js|css)$/.test(f)).sort().map(async f=>[f,createHash('sha256').update(await readFile(`dist/assets/${f}`)).digest('hex')])));
  await writeFile(path.join(root,`${phase}.json`),JSON.stringify({browser:browser.version(),viewport:{width:1440,height:960},seed:42,buildArtifacts,shots},null,2)+'\n');
  if(phase==='after'){
    await compareCapturedRenders(root,await cameraOverlay(page));
  }
});

for(const [label,profile,height] of [['A','shop',7],['C','urban-shop',3]] as const){
  test(`${label} reused face Meshes after native edits, history and file restore match a fresh Viewer`,async({page,browser})=>{
    test.setTimeout(180_000);
    const root=process.env.CONCEPT_PRESERVATION_OUTPUT??'artifacts/concept-preservation',directory=path.join(root,`edits-${label}`);
    await mkdir(directory,{recursive:true});
    const comparisons:{state:string;cells:number;sha256:string}[]=[];
    await page.goto('/?measure=1');await hideAnalysis(page);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const load=async(target:Page,document:GenerationDocument)=>{
      await target.locator('#file').setInputFiles({name:'mesh-reuse.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
      await expect(target.locator('#status')).toHaveText('OK');
    };
    await load(page,createDocument(box(8,height,5),42,profile));
    const selectRoof=async(y:number)=>{
      await page.locator('[data-camera="top"]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const points=await page.evaluate(y=>[[0,y,0],[7,y,4]].map(p=>(window as any).environmentMeasure.point(p)),y);
      await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();
      await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();
      await expect(page.locator('canvas')).toHaveAttribute('data-selection-cells','40');
    };
    const capture=async(target:Page,name:string)=>{
      await target.locator('canvas').focus();await target.keyboard.press('Escape');
      await target.locator('[data-camera="iso"]').click();
      await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      return target.locator('canvas').screenshot({path:path.join(directory,name),style:'.stage-top,.camera-bar,#selection-status,.stage-bottom{visibility:hidden!important}'});
    };
    const freshComparison=async(name:string)=>{
      const document:GenerationDocument=await page.evaluate(()=>(window as any).environmentMeasure.snapshot().document);
      await expectCompleteFaces(page,generateDocument(document,{cache:false}));
      const actual=await capture(page,`${name}-edited.png`);
      const context=await browser.newContext({viewport:{width:1440,height:960}}),fresh=await context.newPage();
      try{
        await fresh.goto(new URL('/?measure=1',page.url()).href);await hideAnalysis(fresh);await load(fresh,document);
        const expected=await capture(fresh,`${name}-fresh.png`);
        const sha256=createHash('sha256').update(actual).digest('hex');
        expect(sha256,name).toBe(createHash('sha256').update(expected).digest('hex'));
        comparisons.push({state:name,cells:document.grid.length,sha256});
      }finally{await context.close();}
    };
    await selectRoof(height);await page.keyboard.press('e');
    await expect(page.locator('#stats strong').first()).toHaveText(String(40*(height+1)));
    await freshComparison('add');
    await selectRoof(height+1);await page.keyboard.press('q');
    await expect(page.locator('#stats strong').first()).toHaveText(String(40*height));
    await freshComparison('remove');
    await page.locator('canvas').focus();await page.keyboard.press('Control+z');
    await expect(page.locator('#stats strong').first()).toHaveText(String(40*(height+1)));
    await freshComparison('undo');
    await page.locator('canvas').focus();await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('#stats strong').first()).toHaveText(String(40*height));
    await freshComparison('redo');
    const pending=page.waitForEvent('download');await page.locator('#save').click();
    const stream=await (await pending).createReadStream(),chunks:Buffer[]=[];
    for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
    await page.locator('#file').setInputFiles({name:'mesh-reuse.json',mimeType:'application/json',buffer:Buffer.concat(chunks)});
    await expect(page.locator('#status')).toHaveText('OK');
    await freshComparison('restore');expect(errors).toEqual([]);
    await writeFile(path.join(root,`edits-${label}.json`),JSON.stringify({browser:browser.version(),seed:42,profile,initialDimensions:[8,height,5],comparison:'exact PNG SHA256 to a fresh Viewer, UI overlays hidden',comparisons},null,2)+'\n');
  });
}
