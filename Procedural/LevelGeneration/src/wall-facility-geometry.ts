import {BoxGeometry,type BufferGeometry} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {WALL_FACILITY_ASSETS} from './core/wall-facility-assets';
export class WallFacilityGeometryLibrary {
  private cache=new Map<string,BufferGeometry>();
  get size(){return this.cache.size;}
  get(key:string){const asset=WALL_FACILITY_ASSETS[key];if(!asset)return undefined;
    if(!this.cache.has(key)){const parts=asset.boxes16.map(b=>new BoxGeometry(...b.max.map((n,i)=>(n-b.min[i])/16) as [number,number,number]).translate(...b.min.map((n,i)=>(n+b.max[i])/32) as [number,number,number]));const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(!geometry)throw new Error('FACILITY_GEOMETRY_FAILED');this.cache.set(key,geometry);}return this.cache.get(key)!;
  }
  dispose(){this.cache.forEach(g=>g.dispose());this.cache.clear();}
}
