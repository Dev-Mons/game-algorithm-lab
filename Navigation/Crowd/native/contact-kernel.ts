// Allocation-free f64 kernel. The TypeScript adapter owns all memory and static
// geometry; iteration order and arithmetic mirror ExternalContactSolver.
@external('env', 'separated')
declare function separated(a:i32,b:i32):i32;
@external('env', 'correctPair')
declare function correctPair(a:i32,b:i32,dx:f64,dy:f64,d:f64,correction:f64):void;
let table:usize=0;
let constraints:i32=0;
let energyDamped:i32=0;
let deferPositions:bool=false;
export function setDeferredPositions(value:i32):void {deferPositions=value!=0;}
export function address(column:i32):usize {return ptr(column);}
export function resetVelocityCounters():void {constraints=0;energyDamped=0;}
export function energyDampedContacts():i32 { return energyDamped; }
let candidateVisits:i32=0,overflowQueries:i32=0,cellVisits:i32=0,maximumNeighbors:i32=0;
let ownershipSkips:i32=0;
export function pairOwnershipSkips():i32 { return ownershipSkips; }
@inline function imax(a:i32,b:i32):i32 { return a>b?a:b; }
@inline function imin(a:i32,b:i32):i32 { return a<b?a:b; }
export function pairCandidates():i32 { return candidateVisits; }
export function pairFallbacks():i32 { return overflowQueries; }
export function pairCells():i32 { return cellVisits; }
export function pairMaximum():i32 { return maximumNeighbors; }
export function configure(pointer:usize):void { table=pointer; }
@inline function ptr(column:i32):usize { return <usize>load<u32>(table+(<usize>column<<2)); }
@inline function get(column:i32,index:i32):f64 { return load<f64>(ptr(column)+(<usize>index<<3)); }
@inline function read(base:usize,index:i32):f64 { return load<f64>(base+(<usize>index<<3)); }
@inline function write(base:usize,index:i32,value:f64):void { store<f64>(base+(<usize>index<<3),value); }
@inline function put(column:i32,index:i32,value:f64):void { store<f64>(ptr(column)+(<usize>index<<3),value); }
@inline function flag(column:i32,index:i32):i32 { return load<i8>(ptr(column)+<usize>index); }
@inline function setFlag(column:i32,index:i32,value:i32):void { store<i8>(ptr(column)+<usize>index,<i8>value); }
@inline function id(column:i32,index:i32):i32 { return load<i32>(ptr(column)+(<usize>index<<2)); }
@inline function inside(fx:usize,fy:usize,fr:usize,a:i32,x:f64,y:f64):bool {
  const r=read(fr,a),dx=x-read(fx,a),dy=y-read(fy,a);
  return r>0&&dx*dx+dy*dy<r*r;
}
export function constraintCount():i32 { return constraints; }

