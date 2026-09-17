/** Canonical JSON is shared by input validation and deterministic plan signatures. */
export function canonicalJSON(value: unknown): string {
  let requiresLexicalIndexOrder=false;
  const normalize=(v:unknown):unknown=>{
    if(typeof v==='number'&&!Number.isFinite(v))throw new Error('NON_FINITE_NUMBER');
    if(Array.isArray(v))return v.map(normalize);
    if(v&&typeof v==='object'){
      const out:Record<string,unknown>={};
      for(const key of Object.keys(v).sort()){
        // Native JSON orders array-index property names numerically; canonical JSON orders them lexically.
        const index=Number(key);if(Number.isInteger(index)&&index>=0&&index<4294967295&&String(index)===key)requiresLexicalIndexOrder=true;
        const item=normalize((v as Record<string,unknown>)[key]);
        if(key==='__proto__')Object.defineProperty(out,key,{value:item,enumerable:true});else out[key]=item;
      }
      return out;
    }
    return v;
  };
  const normalized=normalize(value);
  if(!requiresLexicalIndexOrder)return JSON.stringify(normalized)+'\n';
  const encode=(v:unknown):string|undefined=>{
    if(Array.isArray(v))return '['+v.map(x=>encode(x)??'null').join(',')+']';
    if(v&&typeof v==='object'){const parts:string[]=[];for(const key of Object.keys(v).sort()){const encoded=encode((v as Record<string,unknown>)[key]);if(encoded!==undefined)parts.push(JSON.stringify(key)+':'+encoded);}return '{'+parts.join(',')+'}';}
    return JSON.stringify(v);
  };
  return encode(normalized)+'\n';
}

export function cloneJSON<T>(value: T): T {
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('NON_FINITE_NUMBER');
  if(Array.isArray(value)){if(value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n)))return [value[0],value[1],value[2]] as T;return value.map(cloneJSON) as T;}
  if(value&&typeof value==='object'){const copy:Record<string,unknown>={};for(const key of Object.keys(value))copy[key]=cloneJSON((value as Record<string,unknown>)[key]);return copy as T;}
  return value;
}
export function exactKeys(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      required.some(k => !Object.hasOwn(value, k)) ||
      Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)))
    throw new Error("INVALID_FIELDS");
}

const immutableNodes=new WeakSet<object>();
/** Freeze an execution-owned JSON graph once; frozen descendants may be shared safely. */
export function immutableJSON<T>(value:T):T {
 if(value&&typeof value==='object'&&!immutableNodes.has(value)){if(Array.isArray(value)){for(const item of value)immutableJSON(item);}else for(const key of Object.keys(value))immutableJSON((value as Record<string,unknown>)[key]);Object.freeze(value);immutableNodes.add(value);}return value;
}

export function isImmutableJSON(value:unknown):value is object{return !!value&&typeof value==='object'&&immutableNodes.has(value);}
