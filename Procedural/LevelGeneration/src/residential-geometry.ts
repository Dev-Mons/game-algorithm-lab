import * as THREE from 'three';
import meshes from './assets/residential/meshes.json';

/** Shared source buffers: no GLTF/Blender process is required by the viewer. */
export class ResidentialGeometryLibrary {
  private geometries=new Map<string,THREE.BufferGeometry>();
  private textures:THREE.Texture[]=[];
  readonly material:THREE.MeshStandardMaterial;
  constructor(){
    const loader=new THREE.TextureLoader(),url=(name:string)=>`${import.meta.env.BASE_URL}assets/residential/${name}.png`;
    const color=loader.load(url('BaseColor')),normal=loader.load(url('Normal')),orm=loader.load(url('ORM'));
    color.colorSpace=THREE.SRGBColorSpace;
    this.textures=[color,normal,orm];
    // Source meshes are exterior skins. DoubleSide also keeps edited undersides
    // and formerly hidden joins readable at viewpoints outside the Blender preview.
    this.material=new THREE.MeshStandardMaterial({map:color,normalMap:normal,aoMap:orm,
      roughnessMap:orm,metalnessMap:orm,roughness:1,metalness:1,side:THREE.DoubleSide});
  }
  get(asset:string):THREE.BufferGeometry|undefined {
    const source=(meshes as Record<string,{position:number[];normal:number[];uv:number[]}>)[asset];
    if(!source)return;
    let geometry=this.geometries.get(asset);
    if(!geometry){
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(source.position,3));
      geometry.setAttribute('normal',new THREE.Float32BufferAttribute(source.normal,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(source.uv,2));
      geometry.computeBoundingBox();geometry.computeBoundingSphere();this.geometries.set(asset,geometry);
    }
    return geometry;
  }
  dispose(){this.geometries.forEach(g=>g.dispose());this.textures.forEach(t=>t.dispose());this.material.dispose();}
}