// Keep SpatialHash's exact center-first traversal and descending-ID cell order.
// A capacity miss returns -1 before any simulation state is modified; the host
// grows the pair storage and retries the complete query instead of dropping IDs.
export function buildPairs(agents:i32,capacity:i32,columns:i32,rows:i32,cellSize:f64,maximumRadius:f64,gap:f64,padding:f64):i32 {
  memory.copy(ptr(27),ptr(0),<usize>agents<<3);memory.copy(ptr(28),ptr(1),<usize>agents<<3);
  return buildPairsRange(0,agents,capacity,columns,rows,cellSize,maximumRadius,gap,padding,ptr(11),ptr(12));
}
export function buildPairsRange(begin:i32,endAgent:i32,capacity:i32,columns:i32,rows:i32,cellSize:f64,maximumRadius:f64,gap:f64,padding:f64,outA:usize,outB:usize):i32 {
  candidateVisits=0;overflowQueries=0;cellVisits=0;maximumNeighbors=0;ownershipSkips=0;
  const x=ptr(0),y=ptr(1),radii=ptr(4),active=ptr(24),starts=ptr(25),indices=ptr(26);
  let pairs:i32=0;
  for(let a:i32=begin;a<endAgent;a++) {
    if(load<u8>(active+<usize>a)==0)continue;
    const ax=read(x,a),ay=read(y,a),ar=read(radii,a),range=ar+maximumRadius+gap+padding;
    const minColumn=imax(0,<i32>Math.floor((ax-range)/cellSize)),maxColumn=imin(columns-1,<i32>Math.floor((ax+range)/cellSize));
    const minRow=imax(0,<i32>Math.floor((ay-range)/cellSize)),maxRow=imin(rows-1,<i32>Math.floor((ay+range)/cellSize));
    const centerColumn=imax(minColumn,imin(maxColumn,<i32>Math.floor(ax/cellSize)));
    const centerRow=imax(minRow,imin(maxRow,<i32>Math.floor(ay/cellSize)));
    const rings=imax(imax(centerColumn-minColumn,maxColumn-centerColumn),imax(centerRow-minRow,maxRow-centerRow));
    cellVisits+=imax(0,maxColumn-minColumn+1)*imax(0,maxRow-minRow+1);
    let candidates:i32=0,owned:i32=0;
    for(let ring:i32=0;ring<=rings;ring++) {
      const left=centerColumn-ring,right=centerColumn+ring,top=centerRow-ring,bottom=centerRow+ring;
      // Two horizontal edges, then paired left/right cells down the vertical
      // edges. This order is part of the sequential contact solver contract.
      for(let edge:i32=0;edge<2;edge++) {
        const row=edge==0?top:bottom;
        if(edge==0?row<minRow:(row==top||row>maxRow))continue;
        for(let column=imax(left,minColumn);column<=imin(right,maxColumn);column++) {
          const cell=row*columns+column,end=load<i32>(starts+(<usize>(cell+1)<<2));
          const start=load<i32>(starts+(<usize>cell<<2));candidates+=end-start;
          for(let slot=start;slot<end;slot++) {
            const b=load<i32>(indices+(<usize>slot<<2));
            if(b<=a){ownershipSkips+=end-slot;break;}
            const dx=read(x,b)-ax,dy=read(y,b)-ay,r=ar+read(radii,b)+gap+padding;
            if(dx*dx+dy*dy>r*r)continue;
            if(pairs==capacity)return -1;
            store<i32>(outA+(<usize>pairs<<2),a);store<i32>(outB+(<usize>pairs<<2),b);pairs++;owned++;
          }
        }
      }
      for(let row=imax(top+1,minRow);row<=imin(bottom-1,maxRow);row++) {
        for(let edge:i32=0;edge<2;edge++) {
          const column=edge==0?left:right;
          if(edge==0?column<minColumn:(column==left||column>maxColumn))continue;
          const cell=row*columns+column,end=load<i32>(starts+(<usize>(cell+1)<<2));
          const start=load<i32>(starts+(<usize>cell<<2));candidates+=end-start;
          for(let slot=start;slot<end;slot++) {
            const b=load<i32>(indices+(<usize>slot<<2));
            if(b<=a){ownershipSkips+=end-slot;break;}
            const dx=read(x,b)-ax,dy=read(y,b)-ay,r=ar+read(radii,b)+gap+padding;
            if(dx*dx+dy*dy>r*r)continue;
            if(pairs==capacity)return -1;
            store<i32>(outA+(<usize>pairs<<2),a);store<i32>(outB+(<usize>pairs<<2),b);pairs++;owned++;
          }
        }
      }
    }
    candidateVisits+=candidates;if(candidates>=65)overflowQueries++;
    maximumNeighbors=imax(maximumNeighbors,owned);
  }
  return pairs;
}
export function maximumDisplacement(agents:i32):f64 {
  const x=ptr(0),y=ptr(1),ax=ptr(27),ay=ptr(28),active=ptr(24);
  let squared:f64=0;
  for(let a:i32=0;a<agents;a++)if(load<u8>(active+<usize>a)!=0) {
    const dx=read(x,a)-read(ax,a),dy=read(y,a)-read(ay,a);
    squared=Math.max(squared,dx*dx+dy*dy);
  }
  return Math.sqrt(squared);
}
export function hasCompression(pairs:i32,tolerance:f64):i32 {
  const x=ptr(0),y=ptr(1),radii=ptr(4),a=ptr(11),b=ptr(12);
  for(let pair:i32=0;pair<pairs;pair++) {
    const ia=load<i32>(a+(<usize>pair<<2)),ib=load<i32>(b+(<usize>pair<<2));
    const r=read(radii,ia)+read(radii,ib)-tolerance,dx=read(x,ia)-read(x,ib),dy=read(y,ia)-read(y,ib);
    if(dx*dx+dy*dy<r*r)return 1;
  }
  return 0;
}
export function classifyGeometry(pairs:i32,gap:f64):i32 {
  const x=ptr(0),y=ptr(1),radii=ptr(4),fx=ptr(5),fy=ptr(6),fr=ptr(7),a=ptr(11),b=ptr(12);
  const dxOut=ptr(13),dyOut=ptr(14),radiusOut=ptr(15),nxOut=ptr(16),nyOut=ptr(17),kind=ptr(20);
  let touching:i32=0;
  for(let pair:i32=0;pair<pairs;pair++) {
    const ia=load<i32>(a+(<usize>pair<<2)),ib=load<i32>(b+(<usize>pair<<2));
    const ax=read(x,ia),ay=read(y,ia),bx=read(x,ib),by=read(y,ib),dx=bx-ax,dy=by-ay,radius=read(radii,ia)+read(radii,ib)+gap;
    write(dxOut,pair,dx);write(dyOut,pair,dy);write(radiusOut,pair,radius);store<i8>(kind+<usize>pair,0);
    const d2=dx*dx+dy*dy;
    if(d2>radius*radius+1e-6)continue;
    if(!(inside(fx,fy,fr,ia,ax,ay)&&inside(fx,fy,fr,ia,bx,by))&&separated(ia,ib)!=0){store<i8>(kind+<usize>pair,-1);continue;}
    touching++;
    const d=Math.sqrt(d2);
    // Degenerate normals use the host's exact sin/cos implementation.
    if(d<=1e-9){store<i8>(kind+<usize>pair,3);continue;}
    store<i8>(kind+<usize>pair,1);write(nxOut,pair,dx/d);write(nyOut,pair,dy/d);
  }
  return touching;
}
// Only the current conservative swept workset can be visited by workers.
// Resolve its still-lazy static tests on the host; frontier expansion calls
// this again before newly admitted pairs can run on another thread.
export function classifyVelocityWorkset(count:i32):void {
  const x=ptr(0),y=ptr(1),fx=ptr(5),fy=ptr(6),fr=ptr(7),a=ptr(11),b=ptr(12),kind=ptr(20),work=ptr(21);
  for(let slot:i32=0;slot<count;slot++) {
    const pair=load<i32>(work+(<usize>slot<<2));if(load<i8>(kind+<usize>pair)!=0)continue;
    const ia=load<i32>(a+(<usize>pair<<2)),ib=load<i32>(b+(<usize>pair<<2));
    const ax=read(x,ia),ay=read(y,ia),bx=read(x,ib),by=read(y,ib);
    const blocked=!(inside(fx,fy,fr,ia,ax,ay)&&inside(fx,fy,fr,ia,bx,by))&&separated(ia,ib)!=0;
    store<i8>(kind+<usize>pair,blocked?-1:2);
  }
}
export function buildWorkset(pairs:i32,agents:i32,dt:f64,halo:f64):i32 {
  memory.copy(ptr(22),ptr(2),<usize>agents<<3);memory.copy(ptr(23),ptr(3),<usize>agents<<3);
  return buildWorksetRange(0,pairs,dt,halo,ptr(21));
}
export function buildWorksetRange(begin:i32,end:i32,dt:f64,halo:f64,output:usize):i32 {
  const vx=ptr(2),vy=ptr(3),a=ptr(11),b=ptr(12),dx=ptr(13),dy=ptr(14),radius=ptr(15);
  let count:i32=0;
  for(let pair:i32=begin;pair<end;pair++) {
    const ia=load<i32>(a+(<usize>pair<<2)),ib=load<i32>(b+(<usize>pair<<2));
    const px=read(dx,pair),py=read(dy,pair),rx=read(vx,ib)-read(vx,ia),ry=read(vy,ib)-read(vy,ia);
    const v2=rx*rx+ry*ry,t=v2>1e-12?Math.max(0,Math.min(dt,-(px*rx+py*ry)/v2)):0;
    const x=px+rx*t,y=py+ry*t,r=read(radius,pair)+halo+1e-6;
    if(x*x+y*y<=r*r){store<i32>(output+(<usize>count<<2),pair);count++;}
  }
  return count;
}
export function validWorkset(agents:i32,limitSquared:f64):i32 {
  const vx=ptr(2),vy=ptr(3),x=ptr(22),y=ptr(23);
  for(let a:i32=0;a<agents;a++) {
    const dx=read(vx,a)-read(x,a),dy=read(vy,a)-read(y,a);
    if(dx*dx+dy*dy>=limitSquared)return 0;
  }
  return 1;
}
export function velocity(count:i32,dt:f64,friction:f64,motorSquared:f64):f64 {
  resetVelocityCounters();return velocityRange(0,count,1,dt,friction,motorSquared);
}
export function velocityRange(start:i32,end:i32,stride:i32,dt:f64,friction:f64,motorSquared:f64):f64 {
  const p2=ptr(2);const p3=ptr(3);const p8=ptr(8);const p10=ptr(10);const p11=ptr(11);const p12=ptr(12);const p13=ptr(13);const p14=ptr(14);const p15=ptr(15);const p16=ptr(16);const p17=ptr(17);const p18=ptr(18);const p19=ptr(19);const p20=ptr(20);const p21=ptr(21);

  let maximum:f64=0;
  for(let slot:i32=start;slot<end;slot+=stride) {
    const pair=load<i32>(p21+(<usize>slot<<2)),kind=load<i8>(p20+<usize>pair);
    if(kind<0)continue;
    const a=load<i32>(p11+(<usize>pair<<2)),b=load<i32>(p12+(<usize>pair<<2)),rvx=read(p2,b)-read(p2,a),rvy=read(p3,b)-read(p3,a);
    let nx:f64=0,ny:f64=0;
    if(kind==1){nx=read(p16,pair);ny=read(p17,pair);}
    else {
      const dx=read(p13,pair),dy=read(p14,pair),radius=read(p15,pair);
      const c=dx*dx+dy*dy-radius*radius,dot=dx*rvx+dy*rvy;
      if(dot>=0||c+2*dot*dt>0)continue;
      const v2=rvx*rvx+rvy*rvy,discriminant=dot*dot-v2*c;
      if(v2<1e-12||discriminant<0)continue;
      const time=(-dot-Math.sqrt(discriminant))/v2;
      if(time<0||time>dt)continue;
      const x=dx+rvx*time,y=dy+rvy*time,d=Math.sqrt(x*x+y*y);
      nx=x/d;ny=y/d;
      if(kind==0) {
        if(separated(a,b)!=0){store<i8>(p20+<usize>pair,<i8>(-1));continue;}
        store<i8>(p20+<usize>pair,<i8>(2));
      }
    }
    constraints++;
    const closing=rvx*nx+rvy*ny,oldNormal=kind==1?read(p18,pair):0;
    if(closing>=0&&(kind!=1||oldNormal==0))continue;
    let normal=Math.max(0,oldNormal-closing*.5),impulse=normal-oldNormal;
    const tx=-ny,ty=nx;
    const oldTangent=kind==1?read(p19,pair):0;
    let newTangent=Math.max(-normal*friction,Math.min(normal*friction,oldTangent+(rvx*tx+rvy*ty)*.5));
    let tangent=newTangent-oldTangent;
    if(kind==1&&impulse<0&&Math.abs(oldTangent)>normal*friction) {
      const work=impulse*closing-tangent*(rvx*tx+rvy*ty),length=impulse*impulse+tangent*tangent;
      if(work+length>0&&length>0) {
        const scale=work<0?Math.min(1,-work/(2*length)):0;
        impulse*=scale;tangent*=scale;normal=oldNormal+impulse;newTangent=oldTangent+tangent;energyDamped++;
      }
    }
    const squared=impulse*impulse+tangent*tangent;
    maximum=Math.max(maximum,squared);
    if(kind==1){write(p18,pair,normal);write(p19,pair,newTangent);}
    if(impulse==0&&tangent==0)continue;
    store<i8>(p8+<usize>a,<i8>(1));store<i8>(p8+<usize>b,<i8>(1));
    write(p2,a,read(p2,a)-impulse*nx+tangent*tx);write(p3,a,read(p3,a)-impulse*ny+tangent*ty);
    write(p2,b,read(p2,b)+impulse*nx-tangent*tx);write(p3,b,read(p3,b)+impulse*ny-tangent*ty);
    if((load<i8>(p10+<usize>a)!=0||load<i8>(p10+<usize>b)!=0)&&squared>motorSquared){store<i8>(p10+<usize>a,<i8>(1));store<i8>(p10+<usize>b,<i8>(1));}
  }
  return maximum;
}
export function position(count:i32,gap:f64,minimumRadius:f64):void {
  positionRange(0,count,1,gap,minimumRadius);
}
@inline function correctPositionPair(pair:i32,a:i32,b:i32,dx:f64,dy:f64,d:f64,correction:f64):void {
  if(deferPositions)store<i8>(ptr(32)+<usize>pair,1);
  else correctPair(a,b,dx,dy,d,correction);
}
export function positionRange(start:i32,end:i32,stride:i32,gap:f64,minimumRadius:f64):void {
  const p0=ptr(0);const p1=ptr(1);const p4=ptr(4);const p5=ptr(5);const p6=ptr(6);const p7=ptr(7);const p8=ptr(8);const p9=ptr(9);const p11=ptr(11);const p12=ptr(12);

  for(let pair:i32=start;pair<end;pair+=stride) {
    const a=load<i32>(p11+(<usize>pair<<2)),b=load<i32>(p12+(<usize>pair<<2)),ax=read(p0,a),ay=read(p1,a),bx=read(p0,b),by=read(p1,b);
    const dx=bx-ax,dy=by-ay,radius=read(p4,a)+read(p4,b)+gap,d2=dx*dx+dy*dy;
    if(d2>=(radius-.001)*(radius-.001))continue;
    const d=Math.sqrt(d2),correction=Math.min((radius-d)*.5,minimumRadius*.125);
    if(d<=1e-9){correctPositionPair(pair,a,b,dx,dy,d,correction);continue;}
    const nx=dx/d,ny=dy/d,mx=nx*correction,my=ny*correction;
    if(!inside(p5,p6,p7,a,ax,ay)||!inside(p5,p6,p7,a,bx,by)||!inside(p5,p6,p7,a,ax-mx,ay-my)||!inside(p5,p6,p7,b,bx,by)||!inside(p5,p6,p7,b,bx+mx,by+my)) {
      correctPositionPair(pair,a,b,dx,dy,d,correction);continue;
    }
    write(p0,a,ax-mx);write(p1,a,ay-my);write(p0,b,bx+mx);write(p1,b,by+my);
    store<i8>(p8+<usize>a,<i8>(1));store<i8>(p8+<usize>b,<i8>(1));
    const length=Math.sqrt(mx*mx+my*my);
    write(p9,a,read(p9,a)+length);write(p9,b,read(p9,b)+length);
  }
}

