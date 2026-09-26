/** Stable greedy edge coloring. Each range is a matching: no body is written
 * twice in that range. Overflow retains the complete original pair order. */
export class ContactColoring {
  readonly starts=new Int32Array(65);
  private readonly cursor=new Int32Array(64);
  private masks=new Uint32Array(0);
  private colors=new Uint8Array(0);
  private orderedA=new Int32Array(0);
  private orderedB=new Int32Array(0);
  groups=0;
  get bytes():number {return this.starts.byteLength+this.cursor.byteLength+this.masks.byteLength+this.colors.byteLength+this.orderedA.byteLength+this.orderedB.byteLength;}

  order(a:Int32Array,b:Int32Array,pairs:number,agents:number):number {
    if(this.masks.length<agents*2)this.masks=new Uint32Array(agents*2);
    if(this.colors.length<pairs) {
      const capacity=Math.max(pairs,32,this.colors.length*2);
      this.colors=new Uint8Array(capacity);this.orderedA=new Int32Array(capacity);this.orderedB=new Int32Array(capacity);
    }
    this.masks.fill(0,0,agents*2);this.starts.fill(0);this.groups=0;
    for(let pair=0;pair<pairs;pair++) {
      const x=a[pair]!*2,y=b[pair]!*2;
      let available=~(this.masks[x]!|this.masks[y]!),word=0;
      if(!available){word=1;available=~(this.masks[x+1]!|this.masks[y+1]!);}
      if(!available){this.groups=0;this.starts.fill(0);return 0;}
      const bit=available&-available,color=word*32+31-Math.clz32(bit);
      this.masks[x+word]=this.masks[x+word]!|bit;this.masks[y+word]=this.masks[y+word]!|bit;
      this.colors[pair]=color;this.starts[color+1]=this.starts[color+1]!+1;this.groups=Math.max(this.groups,color+1);
    }
    for(let color=0;color<this.groups;color++)this.starts[color+1]=this.starts[color+1]!+this.starts[color]!;
    this.cursor.set(this.starts.subarray(0,64));
    for(let pair=0;pair<pairs;pair++) {
      const color=this.colors[pair]!,slot=this.cursor[color]!;this.cursor[color]=slot+1;
      this.orderedA[slot]=a[pair]!;this.orderedB[slot]=b[pair]!;
    }
    a.set(this.orderedA.subarray(0,pairs));b.set(this.orderedB.subarray(0,pairs));return this.groups;
  }
}
