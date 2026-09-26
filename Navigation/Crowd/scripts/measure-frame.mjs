import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus, platform } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = arg('url', 'http://127.0.0.1:4273');
const output = arg('output', 'test-results/frame-measurement.json.gz');
const ticks = Number(arg('ticks', '660'));
const quality = arg('quality','off')==='on';
const backend = arg('backend','auto');
const tracing = arg('trace','on')==='on';
const profiling = arg('profile','off')==='on';
const stages = arg('stages','off')==='on';
const source=await (await fetch(`${base}/__crowd_source`)).json();
if(source.app!=='crowd-navigation-lab'||typeof source.root!=='string')throw new Error('Unknown HTTP source identity.');
const sourceHash=()=>{
  const hash=createHash('sha256');
  const walk=path=>{for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file=`${path}/${entry.name}`;if(entry.isDirectory())walk(file);else{hash.update(file.slice(source.root.length));hash.update(readFileSync(file));}
  }};
  walk(`${source.root}/src`);return hash.digest('hex');
};
const commit=execFileSync('git',['-C',source.root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const workingSourceSha256=sourceHash();
const browser = await chromium.launch({ headless: true });
const rows = [];
const cpuProbe=arg('process-cpu','off')==='on'?await browser.newBrowserCDPSession():null;
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, mean: values.reduce((a,b) => a+b,0)/Math.max(1,values.length),
    p50: sorted[Math.floor(sorted.length*.5)] ?? 0, p95: sorted[Math.floor(sorted.length*.95)] ?? 0,
    p99: sorted[Math.floor(sorted.length*.99)] ?? 0, max: sorted.at(-1) ?? 0 };
};
try {
  for (const scenario of arg('scenarios','open-field,rocky-pass').split(','))
    for (const agents of arg('agents','10000').split(',').map(Number))
      for (const seed of arg('seeds','42').split(',').map(Number))
        for (const mode of arg('modes','none,blast,wind').split(','))
          for (let repeat=0; repeat<Number(arg('repeats','3')); repeat++) {
            const page = await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
            const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
            // Wrap the real RAF callback, preserving its clock, renderer, recorder and UI.
            await page.addInitScript(() => {
              window.frameProbe={frames:[],steps:[],audits:[],enabled:false,done:false,main:null};
              const raf=window.requestAnimationFrame.bind(window);
              window.requestAnimationFrame=callback=>{
                if(!window.frameProbe.main&&window.crowdDebug)window.frameProbe.main=callback;
                return raf(now=>{
                const p=window.frameProbe, sim=window.crowdDebug?.simulation();
                if (!p.enabled || !sim || callback!==p.main) return callback(now);
                const tick=sim.stepCount, start=performance.now();
                callback(now);
                p.frames.push({now,tick,after:sim.stepCount,cpu:performance.now()-start});
              });};
            });
            await page.goto(`${base}/?preset=legacy&scenario=${scenario}&agents=${agents}&scale=true&seed=${seed}&paused=true`);
            await page.waitForFunction(()=>window.crowdDebug?.ready);
            const profiler=profiling?await page.context().newCDPSession(page):null;
            if(profiler){await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
            const processBefore=cpuProbe?(await cpuProbe.send('SystemInfo.getProcessInfo')).processInfo:null;
            const processStarted=performance.now();
            const initial=await page.evaluate(async({mode,ticks,quality,backend,tracing,stages})=>{
              const sim=window.crowdDebug.simulation(), p=window.frameProbe;
              if('backend' in sim.external)sim.external.backend=backend;
              window.crowdDebug.setFrameTracing?.(tracing);
              const audit=quality?(await import('/src/core/lab-results.ts')).auditGeometry:null;
              const stageTimes={};let prepareStages=()=>{};
              if(stages) {
                const wrapped=new WeakSet();
                const wrap=(owner,methods)=>{
                  if(!owner||wrapped.has(owner))return;wrapped.add(owner);
                  for(const name of methods) {const original=owner[name];owner[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{stageTimes[name]=(stageTimes[name]??0)+performance.now()-start;}};}
                };
                prepareStages=()=>{
                  const solver=sim.movement.externalContact;if(!solver)return;
                  wrap(solver,['prepareWarmContacts','buildPairs','buildVelocityWorkset','hasResidualCompression','prepareStatics']);
                  wrap(solver.projection,['solve']);wrap(solver.kernel,['solveVelocity','solvePosition']);
                };
              }
              const step=sim.step.bind(sim);
              const click=()=>{
                if(mode==='none')return;
                document.querySelector('#external-tool').value=mode;
                const bounds=document.querySelector('#crowd-canvas').getBoundingClientRect();
                const spawn=sim.scenario.spawn;
                const x=spawn.x+spawn.width*.5,y=spawn.y+spawn.height*.5;
                document.querySelector('#crowd-canvas').dispatchEvent(new MouseEvent('click',{
                  clientX:bounds.left+x/sim.config.width*bounds.width,
                  clientY:bounds.top+y/sim.config.height*bounds.height,bubbles:true}));
              };
              sim.step=()=>{
                prepareStages();
                for(const key of Object.keys(stageTimes))stageTimes[key]=0;
                const tick=sim.stepCount,start=performance.now(); step();
                p.steps.push({tick,ms:performance.now()-start,active:sim.metrics.activeCount,
                  stages:stages?{...stageTimes}:undefined,passes:{...sim.experimentStats.passMs},external:{...sim.external.stats},
                  flow:{kernelBytes:sim.crowdFlow?.kernelBytes??0,pressureGradientCells:sim.crowdFlow?.pressureGradientCells??null,pressureWorksetSize:sim.crowdFlow?.pressureWorksetSize??null,pressureWorksetFallback:sim.crowdFlow?.pressureWorksetFallback??null,cells:sim.crowdField?.cellCount??null}});
                if(audit&&(sim.stepCount%10===0||sim.external.stats.positionBudgetExhaustions||sim.external.stats.unresolvedCompression||sim.external.stats.substepRetries)) {
                  const auditStart=performance.now();
                  p.audits.push({step:sim.stepCount,...audit(sim),auditMs:performance.now()-auditStart});
                }
                // Dispatch after tick 29, before the next timedStep applies commands.
                if(sim.stepCount===30)click();
                if(sim.stepCount>=ticks&&!p.done){p.done=true;document.querySelector('#run-toggle').click();}
              };
              p.enabled=true; document.querySelector('#run-toggle').click();
              return {spawned:sim.state.count,config:sim.config,scenario:sim.scenario.id};
            },{mode,ticks,quality,backend,tracing,stages});
            await page.waitForFunction(()=>window.frameProbe.done,null,{timeout:600000,polling:250});
            const processAfter=cpuProbe?(await cpuProbe.send('SystemInfo.getProcessInfo')).processInfo:null;
            const processWallSeconds=(performance.now()-processStarted)/1000;
            let processCpu=null;
            if(processBefore&&processAfter) {
              const before=new Map(processBefore.map(p=>[p.id,p.cpuTime]));
              const afterIds=new Set(processAfter.map(p=>p.id));
              const cpuSeconds=processAfter.reduce((n,p)=>n+p.cpuTime-(before.get(p.id)??0),0);
              processCpu={cpuSeconds,wallSeconds:processWallSeconds,averageLogicalCores:cpuSeconds/processWallSeconds,
                missingProcessIds:processBefore.filter(p=>!afterIds.has(p.id)).map(p=>p.id),
                resetProcessIds:processAfter.filter(p=>p.cpuTime<(before.get(p.id)??0)).map(p=>p.id),
                before:processBefore,after:processAfter,
                coverage:'Chromium instance process CPU deltas including renderer worker threads, sampled before Start and after the completion poll; excludes GPU device time and processes that exited before the final snapshot.'};
            }
            if(profiler){const {profile}=await profiler.send('Profiler.stop');mkdirSync(dirname(output),{recursive:true});writeFileSync(`${output}.${scenario}-${agents}-${seed}-${mode}-${repeat}.cpuprofile`,JSON.stringify(profile));await profiler.detach();}
            const raw=await page.evaluate(()=>{
              const p=window.frameProbe; p.enabled=false;
              const sim=window.crowdDebug.simulation();
              return {frames:p.frames,steps:p.steps,audits:p.audits,commands:sim.external.record(),hash:sim.stateHash(),
                trace:window.crowdDebug.getFrameTrace?.()??null};
            });
            const phases={};
            for(const [name,lo,hi] of [['pre',5,30],['onset',30,45],['sustained',45,90],['end',90,120],['recovery',120,ticks],['acceptance',30,ticks]]) {
              const frames=raw.frames.filter(f=>f.tick>=lo&&f.tick<hi);
              const steps=raw.steps.filter(s=>s.tick>=lo&&s.tick<hi);
              const intervals=frames.map(f=>{const i=raw.frames.indexOf(f);return i?f.now-raw.frames[i-1].now:0;}).filter(v=>v>0);
              const elapsed=intervals.reduce((a,b)=>a+b,0);
              phases[name]={frameCpuMs:distribution(frames.map(f=>f.cpu)),rafMs:distribution(intervals),
                stepMs:distribution(steps.map(s=>s.ms)),simWall:frames.reduce((a,f)=>a+f.after-f.tick,0)/60/(elapsed/1000),
                over100ms:intervals.filter(v=>v>100).length,over50msRatio:intervals.filter(v=>v>50).length/Math.max(1,intervals.length),
                wallSeconds:elapsed/1000,minimumActive:Math.min(...steps.map(s=>s.active)),
                passes:Object.fromEntries(Object.keys(steps[0]?.passes??{}).map(k=>[k,distribution(steps.map(s=>s.passes[k]))]))};
            }
            const row={scenario,agents,seed,mode,repeat,quality,backend,tracing,profiling,initial,errors,processCpu,phases,...raw}; rows.push(row);
            console.log(JSON.stringify({scenario,agents,seed,mode,repeat,errors,acceptance:phases.acceptance}));
            mkdirSync(dirname(output),{recursive:true});
            const report=JSON.stringify({schema:'crowd-real-frame-v1',createdAt:new Date().toISOString(),url:base,
              commit,workingSourceSha256,sourceStable:sourceHash()===workingSourceSha256,
              cpu:cpus()[0]?.model,platform:platform(),node:process.version,browser:browser.version(),
              profile:`Real HTTP app RAF/FixedClock/timedStep/Canvas/UI; quality ${quality?'ON: independent audit every 10 ticks and on every exhausted position budget or retried tick; these frames are not performance results':'OFF'}; input tick 30 via Canvas click; seed/force/dt/radius unchanged; CPU submission, not GPU presentation`,rows});
            writeFileSync(output,output.endsWith('.gz')?gzipSync(report):report);
            await page.close();
          }
} finally { await browser.close(); }