/** Stable greedy matching order; exact counterpart of ContactColoring. The
 * existing pair-query scratch and velocity-start prefix are idle in this phase. */
export function colorPairs(pairs:i32,agents:i32):i32 {
  const a=ptr(11),b=ptr(12),starts=ptr(29),cursor=ptr(33),outA=ptr(34),outB=ptr(35),masks=ptr(36),colors=ptr(37);
  memory.fill(masks,0,<usize>agents<<3);memory.fill(starts,0,260);let groups:i32=0;
  for(let pair:i32=0;pair<pairs;pair++) {
    const x=masks+(<usize>load<i32>(a+(<usize>pair<<2))<<3),y=masks+(<usize>load<i32>(b+(<usize>pair<<2))<<3);
    let available=~(load<i32>(x)|load<i32>(y)),word:i32=0;
    if(available==0){word=1;available=~(load<i32>(x+4)|load<i32>(y+4));}
    if(available==0){memory.fill(starts,0,260);return 0;}
    const bit=available&-available,color=word*32+31-clz<i32>(bit),offset=<usize>word<<2;
    store<i32>(x+offset,load<i32>(x+offset)|bit);store<i32>(y+offset,load<i32>(y+offset)|bit);
    store<u8>(colors+<usize>pair,<u8>color);
    const count=starts+(<usize>(color+1)<<2);store<i32>(count,load<i32>(count)+1);groups=imax(groups,color+1);
  }
  for(let color:i32=0;color<groups;color++) {
    const at=starts+(<usize>color<<2);store<i32>(at+4,load<i32>(at+4)+load<i32>(at));
  }
  memory.copy(cursor,starts,256);
  for(let pair:i32=0;pair<pairs;pair++) {
    const color=<i32>load<u8>(colors+<usize>pair),at=cursor+(<usize>color<<2),slot=load<i32>(at);store<i32>(at,slot+1);
    store<i32>(outA+(<usize>slot<<2),load<i32>(a+(<usize>pair<<2)));
    store<i32>(outB+(<usize>slot<<2),load<i32>(b+(<usize>pair<<2)));
  }
  memory.copy(a,outA,<usize>pairs<<2);memory.copy(b,outB,<usize>pairs<<2);return groups;
}

