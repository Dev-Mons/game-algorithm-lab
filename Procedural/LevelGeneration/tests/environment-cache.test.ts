import {createDocument,replaceGrid} from '../src/core/document';
import {box} from '../src/fixtures';
import {expect,it} from 'vitest';
import {EnvironmentCache} from '../src/core/environment-cache';
import {generateDocument} from '../src/core/generate-document';
import {parkingFixture} from '../src/parking-fixtures';
import {canonicalJSON,immutableJSON} from '../src/core/canonical';
it('keeps complete deterministic plans, proofs, traces and logical budgets identical across cold warm and disabled execution',()=>{
 const doc=parkingFixture('R12'),cache=new EnvironmentCache(),telemetry:any[]=[];
 const disabled=generateDocument(doc,{cache:false}),cold=generateDocument(doc,{cache,telemetry:t=>telemetry.push(t)}),warm=generateDocument(doc,{cache,telemetry:t=>telemetry.push(t)});
 expect(canonicalJSON(warm)).toBe(canonicalJSON(disabled));expect(canonicalJSON(cold)).toBe(canonicalJSON(disabled));
 expect(telemetry[1].actualExpansions).toBe(0);expect(telemetry[1].logicalExpansions).toBe(telemetry[0].logicalExpansions);
 warm.environment!.parking![0].plans[0].stalls.length=0;expect(generateDocument(doc,{cache}).environment!.parking![0].quality.acceptedStalls).toBe(18);
 doc.sceneInputs.roads=[];expect(generateDocument(doc,{cache}).environment!.parking![0].quality.acceptedStalls).toBe(0);
});
it('counts key and result memory, protects stored values, and uses FIFO rather than access order',()=>{
 const c=new EnvironmentCache(2,1000);c.put('a',{value:1});c.put('b',{value:2});const a=c.get<any>('a');a.value=99;c.put('c',{value:3});expect(c.get('a')).toBeUndefined();expect(c.get('b')).toEqual({value:2});
 c.put('huge','x'.repeat(1000));expect(c.get('huge')).toBeUndefined();expect(c.stats().bytes).toBeLessThanOrEqual(1000);
});

it('rebuilds current facade traces and validates preflight on hits, settings changes and geometry edits',()=>{
 const cache=new EnvironmentCache(),doc=createDocument(box(6,8,4),42);
 const compare=(input:typeof doc)=>{const expected=generateDocument(input,{cache:false});expect(generateDocument(input,{cache})).toEqual(expected);const hit=generateDocument(input,{cache});expect(hit).toEqual(expected);expect(hit.environment!.counters.preflightCalls).toBe(1);};
 compare(doc);compare(replaceGrid(doc,doc.grid.filter(c=>c[0]!==0)));const changed=structuredClone(doc);changed.buildings[0].design.use='retail';compare(changed);
 expect(cache.stats().bytes).toBeLessThanOrEqual(16*1024*1024);
});

it('a facility-only edit within the existing spatial domain does not replan upstream parking',()=>{
 const doc=parkingFixture('R12'),cache=new EnvironmentCache();const original=generateDocument(doc,{cache});doc.sceneInputs.objects=[{id:'intention',category:'facility',direction:'PY',cells:[[3,0,3]]}];let actual=-1;
 const edited=generateDocument(doc,{cache,telemetry:t=>actual=t.actualExpansions});expect(actual).toBe(0);expect(edited.environment!.parking).toEqual(original.environment!.parking);expect(edited).toEqual(generateDocument(doc,{cache:false}));
});

it('immutable cache snapshots protect descendants even when a caller has frozen only the outer object',()=>{
 const cache=new EnvironmentCache(),value=Object.freeze({nested:{value:1}});cache.putImmutable('immutable',value);expect(Object.isFrozen(value.nested)).toBe(true);expect(()=>{value.nested.value=2;}).toThrow();expect(cache.get('immutable')).toEqual({nested:{value:1}});
});

it('immutable identity lookups stay inside the same bounded FIFO and never accept a mutable identity',()=>{
 const cache=new EnvironmentCache(1,2000),identity=immutableJSON([1,2,3]);cache.putImmutable('geometry:a',{value:1},identity);expect(cache.getByIdentity('geometry',identity)).toEqual({value:1});expect(cache.getByIdentity('other',identity)).toBeUndefined();expect(cache.getByIdentity('geometry',[1,2,3])).toBeUndefined();
 cache.put('replacement',{value:2});expect(cache.getByIdentity('geometry',identity)).toBeUndefined();expect(()=>cache.put('invalid',{},v=>v,{})).toThrow('MUTABLE_CACHE_IDENTITY');expect(cache.stats().bytes).toBeLessThanOrEqual(2000);
});

it('canonical keys preserve lexical integer names, escaped text, array nulls and hostile property names',()=>{
 const input=JSON.parse('{"2":"two","10":"ten","__proto__":{"x":1},"text":"line\\nquote\\\""}');
 expect(canonicalJSON(input)).toBe('{"10":"ten","2":"two","__proto__":{"x":1},"text":"line\\nquote\\\""}\n');
 expect(canonicalJSON({b:[undefined,2],a:-0})).toBe('{"a":0,"b":[null,2]}\n');
 expect(()=>canonicalJSON({nested:[Infinity]})).toThrow('NON_FINITE_NUMBER');
});
