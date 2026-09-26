// Exact f64 particle/grid transfers. Grid projection stays in the JS solver.
@external('env','atan2') declare function atan2(y:f64,x:f64):f64;
@external('env','hypot') declare function hypot(x:f64,y:f64):f64;
let table:usize=0;
export function configure(value:usize):void {table=value;}
@inline function ptr(column:i32):usize{return load<u32>(table+(<usize>column<<2));}
@inline function read(base:usize,i:i32):f64{return load<f64>(base+(<usize>i<<3));}
@inline function write(base:usize,i:i32,value:f64):void{store<f64>(base+(<usize>i<<3),value);}
@inline function clamp(x:f64,lo:f64,hi:f64):f64{return Math.max(lo,Math.min(hi,x));}
@inline function horizontal(i:i32,offset:i32):bool{return offset==0||load<u8>(ptr(11)+<usize>(offset>0?i:i-1))==1;}
@inline function vertical(i:i32,offset:i32,columns:i32):bool{return offset==0||load<u8>(ptr(12)+<usize>(offset>0?i:i-columns))==1;}
const CELLS:usize=1024,WEIGHTS:usize=1088;
function stencil(x:f64,y:f64,columns:i32,rows:i32,h:f64):void {
  const gx=clamp(x/h-.5,0,<f64>(columns-1)),gy=clamp(y/h-.5,0,<f64>(rows-1));
  const cx=<i32>Math.floor(gx),cy=<i32>Math.floor(gy),tx=gx-<f64>cx,ty=gy-<f64>cy;
  const right=cx+1<columns?cx+1:columns-1,down=cy+1<rows?cy+1:rows-1;
  store<i32>(CELLS,cy*columns+cx);store<i32>(CELLS+4,cy*columns+right);
  store<i32>(CELLS+8,down*columns+cx);store<i32>(CELLS+12,down*columns+right);
  write(WEIGHTS,0,(1-tx)*(1-ty));write(WEIGHTS,1,tx*(1-ty));write(WEIGHTS,2,(1-tx)*ty);write(WEIGHTS,3,tx*ty);
  let anchor:i32=0;
  for(let k:i32=0;k<4;k++) {
    if(load<u8>(ptr(10)+<usize>load<i32>(CELLS+(<usize>k<<2)))!=0)write(WEIGHTS,k,0);
    if(read(WEIGHTS,k)>read(WEIGHTS,anchor))anchor=k;
  }
  const origin=load<i32>(CELLS+(<usize>anchor<<2));let total:f64=0;
  for(let k:i32=0;k<4;k++) {
    const target=load<i32>(CELLS+(<usize>k<<2)),dx=target%columns-origin%columns,dy=target/columns-origin/columns;
    const connected=(horizontal(origin,dx)&&vertical(origin+dx,dy,columns))||(vertical(origin,dy,columns)&&horizontal(origin+dy*columns,dx));
    if(!connected)write(WEIGHTS,k,0);total+=read(WEIGHTS,k);
  }
  for(let k:i32=0;k<4;k++)write(WEIGHTS,k,total>1e-9?read(WEIGHTS,k)/total:0);
}
export function scatter(agents:i32,cells:i32,columns:i32,rows:i32,h:f64,weighted:i32,external:i32):void {
  const mass=ptr(0),mx=ptr(1),my=ptr(2),dx=ptr(3),dy=ptr(4);
  for(let column:i32=0;column<5;column++)memory.fill(ptr(column),0,<usize>cells*64);
  for(let a:i32=0;a<agents;a++) {
    if(load<u8>(ptr(21)+<usize>a)!=1)continue;
    stencil(read(ptr(13),a),read(ptr(14),a),columns,rows,h);
    const heading=(atan2(read(ptr(18),a),read(ptr(17),a))/(Math.PI*2)+1)*8;
    const channel=<i32>Math.floor(heading)%8,fraction=heading-Math.floor(heading);
    store<u8>(ptr(26)+<usize>a,<u8>channel);write(ptr(27),a,fraction);
    for(let k:i32=0;k<4;k++) {
      store<i32>(ptr(24)+(<usize>(a*4+k)<<2),load<i32>(CELLS+(<usize>k<<2)));
      write(ptr(25),a*4+k,read(WEIGHTS,k));
    }
    for(let side:i32=0;side<2;side++) {
      const offset=((channel+side)%8)*cells,angular=side==0?1-fraction:fraction;
      for(let corner:i32=0;corner<4;corner++) {
        const weight=read(WEIGHTS,corner)*angular*(weighted!=0?read(ptr(22),a):1);
        const i=load<i32>(CELLS+(<usize>corner<<2))+offset;
        write(mass,i,read(mass,i)+weight);
        write(mx,i,read(mx,i)+(external!=0&&load<u8>(ptr(23)+<usize>a)!=0?read(ptr(19),a):read(ptr(15),a))*weight);
        write(my,i,read(my,i)+(external!=0&&load<u8>(ptr(23)+<usize>a)!=0?read(ptr(20),a):read(ptr(16),a))*weight);
        write(dx,i,read(dx,i)+read(ptr(19),a)*weight);write(dy,i,read(dy,i)+read(ptr(20),a)*weight);
      }
    }
  }
}
export function gather(agents:i32,cells:i32,targetDensity:f64,maximumSpeed:f64):void {
  for(let a:i32=0;a<agents;a++) {
    if(load<u8>(ptr(21)+<usize>a)!=1)continue;
    const channel=<i32>load<u8>(ptr(26)+<usize>a),fraction=read(ptr(27),a);
    let x:f64=0,y:f64=0,weightSum:f64=0,baseX:f64=0,baseY:f64=0,density:f64=0;
    for(let corner:i32=0;corner<4;corner++) {
      const cell=load<i32>(ptr(24)+(<usize>(a*4+corner)<<2)),weight=read(ptr(25),a*4+corner);
      density+=read(ptr(9),cell)*weight;
      for(let side:i32=0;side<2;side++) {
        const i=((channel+side)%8)*cells+cell,w=weight*(side==0?1-fraction:fraction);
        if(read(ptr(0),i)<=1e-9)continue;
        x+=read(ptr(5),i)*w;y+=read(ptr(6),i)*w;
        baseX+=read(ptr(7),i)*w;baseY+=read(ptr(8),i)*w;weightSum+=w;
      }
    }
    const blend=clamp(density/targetDensity,0,1);
    if(weightSum>1e-9) {
      x=x/weightSum+(read(ptr(19),a)-baseX/weightSum)*(1-blend);
      y=y/weightSum+(read(ptr(20),a)-baseY/weightSum)*(1-blend);
    }else{x=read(ptr(19),a);y=read(ptr(20),a);}
    const ix=read(ptr(17),a),iy=read(ptr(18),a),forward=x*ix+y*iy;
    if(forward<0){x-=forward*ix;y-=forward*iy;}
    const scale=Math.min(1,maximumSpeed/Math.max(1e-9,hypot(x,y)));
    write(ptr(19),a,x*scale);write(ptr(20),a,y*scale);
  }
}