export function warm(pairs:i32,agents:i32,dt:f64,friction:f64,keys:usize,values:usize,used:usize,mask:i32,oldKeys:usize,oldValues:usize,oldMask:i32):i32 {
  const a=ptr(11),b=ptr(12),nxIn=ptr(16),nyIn=ptr(17),kind=ptr(20),contacts=ptr(38),vx=ptr(2),vy=ptr(3),corrected=ptr(8);
  memory.fill(contacts,255,<usize>pairs<<2);
  let count:i32=0;
  for(let pair:i32=0;pair<pairs;pair++) {
    const type=load<i8>(kind+<usize>pair);if(type!=1&&type!=3)continue;
    store<i8>(kind+<usize>pair,1);
    const ia=load<i32>(a+(<usize>pair<<2)),ib=load<i32>(b+(<usize>pair<<2)),nx=read(nxIn,pair),ny=read(nyIn,pair);
    const encoded=<f64>ia*<f64>agents+<f64>ib+1;
    const hash=<i32>(<u32><u64>encoded*<u32>2654435761);
    let old:i32=-1,slot=hash&oldMask;
    while(read(oldKeys,slot)!=0) {
      if(read(oldKeys,slot)==encoded){old=slot*5;break;}
      slot=(slot+1)&oldMask;
    }
    slot=hash&mask;
    while(read(keys,slot)!=0)slot=(slot+1)&mask;
    write(keys,slot,encoded);store<i32>(used+(<usize>count<<2),slot);count++;
    const base=slot*5;
    const cosine=old>=0?read(oldValues,old+2)*nx+read(oldValues,old+3)*ny:0;
    const sine=old>=0?read(oldValues,old+2)*ny-read(oldValues,old+3)*nx:0;
    const scale=old>=0&&cosine>.95?dt/read(oldValues,old+4):0;
    const normal=old>=0?Math.max(0,(read(oldValues,old)*cosine-read(oldValues,old+1)*sine)*scale):0;
    const rawTangent=old>=0?(read(oldValues,old)*sine+read(oldValues,old+1)*cosine)*scale:0;
    const tangent=Math.max(-friction*normal,Math.min(friction*normal,rawTangent));
    write(values,base,normal);write(values,base+1,tangent);write(values,base+2,nx);write(values,base+3,ny);write(values,base+4,dt);
    store<i32>(contacts+(<usize>pair<<2),base);
    if(normal==0&&tangent==0)continue;
    store<i8>(corrected+<usize>ia,1);store<i8>(corrected+<usize>ib,1);
    const ix=-normal*nx-tangent*ny,iy=-normal*ny+tangent*nx;
    write(vx,ia,read(vx,ia)+ix);write(vy,ia,read(vy,ia)+iy);write(vx,ib,read(vx,ib)-ix);write(vy,ib,read(vy,ib)-iy);
  }
  return count;
}
