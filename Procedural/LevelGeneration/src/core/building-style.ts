import {ASSET_ROWS,type AssetRow,type BandedFacadeKey} from "./banded-facade-assets";
import {rooftopBandedKey} from './rooftop-facade-assets';
import { FACADE_ASSETS, type FacadeAssetKey } from './facade-assets';
import type { Direction } from './analysis';
import { BUILDING_USES, type BuildingUse } from './environment-contract';
import { exactKeys, cloneJSON } from './canonical';
export type VerticalBand = 'base' | 'body' | 'crown';
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
}
export const DEFAULT_BAND_POLICY:BandPolicy={baseRatioPermille:{retail:250,office:200,generic:200,residential:167,industrial:200},crownRatioPermille:100,maxBaseCells:4,maxCrownCells:3};
export const VERTICAL_BANDS:VerticalBand[]=['base','body','crown'];
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
  return {format:'banded-facade-v1',id,version:5,label:id==='shop'?'상가형':'업무형',bandPolicy:cloneJSON(DEFAULT_BAND_POLICY),
    bands:Object.fromEntries(VERTICAL_BANDS.map(b=>[b,{moduleSet:['wall','entry','entry-left','entry-right','trim',`${b}-single`,`${b}-left`,`${b}-right`,`${b}-pier`],fallback:`${b}-single`}])) as Record<VerticalBand,BandDefinition>,
    alignedFamilies:[{id:'paired-pier',periodCells:3,priority:100,patterns:{base:['base-rhythm'],body:['body-rhythm'],crown:['crown-rhythm']}}],modules,patterns,fallback:'wall',entrance:'entry',entrancePair:['entry-left','entry-right'],corner:{module:'body-pier',minRunWidth:3},topTrim:'trim',frontOrder:['PZ','PX','NZ','NX'],groundY:0};
}
export const SHOP_STYLE=stockStyle('shop');
export const OFFICE_STYLE=stockStyle('office');
export function validateBuildingStyle(style:BuildingStyle):BuildingStyle {
  const fail=():never=>{throw new Error('INVALID_BANDED_BUILDING_STYLE');};
  const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]+$/.test(v);
  const range=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
  exactKeys(style,['format','id','version','label','bandPolicy','bands','alignedFamilies','modules','patterns','fallback','entrance','entrancePair','corner','topTrim','frontOrder','groundY']);
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
  const patterns=new Map<string,FacadePattern>();
  for(const p of style.patterns) {
    exactKeys(p,['id','start','repeat','end','minRepeat','maxRepeat','roles','facades','minWidth','priority','remainder']);
    if(!id(p.id)||patterns.has(p.id)||!group(p.start)||!group(p.repeat)||!p.repeat.length||!group(p.end)||!unit(p.remainder)||!range(p.minRepeat,1,32)||!range(p.maxRepeat,p.minRepeat,32)||!range(p.minWidth,1,32)||!Number.isSafeInteger(p.priority)||!Array.isArray(p.roles)||!p.roles.length||p.roles.some(r=>!VERTICAL_BANDS.includes(r))||!Array.isArray(p.facades)||!p.facades.length||p.facades.some(f=>!['front','side'].includes(f))) fail();
    patterns.set(p.id,p);
  }
  exactKeys(style.bands,VERTICAL_BANDS);
  for(const b of VERTICAL_BANDS) {const band=style.bands[b];exactKeys(band,['moduleSet','fallback']);if(!Array.isArray(band.moduleSet)||!band.moduleSet.length||band.moduleSet.some(m=>!mods.has(m))||!unit(band.fallback)||!band.moduleSet.includes(band.fallback)) fail();}
  if(!Array.isArray(style.alignedFamilies)||!style.alignedFamilies.length) fail();
  const families=new Set<string>();
  for(const f of style.alignedFamilies) {
    exactKeys(f,['id','periodCells','patterns','priority']);exactKeys(f.patterns,VERTICAL_BANDS);
    if(!id(f.id)||families.has(f.id)||!range(f.periodCells,1,8)||!Number.isSafeInteger(f.priority)) fail();families.add(f.id);
    for(const b of VERTICAL_BANDS) if(!Array.isArray(f.patterns[b])||!f.patterns[b].length||f.patterns[b].some(k=>{const p=patterns.get(k);return !p||p.repeat.length!==f.periodCells||!p.roles.includes(b)||[...p.start,...p.repeat,...p.end,p.remainder].some(m=>!style.bands[b].moduleSet.includes(m));})) fail();
  }
  if(!Array.isArray(style.entrancePair)||style.entrancePair.length!==2)fail();
  const pair=style.entrancePair.map(k=>mods.get(k));
  if(pair.some(m=>!m||m.semantic!=='entrance')||pair[0]!.connection?.part!=='left'||pair[1]!.connection?.part!=='right'||pair[0]!.connection?.family!==pair[1]!.connection?.family||openingSignature(pair[0]!)!==openingSignature(pair[1]!))fail();
  exactKeys(style.corner,['module','minRunWidth']);
  if(!unit(style.fallback)||mods.get(style.fallback)?.semantic!=='wall'||walls.some(d=>!mods.get(style.fallback)!.directions.includes(d))||mods.get(style.entrance)?.semantic!=='entrance'||!unit(style.corner.module)||!range(style.corner.minRunWidth,2,32)||mods.get(style.topTrim)?.semantic!=='trim'||!Array.isArray(style.frontOrder)||style.frontOrder.length!==4||new Set(style.frontOrder).size!==4||style.frontOrder.some(d=>!walls.includes(d))) fail();
  return cloneJSON(style);
}
