import {exactKeys} from './canonical';

/** Logical floors, not metres. IDs are authored semantics, never inferred land use. */
export interface ProgramSection {
  id:string; scope:'ground'|'repeat'|'upper'; required:boolean;
  min:number; preferred:number; max:number; priority:number; minHeight:number;
}
export interface ArchitecturalProgram {id:string; sections:ProgramSection[]; fallback:string}
export interface ProgramAllocation {sections:{id:string;count:number}[]; reasons:string[]}

export function validatePrograms(programs:ArchitecturalProgram[], roles:string[]) {
  const fail=():never=>{throw new Error('INVALID_ARCHITECTURAL_PROGRAM');};
  if(!Array.isArray(programs)||!programs.length||programs.length>16)fail();
  const ids=new Set<string>();
  for(const p of programs){
    exactKeys(p,['id','sections','fallback']);
    if(!/^[a-zA-Z0-9_.:-]+$/.test(p.id)||ids.has(p.id)||!roles.includes(p.fallback)||!Array.isArray(p.sections)||!p.sections.length||p.sections.length>16)fail();
    ids.add(p.id);const sections=new Set<string>();
    for(const s of p.sections){
      exactKeys(s,['id','scope','required','min','preferred','max','priority','minHeight']);
      if(!roles.includes(s.id)||sections.has(s.id)||!['ground','repeat','upper'].includes(s.scope)||typeof s.required!=='boolean'||![s.min,s.preferred,s.max,s.minHeight,s.priority].every(Number.isSafeInteger)||s.min<1||s.preferred<s.min||s.max<s.preferred||s.max>32||s.minHeight<1||s.minHeight>32)fail();
      sections.add(s.id);
    }
    if(p.sections.filter(s=>s.scope==='repeat').length!==1||p.sections.find(s=>s.scope==='repeat')!.max!==32)fail();
    if(p.sections.some((s,i)=>s.scope==='ground'&&p.sections.slice(0,i).some(t=>t.scope!=='ground')))fail();
    if(p.sections.some((s,i)=>s.scope==='repeat'&&p.sections.slice(0,i).some(t=>t.scope==='upper')))fail();
  }
}

/** Required minima → optional minima → preferred heights → repeating remainder.
 * A failed minimum uses the explicit one-section fallback; never partial sections. */
export function allocateProgram(height:number, program:ArchitecturalProgram, ground=true):ProgramAllocation {
  if(!Number.isInteger(height)||height<0||height>32)throw new Error('INVALID_PROGRAM_HEIGHT');
  if(!height)return {sections:[],reasons:[]};
  const eligible=program.sections.filter(s=>(ground||s.scope!=='ground')&&height>=s.minHeight);
  const required=eligible.filter(s=>s.required), counts=new Map<string,number>();
  if(required.reduce((n,s)=>n+s.min,0)>height||program.sections.some(s=>s.required&&(ground||s.scope!=='ground')&&height<s.minHeight))return {sections:[{id:program.fallback,count:height}],reasons:['PROGRAM_FALLBACK']};
  let left=height;const reasons:string[]=[];
  for(const s of required){counts.set(s.id,s.min);left-=s.min;}
  const order=[...eligible].sort((a,b)=>b.priority-a.priority||program.sections.indexOf(a)-program.sections.indexOf(b));
  for(const s of order)if(!s.required){if(left>=s.min){counts.set(s.id,s.min);left-=s.min;}else reasons.push(`OMITTED:${s.id}`);}
  for(const s of order)if(counts.has(s.id)){const n=Math.min(left,s.preferred-counts.get(s.id)!);counts.set(s.id,counts.get(s.id)!+n);left-=n;}
  const repeat=eligible.find(s=>s.scope==='repeat');
  if(left){if(!repeat)return {sections:[{id:program.fallback,count:height}],reasons:['PROGRAM_FALLBACK']};counts.set(repeat.id,(counts.get(repeat.id)??0)+left);}
  for(const s of program.sections)if(!eligible.includes(s))reasons.push(`INELIGIBLE:${s.id}`);
  return {sections:program.sections.filter(s=>counts.has(s.id)).map(s=>({id:s.id,count:counts.get(s.id)!})),reasons};
}
