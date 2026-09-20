import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {FIXTURE_CATALOG,type FixturePrototypeId} from './core/fixture-catalog';
/** Authored pieces in sixteenth-cell coordinates. The final prototype is centered and normalized. */
export function buildFixtureGeometry(id:FixturePrototypeId):THREE.BufferGeometry {
  const descriptor=FIXTURE_CATALOG[id];if(!descriptor)throw new Error(`UNKNOWN_FIXTURE:${id}`);
  const parts:THREE.BufferGeometry[]=[];
  const box=(x:number,y:number,z:number,w:number,h:number,d:number)=>parts.push(new THREE.BoxGeometry(w,h,d).translate(x,y,z));
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
  const merged=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(!merged)throw new Error('FIXTURE_GEOMETRY_BUILD_FAILED');
  merged.translate(0,-descriptor.size16[1]/2,0);merged.scale(1/descriptor.size16[0],1/descriptor.size16[1],1/descriptor.size16[2]);return merged;
}
export class FixtureGeometryLibrary {
  private cache=new Map<FixturePrototypeId,THREE.BufferGeometry>();
  get(asset:string){if(!asset.startsWith('fixture.'))return undefined;const id=asset.slice(8) as FixturePrototypeId;if(!this.cache.has(id))this.cache.set(id,buildFixtureGeometry(id));return this.cache.get(id)!;}
  get size(){return this.cache.size;}
  dispose(){this.cache.forEach(g=>g.dispose());this.cache.clear();}
}
