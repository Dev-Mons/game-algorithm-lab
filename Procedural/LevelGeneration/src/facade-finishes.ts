import {FACADE_ASSETS,type FacadeAssetKey} from './core/facade-assets';
import type {Palette} from './core/selection';

export type FacadeFinish='tower11-d'|'city-roof'|'shop'|'office'|'urban-shop'|'urban-office'|'ribbon-a'|'curtain-b'|'curtain-b-roof'|'streamline-c'|'streamline-c-roof';
export function facadeFinish(assetKey:string):FacadeFinish {
  const asset=FACADE_ASSETS[assetKey as FacadeAssetKey];
  return asset&&'finish' in asset&&asset.finish?asset.finish:'shop';
}

// Palette remains a deterministic building choice; material identity belongs to
// the catalog prototype, never a Viewer guess from a building's volume or ID.
export function facadeColors(finish:FacadeFinish,palette:Palette){
  const tone={clay:0,sage:1,sand:2}[palette];
  if(finish==='tower11-d')return {wall:'#e5e5e2',frame:'#efefec',metal:'#d5d7d5',glass:'#374347',masonry:false};
  if(finish==='city-roof')return {wall:'#575c57',frame:'#6c726c',metal:'#777d78',glass:'#364044',masonry:false};

  if(finish==='streamline-c-roof')return {wall:'#56534b',frame:'#d6d1c4',metal:'#6b685e',glass:'#45443f',masonry:false};
  if(finish==='streamline-c')return {wall:['#d1ccbf','#cacac0','#d5cebd'][tone],
    frame:['#ddd7c9','#d6d5c9','#dfd7c7'][tone],metal:'#8a8679',glass:'#71726a',masonry:false};
  if(finish==='curtain-b-roof')return {wall:'#403e37',frame:'#c8c2b3',metal:'#4d453a',glass:'#655644',masonry:false};
  if(finish==='curtain-b')return {wall:'#a5a49c',frame:'#ddd7c7',metal:'#996e49',glass:['#4c514d','#435354','#55544a'][tone],masonry:false};
  if(finish==='ribbon-a')return {wall:['#b7aa90','#b2ad9c','#bcaf96'][tone],
    frame:['#c8b99e','#c1bba8','#cebea1'][tone],metal:'#34332d',glass:'#474037',masonry:false};
  const shop=finish==='shop',warm=shop||finish==='urban-shop';
  return {
    wall:(shop?['#ab7861','#949083','#bca78b']:warm?['#ad6e53','#8d8973','#bc976d']:['#8d9fa6','#819b98','#aaa99b'])[tone],
    frame:(shop?['#d6c6a9','#d6d4bf','#e2d4b8']:warm?['#ce8e69','#adad8d','#d9b184']:['#c0c9cc','#b6c8c2','#d0cbb9'])[tone],
    metal:warm?'#4b4038':'#354b55',
    glass:warm?'#728d93':'#87a8b6',
    masonry:warm,
  };
}
