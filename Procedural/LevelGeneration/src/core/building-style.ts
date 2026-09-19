import {ASSET_ROWS,type AssetRow,type BandedFacadeKey} from "./banded-facade-assets";
import {rooftopBandedKey} from './rooftop-facade-assets';
import { FACADE_ASSETS, type FacadeAssetKey } from './facade-assets';
import type { Direction } from './analysis';
import { BUILDING_USES, type BuildingUse } from './environment-contract';
import { exactKeys, cloneJSON } from './canonical';
import {validatePrograms,type ArchitecturalProgram} from './architectural-program';
import type {MassPolicy} from './mass-relations';
import type {FacadeGrammar} from './facade-plan';
import {frameAssetKey} from './urban-facade-assets';
import {ribbonAKey} from './ribbon-a-assets';
import {curtainBKey} from './curtain-b-assets';
import {streamlineCKey,type StreamlineCKey} from './streamline-c-assets';
import {COLUMN_ASSETS} from './column-prototype';
export type VerticalBand = string;
export type FacadeKind = 'front' | 'side';
export interface BuildingModule {
  id:string; assetId:FacadeAssetKey; semantic:'wall'|'window'|'entrance'|'pier'|'corner'|'trim';
  width:number; height:number; directions:Direction[];
  connection?:{family:string;part:'single'|'left'|'middle'|'right'};
  rowAssets?:Record<AssetRow,FacadeAssetKey>;
  rooftopAssets?:Record<AssetRow,FacadeAssetKey>;
}
export interface FacadePattern {
  id:string;start:string[];repeat:string[];end:string[];minRepeat:number;maxRepeat:number;
  roles:VerticalBand[];facades:FacadeKind[];minWidth:number;priority:number;remainder:string;
}
export interface BandPolicy {
  baseRatioPermille:Record<BuildingUse,number>;crownRatioPermille:number;maxBaseCells:number;maxCrownCells:number;
  baseCountOverride?:number;crownCountOverride?:number;
}
export interface BandDefinition {moduleSet:string[];fallback:string}
export interface AlignedFamily {id:string;periodCells:number;patterns:Record<VerticalBand,string[]>;priority:number}
export interface BuildingStyle {
  format:'banded-facade-v1';id:string;version:number;label:string;
  bandPolicy:BandPolicy;bands:Record<VerticalBand,BandDefinition>;alignedFamilies:AlignedFamily[];
  modules:BuildingModule[];patterns:FacadePattern[];fallback:string;entrance:string;entrancePair:[string,string];
  corner:{module:string;minRunWidth:number};topTrim:string;frontOrder:Direction[];groundY:0;
  programs?:ArchitecturalProgram[];
  massPolicy?:MassPolicy;
  facadeGrammar?:FacadeGrammar;
  roofAsset?:FacadeAssetKey;
  terraceAsset?:FacadeAssetKey;
}
export const DEFAULT_BAND_POLICY:BandPolicy={baseRatioPermille:{retail:250,office:200,generic:200,residential:167,industrial:200},crownRatioPermille:100,maxBaseCells:4,maxCrownCells:3};
export const VERTICAL_BANDS:('base'|'body'|'crown')[]=['base','body','crown'];
const walls:Direction[]=['PX','NX','PZ','NZ'];
const module=(id:string,assetId:FacadeAssetKey,semantic:BuildingModule['semantic'],connection?:BuildingModule['connection']):BuildingModule=>({id,assetId,semantic,width:1,height:1,directions:[...walls],...(connection?{connection}:{})});
function stockStyle(id:'shop'|'office'):BuildingStyle {
  const modules:BuildingModule[]=[module('wall','facade.wall','wall'),module('entry','facade.portal-single','entrance'),module('entry-left','facade.portal-left','entrance',{family:'portal',part:'left'}),module('entry-right','facade.portal-right','entrance',{family:'portal',part:'right'}),module('trim','facade.cap','trim')];
  for(const band of VERTICAL_BANDS)for(const part of ['single','left','right','pier'] as const){
    const key=`${band}-${part}`,rowAssets=Object.fromEntries(ASSET_ROWS.map(row=>[row,`facade.banded-${id}-${band}-${row}-${part}`])) as Record<AssetRow,BandedFacadeKey>;
    const rooftopAssets=Object.fromEntries(ASSET_ROWS.map(row=>[row,rooftopBandedKey(`facade.banded-${id}-${band}-${row.replace('-cap','')}-cap-${part}` as BandedFacadeKey)])) as Record<AssetRow,FacadeAssetKey>;
    modules.push({...module(key,rowAssets.repeat,part==='pier'?'pier':'window',part==='pier'?undefined:{family:`${id}:${band}`,part}),rowAssets,rooftopAssets});
  }
  for(const m of modules.filter(m=>m.semantic==='entrance'||m.semantic==='wall')) {
    const suffix=m.semantic==='wall'?'wall':m.assetId.slice('facade.'.length);
    m.rooftopAssets=Object.fromEntries(ASSET_ROWS.map(row=>[row,`facade.rooftop-${id}-${suffix}`])) as Record<AssetRow,FacadeAssetKey>;
  }
  const patterns=VERTICAL_BANDS.map((band):FacadePattern=>({id:`${band}-rhythm`,start:[],repeat:[`${band}-left`,`${band}-right`,`${band}-pier`],end:[],minRepeat:1,maxRepeat:32,roles:[band],facades:['front','side'],minWidth:1,priority:100,remainder:`${band}-single`}));
  return {format:'banded-facade-v1',id,version:5,label:id==='shop'?'A':'B',bandPolicy:cloneJSON(DEFAULT_BAND_POLICY),
    bands:Object.fromEntries(VERTICAL_BANDS.map(b=>[b,{moduleSet:['wall','entry','entry-left','entry-right','trim',`${b}-single`,`${b}-left`,`${b}-right`,`${b}-pier`],fallback:`${b}-single`}])) as Record<VerticalBand,BandDefinition>,
    alignedFamilies:[{id:'paired-pier',periodCells:3,priority:100,patterns:{base:['base-rhythm'],body:['body-rhythm'],crown:['crown-rhythm']}}],modules,patterns,fallback:'wall',entrance:'entry',entrancePair:['entry-left','entry-right'],corner:{module:'body-pier',minRunWidth:3},topTrim:'trim',frontOrder:['PZ','PX','NZ','NX'],groundY:0};
}
export const LEGACY_SHOP_STYLE=stockStyle('shop');
function ribbonStyle():BuildingStyle {
  const style=stockStyle('shop');style.version=6;
  for(const m of style.modules){
    if(m.semantic==='trim')continue;
    m.assetId=ribbonAKey(m.assetId);
    for(const variants of [m.rowAssets,m.rooftopAssets])if(variants)
      for(const row of ASSET_ROWS)variants[row]=ribbonAKey(variants[row]);
  }
  return style;
}
export const SHOP_STYLE=ribbonStyle();
export const LEGACY_OFFICE_STYLE=stockStyle('office');
function curtainStyle():BuildingStyle {
  const style=stockStyle('office');style.version=7;style.roofAsset='facade.curtain-b-roof';
  style.bandPolicy.crownRatioPermille=200;
  for(const m of style.modules){
    if(m.semantic==='trim')continue;
    m.assetId=curtainBKey(m.assetId);
    for(const variants of [m.rowAssets,m.rooftopAssets])if(variants)
      for(const row of ASSET_ROWS)variants[row]=curtainBKey(variants[row]);
  }
  for(const p of style.patterns)p.repeat[2]=`${p.roles[0]}-single`;
  return style;
}
export const OFFICE_STYLE=curtainStyle();
/** Legacy styles remain exact presets. New urban presets share the same mesh supplier. */
export function urbanStyle(kind:'shop'|'office'):BuildingStyle {
  const style=stockStyle(kind);style.id=`urban-${kind}`;style.label=kind==='shop'?'C':'D';
  const roles={retail:'base',office:'body',upper:'crown',mechanical:'body'} as const;
  style.modules.push(module('louver','facade.urban-louver','wall'));
  style.bands={};style.patterns=[];style.alignedFamilies=[];
  for(const [id,legacy] of Object.entries(roles))style.bands[id]={moduleSet:[...stockStyle(kind).bands[legacy].moduleSet,'louver'],fallback:id==='mechanical'?'louver':`${legacy}-single`};
  for(const period of [2,3,4]){
    const patterns:Record<string,string[]>={};
    for(const [id,legacy] of Object.entries(roles)){
      const key=`${id}-${period}`,repeat=id==='mechanical'?Array<string>(period).fill('louver'):[`${legacy}-left`,`${legacy}-right`,...Array<string>(period-2).fill(`${legacy}-pier`)];
      style.patterns.push({id:key,start:[],repeat,end:[],minRepeat:1,maxRepeat:32,roles:[id],facades:['front','side'],minWidth:1,priority:100,remainder:style.bands[id].fallback});patterns[id]=[key];
    }
    style.alignedFamilies.push({id:`bay-${period}`,periodCells:period,priority:100,patterns});
  }
  style.programs=[1,2].map(n=>({id:`mixed-${n}`,fallback:'retail',sections:[
    {id:'retail',scope:'ground',required:true,min:1,preferred:kind==='shop'?n:1,max:2,priority:100,minHeight:1},
    {id:'office',scope:'repeat',required:true,min:1,preferred:1,max:32,priority:0,minHeight:1},
    {id:'upper',scope:'upper',required:false,min:1,preferred:n,max:2,priority:80,minHeight:4},
    {id:'mechanical',scope:'upper',required:false,min:1,preferred:1,max:1,priority:20,minHeight:12},
  ]}));
  style.massPolicy={minArea:4,minWidth:2,minPersistence:2,changePermille:150};
  for(let bits=0;bits<16;bits++)style.modules.push(module(`frame-${bits}`,frameAssetKey(bits,kind),'window'));
  style.facadeGrammar={sections:['office'],periodV:2,minWidth:2,minHeight:2,boundaryPolicy:'absolute',maxGroups:4096,frameStyle:kind};
  return style;
}
export const LEGACY_URBAN_SHOP_STYLE=urbanStyle('shop');
function streamlineStyle():BuildingStyle {
  const style=urbanStyle('shop');style.version=8;style.roofAsset='facade.streamline-c-roof';style.terraceAsset='facade.streamline-c-terrace';
  delete style.facadeGrammar;
  style.modules=style.modules.filter(m=>!m.id.startsWith('frame-'));
  for(const m of style.modules){
    if(m.semantic==='trim')continue;
    if(m.id.startsWith('base-'))delete m.connection;
    m.assetId=m.id==='louver'?'facade.streamline-c-wall':streamlineCKey(m.assetId);
    for(const variants of [m.rowAssets,m.rooftopAssets])if(variants)
      for(const row of ASSET_ROWS)variants[row]=streamlineCKey(variants[row]);
  }
  for(const p of style.patterns)if(p.roles[0]==='mechanical'){
    p.repeat.fill('crown-single');p.remainder='crown-single';
  }
  style.bands.mechanical={moduleSet:[...style.bands.upper.moduleSet],fallback:'crown-single'};
  for(const program of style.programs!){
    const base=program.sections.find(s=>s.id==='retail')!;base.preferred=2;base.max=2;
    // A two-cell building uses the retail fallback, leaving room for the
    // full lower window plus its half-cell transom before the roof.
    program.sections.find(s=>s.id==='office')!.minHeight=3;
  }
  for(const key of Object.keys(COLUMN_ASSETS))style.modules.push(module(key,key.replace('urban-column','streamline-c-column') as StreamlineCKey,'wall'));
  return style;
}
export const URBAN_SHOP_STYLE=streamlineStyle();
export const URBAN_OFFICE_STYLE=urbanStyle('office');
// E reuses the metal prototypes with taller, three-floor glazing groups.
export const STYLE_E:BuildingStyle={...urbanStyle('office'),id:'style-e',label:'E',
  facadeGrammar:{...URBAN_OFFICE_STYLE.facadeGrammar!,periodV:3,minHeight:3}};
