import {mergeBoxes16,cellBox16} from './core/placement-bounds';
import * as THREE from "three";
import type { GenerationDocument } from "./core/document";
import type { GenerationResult, Vec3 } from "./core/generate";
import type { Box16, SourceRef } from "./core/environment-contract";
import { buildingComponents } from "./core/buildings";

export interface PlanOverlay { id:string; sourceRefs:SourceRef[]; boxes16?:Box16[]; path?:Vec3[]; color?:string }
/** Generic display adapter. No planning or candidate selection lives here. */
export class EnvironmentPreview {
  readonly group=new THREE.Group();
  readonly inputs=new THREE.Group();
  readonly plans=new THREE.Group();
  private lastInput?:GenerationDocument;private inputOrigin=new THREE.Vector3();
  private materials=new Map<string,THREE.LineBasicMaterial>();
  private selectionMaterial=new THREE.LineBasicMaterial({color:'#ffdc79',depthTest:false,transparent:true,opacity:1});
  constructor(){this.group.add(this.inputs,this.plans);}
  clear(keepInputs=false){if(!keepInputs)this.lastInput=undefined;for(const group of keepInputs?[this.plans]:[this.inputs,this.plans]) for(const child of [...group.children]) {group.remove(child);if(child instanceof THREE.LineSegments) child.geometry.dispose();}}
  private lines(group:THREE.Group,points:number[],color:string,sourceRefs:SourceRef[]) {
    if(!points.length)return;
    let material=this.materials.get(color);
    if(!material){material=new THREE.LineBasicMaterial({color,transparent:true,opacity:.65,depthTest:false});this.materials.set(color,material);}
    const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),material);
    line.renderOrder=25;line.userData.sourceRefs=sourceRefs;line.userData.baseMaterial=material;group.add(line);
  }
  sync(document:GenerationDocument|undefined,result:GenerationResult,origin:THREE.Vector3) {
    const reuseInputs=!!document&&Object.isFrozen(document)&&document===this.lastInput&&origin.equals(this.inputOrigin);
    this.clear(reuseInputs);
    const appendBox=(points:number[],box:Box16)=>{
      for(let axis=0;axis<3;axis++)for(let a=0;a<2;a++)for(let b=0;b<2;b++) {
        const other=[0,1,2].filter(i=>i!==axis),start=[...box.min],end=[...box.min];
        start[other[0]]=end[other[0]]=(a?box.max:box.min)[other[0]];
        start[other[1]]=end[other[1]]=(b?box.max:box.min)[other[1]];end[axis]=box.max[axis];
        for(const v of [start,end]) points.push(...v.map((n,i)=>n/16+origin.getComponent(i)));
      }
    };
    if(document&&!reuseInputs) {
      const sources:{cells:Vec3[];ref:SourceRef;color:string}[]=[
        ...(result.environment?.reservations.filter(r=>r.kind==='solid'&&r.sourceRefs.some(s=>s.kind==='building'))??[]).map(r=>({cells:r.cells,ref:{kind:'building' as const,id:r.ownerId},color:'#8fa8b9'})),
        {cells:document.sceneInputs.roads,ref:{kind:'road' as const,id:'roads'},color:'#80bbc9'},
        ...document.sceneInputs.objects.map(o=>({cells:o.cells,ref:{kind:'object' as const,id:o.id},color:'#a5cf8a'})),
        ...document.sceneInputs.parkingAreas.map(p=>({cells:p.cells,ref:{kind:'parking' as const,id:p.id},color:'#edb760'})),
      ];
      for(const source of sources) {
        const points:number[]=[];
        for(const box of mergeBoxes16(source.cells.map(cellBox16))){if(source.ref.kind==='parking')box.max[1]=box.min[1]+.8;appendBox(points,box);}
        this.lines(this.inputs,points,source.color,[source.ref]);
      }
    }
    this.lastInput=document;this.inputOrigin.copy(origin);
    const overlays:PlanOverlay[]=[
      ...(result.environment?.preflight??[]).map(p=>({id:`envelope:${p.buildingId}`,sourceRefs:[{kind:'building' as const,id:p.buildingId}],boxes16:p.envelope.requiredBoxes16,color:'#ce98d9'})),
      ...(result.environment?.reservations??[]).map(r=>({id:r.id,sourceRefs:r.sourceRefs,boxes16:r.boxes16,color:'#72d8cb'})),
      ...(result.environment?.overlays??[]),
    ];
    for(const overlay of overlays) {
      const points:number[]=[];for(const box of mergeBoxes16(overlay.boxes16??[]))appendBox(points,box);
      const path=overlay.path??[];
      for(let i=1;i<path.length;i++)for(const c of [path[i-1],path[i]])points.push(c[0]+.5+origin.x,c[1]+.05+origin.y,c[2]+.5+origin.z);
      this.lines(this.plans,points,overlay.color??'#70ddc7',overlay.sourceRefs);
    }
  }
  select(source?:SourceRef){for(const group of [this.inputs,this.plans])for(const child of group.children)if(child instanceof THREE.LineSegments)child.material=source&&child.userData.sourceRefs?.some((s:SourceRef)=>s.kind===source.kind&&s.id===source.id)?this.selectionMaterial:child.userData.baseMaterial;}
  dispose(){this.clear();this.materials.forEach(m=>m.dispose());this.selectionMaterial.dispose();}
}
