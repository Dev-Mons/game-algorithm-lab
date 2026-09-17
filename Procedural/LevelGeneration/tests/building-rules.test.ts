import {expect,it} from 'vitest';
import {createDocument,setBuildingRule,setBuildingTheme,replaceGrid,exportDocument,loadDocument} from '../src/core/document';
import {registerBuildingRule,ruleReference} from '../src/core/building-rules';
import {PARKING_RULE} from '../src/core/parking-rule';
import {OFFICE_STYLE} from '../src/core/building-style';
import {DocumentHistory} from '../src/editor';
it('registers only contextual standard and keeps rule/theme/design contracts independent',()=>{
  expect(()=>ruleReference('standard')).toThrow(/Unknown/);
  const doc=setBuildingRule(createDocument([[0,0,0]],42,'shop'),'0,0,0','parking',{bayStride:1});
  const themed=setBuildingTheme(doc,'0,0,0',OFFICE_STYLE),edited=replaceGrid(themed,[[0,0,0],[1,0,0]]);
  expect(edited.buildings[0].rule).toEqual(doc.buildings[0].rule);
  expect(edited.buildings[0].spatialAdapterRef).toEqual(doc.buildings[0].spatialAdapterRef);
  expect(edited.buildings[0].design).toEqual(doc.buildings[0].design);
  const history=new DocumentHistory(doc);history.commit(edited);expect(history.undo()).toEqual(doc);expect(history.redo()).toEqual(edited);
  expect(loadDocument(exportDocument(edited))).toEqual(edited);
});
it('rejects missing custom spatial support and altered rule tuples',()=>{
  registerBuildingRule({...PARKING_RULE,id:'without-spatial'});
  const doc=createDocument([[0,0,0]]);
  expect(()=>setBuildingRule(doc,'0,0,0','without-spatial')).toThrow(/RULE_SPATIAL_CONTRACT_REQUIRED/);
  const parking=setBuildingRule(doc,'0,0,0','parking');
  for(const change of [{id:'unknown'},{version:'99.0.0'},{definition:{structure:'different'}},{metadata:{bayStride:0}}]) {
    const bad=structuredClone(parking);Object.assign(bad.buildings[0].rule,change);expect(()=>loadDocument(JSON.stringify(bad))).toThrow();
  }
});