export function validateBuildingStyle(style:BuildingStyle):BuildingStyle {
  const fail=():never=>{throw new Error('INVALID_BANDED_BUILDING_STYLE');};
  const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]+$/.test(v);
  const range=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
  exactKeys(style,['format','id','version','label','bandPolicy','bands','alignedFamilies','modules','patterns','fallback','entrance','entrancePair','corner','topTrim','frontOrder','groundY'],['programs','massPolicy','facadeGrammar','roofAsset','terraceAsset']);
  if(style.roofAsset!==undefined){const a=FACADE_ASSETS[style.roofAsset];if(!a||!('surfaceRole' in a)||a.surfaceRole!=='roof')fail();}
  if(style.terraceAsset!==undefined){const a=FACADE_ASSETS[style.terraceAsset];if(!a||!('surfaceRole' in a)||a.surfaceRole!=='terrace')fail();}
  if(style.massPolicy!==undefined){const p=style.massPolicy;exactKeys(p,['minArea','minWidth','minPersistence','changePermille']);if(!style.programs||!range(p.minArea,1,1024)||!range(p.minWidth,1,32)||!range(p.minPersistence,1,32)||!range(p.changePermille,1,1000))fail();}
  if(style.format!=='banded-facade-v1'||!id(style.id)||!range(style.version,1,0x7fffffff)||typeof style.label!=='string'||style.label.length>120||style.groundY!==0) fail();
  const policy=style.bandPolicy;
  exactKeys(policy,['baseRatioPermille','crownRatioPermille','maxBaseCells','maxCrownCells'],['baseCountOverride','crownCountOverride']);
  exactKeys(policy.baseRatioPermille,BUILDING_USES);
  if(!range(policy.crownRatioPermille,50,250)||!range(policy.maxBaseCells,2,16)||!range(policy.maxCrownCells,1,8)||(policy.baseCountOverride!==undefined&&!range(policy.baseCountOverride,1,16))||(policy.crownCountOverride!==undefined&&!range(policy.crownCountOverride,0,8))||BUILDING_USES.some(use=>!range(policy.baseRatioPermille[use],100,400)||policy.baseRatioPermille[use]+policy.crownRatioPermille>650)) fail();
  if(!Array.isArray(style.modules)||!style.modules.length||style.modules.length>256||!Array.isArray(style.patterns)||style.patterns.length>100) fail();
  const mods=new Map<string,BuildingModule>();
  for(const m of style.modules) {
    exactKeys(m,['id','assetId','semantic','width','height','directions'],['connection','rowAssets','rooftopAssets']);
    if(!id(m.id)||mods.has(m.id)||!Object.hasOwn(FACADE_ASSETS,m.assetId)||m.width!==1||m.height!==1||!['wall','window','entrance','pier','corner','trim'].includes(m.semantic)||!Array.isArray(m.directions)||!m.directions.length||new Set(m.directions).size!==m.directions.length||m.directions.some(d=>!walls.includes(d))) fail();
    for(const variants of [m.rowAssets,m.rooftopAssets])if(variants){exactKeys(variants,ASSET_ROWS);for(const key of Object.values(variants)){
      const descriptor=FACADE_ASSETS[key];if(!descriptor||!('structural' in descriptor)||!descriptor.structural)fail();
      if(m.connection&&(!('part' in descriptor)||descriptor.part!==m.connection.part))fail();
      if(m.semantic==='pier'&&!('pierWidth16' in descriptor))fail();
    }}
    const asset=FACADE_ASSETS[m.assetId];
    if((m.semantic==='trim')!==['facade.cornice','facade.cap'].includes(m.assetId)) fail();
    if(m.connection) {
      exactKeys(m.connection,['family','part']);
      const p=m.connection.part,opening='opening' in asset?asset.opening:undefined;
      if(!id(m.connection.family)||!['single','left','middle','right'].includes(p)||!opening||!!('openLeft' in opening&&opening.openLeft)!==(p==='right'||p==='middle')||!!('openRight' in opening&&opening.openRight)!==(p==='left'||p==='middle')) fail();
    }
    mods.set(m.id,m);
  }
  const unit=(key:string)=>{const m=mods.get(key);return !!m&&m.semantic!=='trim'&&(!m.connection||m.connection.part==='single');};
  const openingSignature=(m:BuildingModule)=>[m.assetId,...(m.rowAssets?ASSET_ROWS.map(r=>m.rowAssets![r]):[]),...(m.rooftopAssets?ASSET_ROWS.map(r=>m.rooftopAssets![r]):[])].map(key=>{
    const a=FACADE_ASSETS[key];if(!('opening' in a)||!a.opening)return '';
    return [a.opening.minY,a.opening.maxY,'railWidth16' in a?a.railWidth16:'default','jointFamily' in a?a.jointFamily:'default'].join('|');
  }).join(';');
  const group=(keys:string[])=>{
    if(!Array.isArray(keys)||keys.length>32) return false;
    let family:string|undefined,height:string|undefined;
    for(const key of keys) {
      const m=mods.get(key);if(!m||m.semantic==='trim'||m.semantic==='entrance') return false;
      const c=m.connection;
      if(!c||c.part==='single') {if(family) return false;}
      else {
        const a=FACADE_ASSETS[m.assetId];if(!('opening' in a)||!a.opening) return false;
        const h=openingSignature(m);
        if(c.part==='left') {if(family) return false;family=c.family;height=h;}
        else {if(family!==c.family||height!==h) return false;if(c.part==='right') family=undefined;}
      }
    }
    return !family;
  };
  const roles=style.programs?Object.keys(style.bands):VERTICAL_BANDS;
  if(!roles.length||roles.length>16||roles.some(r=>!id(r)))fail();
  if(style.programs!==undefined)validatePrograms(style.programs,roles);
  if(style.facadeGrammar!==undefined){const g=style.facadeGrammar;exactKeys(g,['sections','periodV','minWidth','minHeight','boundaryPolicy','maxGroups'],['frameStyle']);if((g.frameStyle!==undefined&&!['shop','office'].includes(g.frameStyle))||!style.programs||!Array.isArray(g.sections)||!g.sections.length||g.sections.some(r=>!roles.includes(r))||!range(g.periodV,2,8)||!range(g.minWidth,2,8)||!range(g.minHeight,2,g.periodV)||!['absolute','restart'].includes(g.boundaryPolicy)||!range(g.maxGroups,1,16384)||Array.from({length:16},(_,i)=>i).some(i=>mods.get(`frame-${i}`)?.assetId!==frameAssetKey(i,g.frameStyle)))fail();}
  const patterns=new Map<string,FacadePattern>();
  for(const p of style.patterns) {
    exactKeys(p,['id','start','repeat','end','minRepeat','maxRepeat','roles','facades','minWidth','priority','remainder']);
    if(!id(p.id)||patterns.has(p.id)||!group(p.start)||!group(p.repeat)||!p.repeat.length||!group(p.end)||!unit(p.remainder)||!range(p.minRepeat,1,32)||!range(p.maxRepeat,p.minRepeat,32)||!range(p.minWidth,1,32)||!Number.isSafeInteger(p.priority)||!Array.isArray(p.roles)||!p.roles.length||p.roles.some(r=>!roles.includes(r))||!Array.isArray(p.facades)||!p.facades.length||p.facades.some(f=>!['front','side'].includes(f))) fail();
    patterns.set(p.id,p);
  }
  exactKeys(style.bands,roles);
  for(const b of roles) {const band=style.bands[b];exactKeys(band,['moduleSet','fallback']);if(!Array.isArray(band.moduleSet)||!band.moduleSet.length||band.moduleSet.some(m=>!mods.has(m))||!unit(band.fallback)||!band.moduleSet.includes(band.fallback)) fail();}
  if(!Array.isArray(style.alignedFamilies)||!style.alignedFamilies.length) fail();
  const families=new Set<string>();
  for(const f of style.alignedFamilies) {
    exactKeys(f,['id','periodCells','patterns','priority']);exactKeys(f.patterns,roles);
    if(!id(f.id)||families.has(f.id)||!range(f.periodCells,1,8)||!Number.isSafeInteger(f.priority)) fail();families.add(f.id);
    for(const b of roles) if(!Array.isArray(f.patterns[b])||!f.patterns[b].length||f.patterns[b].some(k=>{const p=patterns.get(k);return !p||p.repeat.length!==f.periodCells||!p.roles.includes(b)||[...p.start,...p.repeat,...p.end,p.remainder].some(m=>!style.bands[b].moduleSet.includes(m));})) fail();
  }
  if(!Array.isArray(style.entrancePair)||style.entrancePair.length!==2)fail();
  const pair=style.entrancePair.map(k=>mods.get(k));
  if(pair.some(m=>!m||m.semantic!=='entrance')||pair[0]!.connection?.part!=='left'||pair[1]!.connection?.part!=='right'||pair[0]!.connection?.family!==pair[1]!.connection?.family||openingSignature(pair[0]!)!==openingSignature(pair[1]!))fail();
  exactKeys(style.corner,['module','minRunWidth']);
  if(!unit(style.fallback)||mods.get(style.fallback)?.semantic!=='wall'||walls.some(d=>!mods.get(style.fallback)!.directions.includes(d))||mods.get(style.entrance)?.semantic!=='entrance'||!unit(style.corner.module)||!range(style.corner.minRunWidth,2,32)||mods.get(style.topTrim)?.semantic!=='trim'||!Array.isArray(style.frontOrder)||style.frontOrder.length!==4||new Set(style.frontOrder).size!==4||style.frontOrder.some(d=>!walls.includes(d))) fail();
  return cloneJSON(style);
}
