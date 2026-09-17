import * as THREE from 'three';
/** A shared +Z arrow silhouette; placement quarter-turns carry the planned heading. */
export function createParkingArrowGeometry(){
  const shape=new THREE.Shape();shape.moveTo(-.12,-.45);shape.lineTo(.12,-.45);shape.lineTo(.12,.05);shape.lineTo(.38,.05);shape.lineTo(0,.45);shape.lineTo(-.38,.05);shape.lineTo(-.12,.05);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false,steps:1});geometry.rotateX(Math.PI/2);geometry.translate(0,.5,0);return geometry;
}
