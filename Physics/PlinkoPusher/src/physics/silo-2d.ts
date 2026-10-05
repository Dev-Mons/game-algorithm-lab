/** Lightweight circle packing in a single x/y plane. No renderer or economic ownership. */
export interface SiloSpec {
  width: number; bottom: number; top: number; throatY: number;
  outletHalfWidth: number; radius: number; displayCapacity: number;
  /** Optional narrow inlet and size variation for loose processed scrap. */
  inletWidth?: number; radiusVariation?: number; gravity?: number;
}
export interface SiloBody { id: number; x: number; y: number; vx: number; vy: number; radius: number; angle: number; inOutlet?: boolean }

export class Silo2D {
  readonly bodies: SiloBody[] = [];
  time = 0;
  released = 0;
  lastReleaseAt = -Infinity;
  lastExit: { x: number; y: number } | null = null;
  private target = 0;
  private stock = 0;
  private nextId = 1;
  private cursor = 0;
  gateOpen = false;
  intakeOpen = true;
  admissionLimit = Infinity;
  private readonly cell: number;
  private readonly originY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private readonly next: Int32Array;
  private readonly oldX: Float64Array;
  private readonly oldY: Float64Array;

  constructor(readonly spec: SiloSpec) {
    this.cell = spec.radius * Math.max(2.15,2.05*(1+(spec.radiusVariation??.04)));
    this.originY=spec.throatY-.7;
    this.cols = Math.ceil(spec.width / this.cell) + 2;
    this.rows = Math.ceil((spec.top - this.originY) / this.cell) + 3;
    this.heads = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(spec.displayCapacity);
    this.oldX = new Float64Array(spec.displayCapacity); this.oldY = new Float64Array(spec.displayCapacity);
  }
  get pending() { return Math.max(0, this.stock - this.bodies.length); }
  /** Bulk reconciliation is only needed at initialization or after offscreen approximation. */
  syncStock(count: number, preload = false) {
    this.stock = Math.max(0, Math.floor(count)); this.target = Math.min(this.stock, this.spec.displayCapacity);
    if (this.bodies.length > this.target) {
      this.bodies.sort((a,b)=>b.y-a.y); this.bodies.length = this.target;
    }
    if (!preload) return;
    const s=this.spec, pitch=s.radius*2.05*(1+(s.radiusVariation??.04)), cols=Math.floor((s.width-.4)/pitch), dy=pitch*Math.sqrt(3)/2;
    for(let row=0; row<200 && this.bodies.length<this.target;row++) {
      const y=s.throatY+s.radius*1.05+row*dy; if(y>s.top-s.radius*1.1)break;
      const xs=Array.from({length:cols},(_,i)=>(i-(cols-1)/2)*pitch+(row%2?pitch*.5:0)).sort((a,b)=>Math.abs(a)-Math.abs(b));
      for(const x of xs) {
        if(this.bodies.length>=this.target)break;
        const radius=this.radiusFor(this.nextId);
        if(Math.abs(x)+radius>s.width/2-.18 || y<this.floorY(x,radius))continue;
        this.bodies.push(this.makeBody(x,y));
      }
    }
  }
  private radiusFor(id: number) { const v=this.spec.radiusVariation??.04; return this.spec.radius*(1-v+(id%5)*v*.5); }
  private makeBody(x:number,y:number): SiloBody {
    const id=this.nextId++;
    return {id,x,y,vx:0,vy:0,radius:this.radiusFor(id),angle:id*2.399};
  }
  private floorY(x:number,r:number) {
    const s=this.spec, slope=(s.bottom-s.throatY)/(s.width/2-s.outletHalfWidth);
    return s.throatY + Math.max(0,Math.abs(x)-s.outletHalfWidth)*slope + r*Math.sqrt(1+slope*slope);
  }
  private admit() {
    if (!this.intakeOpen) return;
    const s=this.spec,pitch=s.radius*2.2*(1+(s.radiusVariation??0)),cols=Math.max(1,Math.floor(((s.inletWidth??s.width)-.5)/pitch)),y=s.top-s.radius*(1+(s.radiusVariation??.04))-.04;
    for(let attempt=0,added=0;attempt<cols && added<8 && this.bodies.length<Math.min(this.target,this.admissionLimit);attempt++) {
      const x=((this.cursor++%cols)-(cols-1)/2)*pitch,r=this.radiusFor(this.nextId);
      if(this.bodies.some(b=>Math.hypot(b.x-x,b.y-y)<b.radius+r+.015))continue;
      this.bodies.push(this.makeBody(x,y));added++;
    }
  }
  private boundaries(b:SiloBody) {
    const s=this.spec,limit=s.width/2-.18-b.radius;
    b.x=Math.max(-limit,Math.min(limit,b.x)); b.y=Math.min(s.top-b.radius-.04,b.y);
    const slope=(s.bottom-s.throatY)/(s.width/2-s.outletHalfWidth),len=Math.sqrt(1+slope*slope);
    if(Math.abs(b.x)>s.outletHalfWidth) {
      const sign=Math.sign(b.x),distance=(b.y-s.throatY-(Math.abs(b.x)-s.outletHalfWidth)*slope)/len;
      if(distance<b.radius) {const push=b.radius-distance;b.x-=sign*slope/len*push;b.y+=push/len;}
    }
    if (this.gateOpen || b.inOutlet) {
      // Rounded ends of the open throat push a straddling circle into the opening.
      for (const sign of [-1,1]) {
        const dx=b.x-sign*s.outletHalfWidth,dy=b.y-s.throatY,length=Math.hypot(dx,dy);
        if(length<b.radius && length>1e-8){const push=b.radius-length;b.x+=dx/length*push;b.y+=dy/length*push;}
      }
      // The rotary feeder pocket supports the unit below the shutter until the core accepts it.
      if(b.y-b.radius<s.throatY-.015)b.inOutlet=true;
      if(b.y<s.throatY)b.x=Math.max(-s.outletHalfWidth+b.radius,Math.min(s.outletHalfWidth-b.radius,b.x));
      b.y=Math.max(s.throatY-.65+b.radius,b.y);
    } else b.y=Math.max(s.throatY+b.radius,b.y);
  }
  private grid() {
    this.heads.fill(-1);
    for(let i=0;i<this.bodies.length;i++) {
      const b=this.bodies[i],x=Math.max(0,Math.min(this.cols-1,Math.floor((b.x+this.spec.width/2)/this.cell))),y=Math.max(0,Math.min(this.rows-1,Math.floor((b.y-this.originY)/this.cell)));
      const cell=y*this.cols+x;this.next[i]=this.heads[cell];this.heads[cell]=i;
    }
  }
  step(dt:number) {
    this.time+=dt;const h=dt/2;
    for(let sub=0;sub<2;sub++) {
      this.admit();
      for(let i=0;i<this.bodies.length;i++) {
        const b=this.bodies[i];this.oldX[i]=b.x;this.oldY[i]=b.y;
        b.vx*=Math.exp(-.8*h);b.vy=Math.max(-8,b.vy-(this.spec.gravity??18)*h);b.x+=b.vx*h;b.y+=b.vy*h;
      }
      for(let pass=0;pass<5;pass++) {
        this.grid();
        for(let i=0;i<this.bodies.length;i++) {
          const a=this.bodies[i],cx=Math.floor((a.x+this.spec.width/2)/this.cell),cy=Math.floor((a.y-this.originY)/this.cell);
          for(let y=Math.max(0,cy-1);y<=Math.min(this.rows-1,cy+1);y++)for(let x=Math.max(0,cx-1);x<=Math.min(this.cols-1,cx+1);x++) {
            for(let j=this.heads[y*this.cols+x];j>=0;j=this.next[j]) {
              if(j<=i)continue;const b=this.bodies[j],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),min=a.radius+b.radius;
              if(length>=min)continue;
              const nx=length>1e-7?dx/length:1,ny=length>1e-7?dy/length:0,push=Math.min((min-length)*.5,Math.min(a.radius,b.radius)*.45);
              a.x-=nx*push;a.y-=ny*push;b.x+=nx*push;b.y+=ny*push;
            }
          }
        }
        for(const b of this.bodies)this.boundaries(b);
      }
      for(let i=0;i<this.bodies.length;i++) {
        const b=this.bodies[i];b.vx=Math.max(-5,Math.min(5,(b.x-this.oldX[i])/h))*.98;b.vy=Math.max(-8,Math.min(4,(b.y-this.oldY[i])/h))*.98;
        b.angle+=b.vx*h/Math.max(.05,b.radius)*.55;
      }
    }
  }
  /** Open the throat, then take one unit from the supported pocket below the shutter. */
  takeAtOutlet(): boolean {
    const s=this.spec;let index=-1,lowest=Infinity;
    for(let i=0;i<this.bodies.length;i++) {
      const b=this.bodies[i];
      if(b.y+b.radius>s.throatY+.025)continue;
      if(b.y<lowest){lowest=b.y;index=i;}
    }
    if(index<0){this.gateOpen=true;return false;}
    return this.releaseBody(index);
  }
  /** Transfer only after a body has reached a connected, fully occluded receiving area. */
  protected releaseBody(index:number): boolean {
    this.lastExit={x:this.bodies[index].x,y:this.bodies[index].y};
    this.bodies.splice(index,1);this.gateOpen=false;
    this.target=Math.max(0,this.target-1);this.stock=Math.max(0,this.stock-1);
    this.released++;this.lastReleaseAt=this.time;return true;
  }
}
