import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {FIXTURE_CATALOG,type FixturePrototypeId} from './core/fixture-catalog';
/** Authored pieces in sixteenth-cell coordinates. The final prototype is centered and normalized. */
export function buildFixtureGeometry(id:FixturePrototypeId):THREE.BufferGeometry {
  const descriptor=FIXTURE_CATALOG[id];if(!descriptor)throw new Error(`UNKNOWN_FIXTURE:${id}`);
  const parts:THREE.BufferGeometry[]=[];
  const box=(x:number,y:number,z:number,w:number,h:number,d:number)=>parts.push(new THREE.BoxGeometry(w,h,d).translate(x,y,z));
  // A thin square member between two points; its ends and sides stay inside the hull of the points ± t/2.
  const beam=(a:THREE.Vector3Tuple,b:THREE.Vector3Tuple,t:number)=>{const from=new THREE.Vector3(...a),to=new THREE.Vector3(...b),axis=to.clone().sub(from);
    parts.push(new THREE.BoxGeometry(t,axis.length(),t).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.clone().normalize())).translate(...from.add(to).multiplyScalar(.5).toArray()));};
  // Four tapered legs with a ring and X bracing on every face of each section.
  const lattice=(height:number,base:number,top:number,sections:number,t:number,tint?:(section:number)=>string)=>{
    // Members start one thickness up; foot plates carry them to the ground so nothing dips below y=0.
    const half=(y:number)=>base+(top-base)*y/height,corners=[[1,1],[1,-1],[-1,-1],[-1,1]],lift=(y:number)=>t+y*(height-t)/height;
    const feet=()=>{for(const [x,z] of corners)box(x*base,t/2,z*base,1.4,t,1.4);};if(tint)tinted(tint(0),feet);else feet();
    for(let k=0;k<sections;k++){const y0=lift(height*k/sections),y1=lift(height*(k+1)/sections),r0=half(y0),r1=half(y1);
      const build=()=>{for(let i=0;i<4;i++){const [ax,az]=corners[i],[bx,bz]=corners[(i+1)%4];
        beam([ax*r0,y0,az*r0],[ax*r1,y1,az*r1],t);beam([ax*r1,y1,az*r1],[bx*r1,y1,bz*r1],t*.8);
        beam([ax*r0,y0,az*r0],[bx*r1,y1,bz*r1],t*.6);beam([bx*r0,y0,bz*r0],[ax*r1,y1,az*r1],t*.6);}};
      if(tint)tinted(tint(k),build);else build();}
  };
  // Multi-material prototypes tint every part; the renderer then enables vertex colors.
  const tinted=(color:string,build:()=>void)=>{const from=parts.length;build();const c=new THREE.Color(color);for(const part of parts.slice(from))part.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:part.getAttribute('position').count*3},(_,i)=>[c.r,c.g,c.b][i%3]),3));};
  const cylinder=(x:number,y:number,z:number,r:number,h:number)=>parts.push(new THREE.CylinderGeometry(r,r,h,12).translate(x,y,z));
  if(id==='bench'){
    box(0,4,0,12,1,4);box(0,6.5,-1.5,12,3,1);for(const x of [-4.5,4.5])for(const z of [-1.25,1.25])box(x,1.75,z,1,3.5,1);
  }else if(id==='bin'){box(0,4.5,0,3.5,9,3.5);box(0,9.5,0,4,1,4);box(0,9.5,1.75,2,.5,.5);}
  else if(id==='hydrant'){cylinder(0,3,0,1.25,6);cylinder(0,6.5,0,1.5,1);box(0,7.5,0,2,1,2);box(0,4,0,4,1.5,1.5);}
  else if(id==='safety-bollard'){cylinder(0,5.5,0,1.5,11);cylinder(0,11.5,0,2,1);}
  else if(id==='pay-station'){box(0,5,0,5,10,3);box(0,11,0,6,2,4);box(0,8.5,1.75,3,3,.5);box(0,5.5,1.75,2,1,.5);}
  else if(id==='raised-barrier-post'){box(0,4,0,4,8,4);box(0,12,0,1,8,1);box(0,9,1,2,1,1);}
  else if(id.startsWith('lamp-')){const h=descriptor.size16[1];cylinder(0,(h-3)/2,0,.65,h-3);box(0,h-2,0,4,2,4);box(0,h-.5,0,3,1,3);}
  else if(id==='utility-cabinet'){box(0,6,0,12,12,11.5);box(3,6,5.9,.5,2,.2);for(let y=2;y<10;y+=2)box(-2,y,5.9,5,.3,.2);}
  else if(id==='air-conditioner'){
    box(0,3.7,0,12,7.4,11.5);
    for(let x=-4;x<=4;x+=2)box(x,3.7,5.9,.5,6,.2);
    // Rooftop condenser fan/rim observed in CityRenderLab; stays within 8/16 height.
    parts.push(new THREE.TorusGeometry(3,.18,6,20).rotateX(Math.PI/2).translate(0,7.65,0));
    for(const z of [-2,-1,0,1,2])box(0,7.65,z,2*Math.sqrt(9-z*z),.15,.2);
  }
  else if(id==='water-tank'){cylinder(0,13,0,6,22);for(const x of [-4,4])box(x,1,0,1,2,4);}
  else if(id==='wall-lamp'){box(0,3,-.75,4,6,.5);box(0,3,.25,3,4,1.5);}
  else if(id==='bike-rack'){
    // Two inverted-U hoops stay inside the 4/16 curb strip that keeps the public walk body clear.
    for(const z of [-1.1,1.1]){for(const x of [-4.5,4.5])cylinder(x,3.5,z,.35,7);box(0,7.2,z,9.7,.7,.7);}
    for(const x of [-4.5,4.5])box(x,.25,0,1,.5,4);
  }
  else if(id==='roof-vent'){box(0,1,0,10,2,10);cylinder(0,4.5,0,3.5,5);cylinder(0,8,0,4.5,1);cylinder(0,9.25,0,2.5,1.5);for(const x of [-3,3])box(x,4.5,0,.4,4,7.6);}
  else if(id==='lattice-tower'){
    lattice(44,5.3,2.2,4,.8);box(0,44.5,0,6,1,6);cylinder(0,46.5,0,.45,3);
    for(const [x,z] of [[2.6,0],[-2.6,0],[0,2.6]])box(x,42,z,x?.5:1.6,4,x?1.6:.5);
  }
  else if(id==='antenna-mast'){
    const band=(k:number)=>k%2?'#f1efe9':'#c4483c';
    lattice(56,4.6,1.4,7,.7,band);tinted('#c4483c',()=>{cylinder(0,60,0,.5,8);cylinder(0,63.5,0,.9,1);});
    tinted('#d9dde0',()=>{for(const [x,z,w,d] of [[1.9,0,.6,1.8],[-1.9,0,.6,1.8],[0,1.9,1.8,.6],[0,-1.9,1.8,.6]])box(x,51,z,w,5,d);box(0,56.4,0,3.6,.8,3.6);});
  }
  else if(id==='planter'){
    tinted('#b9b3a7',()=>box(0,2.5,0,12,5,12));tinted('#5d4a3a',()=>box(0,5.1,0,10.5,.2,10.5));
    tinted('#5f8f4f',()=>box(0,7.5,0,9,5,9));tinted('#6f9f5a',()=>box(-1.5,10.5,1,5,3,5));tinted('#4f7f45',()=>box(2,10,-1.5,4.5,2.5,4.5));
  }
  const merged=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(!merged)throw new Error('FIXTURE_GEOMETRY_BUILD_FAILED');
  merged.translate(0,-descriptor.size16[1]/2,0);merged.scale(1/descriptor.size16[0],1/descriptor.size16[1],1/descriptor.size16[2]);return merged;
}
export class FixtureGeometryLibrary {
  private cache=new Map<FixturePrototypeId,THREE.BufferGeometry>();
  get(asset:string){if(!asset.startsWith('fixture.'))return undefined;const id=asset.slice(8) as FixturePrototypeId;if(!this.cache.has(id))this.cache.set(id,buildFixtureGeometry(id));return this.cache.get(id)!;}
  get size(){return this.cache.size;}
  dispose(){this.cache.forEach(g=>g.dispose());this.cache.clear();}
}
