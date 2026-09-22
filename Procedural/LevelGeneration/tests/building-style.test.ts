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

it('keeps custom multi-candidate fit, priority, ASCII ties and forced-pattern behavior',()=>{
  const style=structuredClone(SHOP_STYLE),body=style.patterns.find(p=>p.id==='body-rhythm')!;
  for(const [id,priority] of [['z-exact',200],['a-exact',200],['low-exact',10]] as const)
    style.patterns.push({...structuredClone(body),id,priority,start:['body-single','body-single']});
  const run={width:8,start:1,anchor:0,direction:'PZ' as const,kind:'side' as const,level:{role:'body',patterns:['body-rhythm','z-exact','a-exact','low-exact'],moduleSet:style.bands.body.moduleSet,align:'absolute'}};
  const selected=chooseFacadePattern(style,run);
  expect(selected.best?.pattern.id).toBe('a-exact');
  expect(selected.best?.tokens).toEqual(['body-single','body-single','body-left','body-right','body-pier','body-left','body-right','body-pier']);
  expect(selected.candidates).toEqual([
    {id:'body-rhythm',filler:2,reason:'integer-remainder:lower-ranked'},
    {id:'z-exact',filler:0,reason:'exact-fit:lower-ranked'},
    {id:'a-exact',filler:0,reason:'exact-fit'},
    {id:'low-exact',filler:0,reason:'exact-fit:lower-ranked'},
  ]);
  expect(chooseFacadePattern(style,run,'low-exact').best?.pattern.id).toBe('low-exact');
  expect(chooseFacadePattern(style,{...run,width:1}).best).toBeUndefined();
  expect(chooseFacadePattern(style,{...run,level:{...run.level,moduleSet:['body-single']}}).candidates.every(c=>c.reason==='module-set-or-direction')).toBe(true);
});
