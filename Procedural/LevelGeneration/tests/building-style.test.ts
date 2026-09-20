import {expect,it} from "vitest";
import {OFFICE_STYLE,SHOP_STYLE,validateBuildingStyle} from "../src/core/building-style";
import {chooseFacadePattern} from "../src/core/facade-patterns";
import {createDocument,exportDocument,loadDocument} from "../src/core/document";
it.each([SHOP_STYLE,OFFICE_STYLE])("persists current banded $id definitions", style=>{
  expect(validateBuildingStyle(style)).toEqual(style);
  const doc=createDocument([[0,0,0]],42,"office",style);
  expect(loadDocument(exportDocument(doc)).buildingDefinition).toEqual(style);
});
it("rejects missing formats, fixed levels, mismatched periods and incomplete connected groups",()=>{
  for(const mutate of [
    (s:any)=>delete s.format,(s:any)=>s.levels=[],(s:any)=>s.bandPolicy={maxBaseCells:1},
    (s:any)=>s.alignedFamilies[0].periodCells=2,(s:any)=>s.patterns[0].repeat=['base-left','base-pier'],
    (s:any)=>s.bands.base.fallback='missing',(s:any)=>s.modules[0].extra=true,
  ]) {const s=structuredClone(SHOP_STYLE);mutate(s);expect(()=>validateBuildingStyle(s)).toThrow();}
});
it("fits only complete connected window groups at an absolute repeat anchor",()=>{
  for(let width=1;width<=16;width++) for(let start=-5;start<=5;start++) {
    const {best}=chooseFacadePattern(SHOP_STYLE,{width,start,anchor:0,direction:'PZ',kind:'side',level:{role:'body',patterns:['body-rhythm'],moduleSet:SHOP_STYLE.bands.body.moduleSet,align:'absolute'}});
    if(!best) continue;
    expect(best.tokens).toHaveLength(width);
    best.tokens.forEach((token,i)=>{if(token==='body-left') {expect(best.tokens[i+1]).toBe('body-right');expect(((start+i)%3+3)%3).toBe(0);} if(token==='body-right') expect(best.tokens[i-1]).toBe('body-left');});
  }
});
