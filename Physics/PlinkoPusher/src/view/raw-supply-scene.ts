import * as THREE from 'three';
import type { Simulation } from '../lab/simulation';
import { rawFeedLanes } from '../core/raw-feed';
import { rawFeedRoute, rawFeedPosition } from '../lab/device-layout';
import type { DeviceMaterials } from './materials';
import { ResourceScope } from './resources';

/** Visible inventory and full-width metering, driven only by the core's real stock and transfers. */
export class RawSupplyScene {
  readonly root = new THREE.Group();
  readonly hopper = new THREE.Group();
  private readonly ducts = new THREE.Group();
  private readonly resources = new ResourceScope();
  private readonly placement = new ResourceScope();
  readonly stock: THREE.InstancedMesh;
  readonly moving: THREE.InstancedMesh;
  readonly gates: THREE.Mesh[] = [];
  readonly drive: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly axis = new THREE.Vector3(0,0,1);
  private readonly rotation = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private lastTime = 0;

  constructor(readonly sim: Simulation, private readonly mats: DeviceMaterials, boardGroup: THREE.Group) {
    const s = sim.device.silo, b = sim.scenario.board, W = b.width;
    this.root.add(this.ducts); boardGroup.add(this.hopper);
    const metal = mats.metal, paint = mats.paint, dark = mats.dark;
    const height = s.top - s.bottom, front = s.z + s.depth / 2;
    this.box(s.width + 0.6, 1.4, s.depth + 0.6, paint, s.x, sim.device.floorY + 0.9, s.z);
    this.box(s.width - 0.4, 0.85, 0.08, mats.meshGuard, s.x, sim.device.floorY + 0.9, front + 0.35);
    const driveGeo = this.resources.own(new THREE.CylinderGeometry(0.47, 0.47, 0.25, 12));
    this.drive = new THREE.Mesh(driveGeo, metal); this.drive.rotation.x = Math.PI / 2;
    this.drive.position.set(s.x, sim.device.floorY + 1.05, front + 0.45); this.root.add(this.drive);
    this.box(s.width, height, 0.16, dark, s.x, (s.top+s.bottom)/2, s.z-s.depth/2);
    const glass = this.resources.own(mats.glass.clone()); glass.opacity = 0.13; glass.roughness = 0.2;
    this.box(s.width-0.2, height-0.15, 0.04, glass, s.x, (s.top+s.bottom)/2, front, this.root, false).renderOrder = 4;
    for (const side of [-1,1]) {
      this.box(0.04,height,s.depth,glass,s.x+side*s.width/2,(s.top+s.bottom)/2,s.z,this.root,false);
      for (const z of [s.z-s.depth/2,front]) {
        this.box(0.34,height+0.65,0.35,paint,s.x+side*s.width/2,(s.top+s.bottom)/2,z);
        for (let y=s.bottom; y<=s.top; y+=3.0) this.joint(s.x+side*s.width/2,y,z+0.22);
      }
    }
    for (const y of [s.bottom,s.bottom+height*.5,s.top]) this.box(s.width+0.3,0.24,0.25,metal,s.x,y,front+0.04);
    this.box(s.width+0.4,0.22,s.depth+0.3,paint,s.x,s.top+0.18,s.z);
    // Hopper bottom converges to a take-off hidden in the base drive, with an actual open throat.
    for (const side of [-1,1]) {
      const run=s.width/2-s.outletHalfWidth,rise=s.bottom-s.throatY;
      const plate=this.box(Math.hypot(run,rise),.12,s.depth,metal,s.x+side*(s.width/2+s.outletHalfWidth)/2,(s.bottom+s.throatY)/2-.07,s.z);
      plate.rotation.z=side*Math.atan2(rise,run);
    }
    this.box(s.width+0.1,0.2,0.22,mats.yellow,s.x,s.bottom-.9,front);
    for (const dx of [-s.width*.28,s.width*.28]) {
      this.box(0.35,0.14,0.2,mats.orangeGlow,s.x+dx,s.top-.35,front-.2);
      const light=new THREE.PointLight(0xffc583,12,8,2); light.position.set(s.x+dx,s.top-1,front-.8); this.root.add(light);
    }
    this.stock=this.instances(new THREE.IcosahedronGeometry(s.radius,0),mats.item,s.displayCapacity,this.root);
    this.moving=this.instances(new THREE.IcosahedronGeometry(b.itemRadius,0),mats.item,sim.scenario.flow.plinkoMaxActive+8,this.root);

    // A hollow rear distributor spans the entire peg bed. Local +y is upstream (-v).
    const H=this.hopper, lanes=rawFeedLanes(b), mouth=b.itemRadius*2+.28;
    this.box(W+.6,1.8,.18,metal,W/2,3.35,-1.35,H);
    this.box(W+.6,.20,2.3,dark,W/2,4.25,-.25,H);
    this.box(W+.6,.18,.8,metal,W/2,2.38,-.96,H);
    this.box(W+.3,.32,.18,mats.yellow,W/2,3.87,.93,H);
    for(let x=.2;x<W;x+=1.05) {
      const stripe=this.box(.48,.34,.025,dark,x,3.87,1.035,H); stripe.rotation.z=-.55;
    }
    for(const x of [-.3,W+.3]) {
      this.box(.36,2.1,2.3,paint,x,3.28,-.15,H); this.joint(x,3.3,1.04,H);
      this.box(.24,.3,.18,mats.orangeGlow,x,3.60,1.10,H);
      const light=new THREE.PointLight(0xffc06c,15,8,2); light.position.set(x,3.2,1.1); H.add(light);
    }
    // Floor is segmented around real apertures, including the two outermost lanes.
    let edge=0;
    for(const u of lanes) {
      const end=u-mouth/2;
      if(end>edge) this.box(end-edge,.16,1.2,metal,(edge+end)/2,2.15,.28,H);
      edge=u+mouth/2;
      for(const side of [-1,1]) this.box(.10,1.15,1.03,metal,u+side*(mouth/2+.05),1.78,.32,H);
      this.box(mouth+.2,.12,.15,mats.yellow,u,1.15,-.09,H);
      const gate=this.box(mouth,.12,1.0,metal,u,2.15,.3,H); this.gates.push(gate);
    }
    if(edge<W) this.box(W-edge,.16,1.2,metal,(edge+W)/2,2.15,.28,H);
    this.box(W,.22,.14,metal,W/2,2.50,.94,H);
    // A narrow inspection opening reveals actual material above the metering mouths.
    this.box(W,.9,.04,glass,W/2,3.01,.95,H,false);
    this.updatePlacement(); this.update();
  }
  private box(w:number,h:number,d:number,m:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=this.root,shadow=true) {
    const mesh=new THREE.Mesh(this.resources.own(new THREE.BoxGeometry(w,h,d)),m); mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  private joint(x:number,y:number,z:number,parent:THREE.Object3D=this.root) {
    this.box(.64,.64,.12,this.mats.metal,x,y,z,parent);
    for(const dx of [-.19,.19]) for(const dy of [-.19,.19]) {
      const bolt=new THREE.Mesh(this.resources.own(new THREE.CylinderGeometry(.065,.065,.10,6)),this.mats.metalLight);bolt.rotation.x=Math.PI/2;bolt.position.set(x+dx,y+dy,z+.1);parent.add(bolt);
    }
  }
  private instances(g:THREE.BufferGeometry,m:THREE.Material,cap:number,parent:THREE.Object3D) {
    const mesh=this.resources.own(new THREE.InstancedMesh(this.resources.own(g),m,cap));mesh.count=0;mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;parent.add(mesh);return mesh;
  }
  updatePlacement() {
    this.placement.dispose();this.ducts.clear();
    const sim=this.sim, route=rawFeedRoute(sim.scenario.board,sim.frame,sim.device,sim.scenario.board.width-.4);
    // Opaque, continuous service housings contain the lower belt and rising elevator.
    for(let i=1;i<6;i++) {
      const a=new THREE.Vector3().copy(route.points[i]),b=new THREE.Vector3().copy(route.points[i+1]),len=a.distanceTo(b);
      if(len<.01) continue;
      const mesh=new THREE.Mesh(this.placement.own(new THREE.BoxGeometry(1.15,1.15,len+.15)),this.mats.paint);
      mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),b.sub(a).normalize());mesh.castShadow=true;this.ducts.add(mesh);
    }
  }
  update() {
    const c=this.sim.core, dt=Math.max(0,c.time-this.lastTime);this.lastTime=c.time;
    const silo=this.sim.device.silo,palette=[0x6b7a85,0x918d80,0x79604b,0x4f606b,0xa58b52];
    this.stock.count=this.sim.silo.bodies.length;
    this.sim.silo.bodies.forEach((body,i)=>{
      this.pos.set(silo.x+body.x,body.y,silo.z);
      this.rotation.setFromAxisAngle(this.axis,body.angle);
      this.matrix.compose(this.pos,this.rotation,this.scale.setScalar(body.radius/silo.radius));this.stock.setMatrixAt(i,this.matrix);
      this.stock.setColorAt(i,this.color.setHex(palette[body.id%palette.length]));
    });
    this.stock.instanceMatrix.needsUpdate=true;if(this.stock.instanceColor)this.stock.instanceColor.needsUpdate=true;
    const lanes=rawFeedLanes(this.sim.scenario.board), open=new Set<number>();let n=0;
    for(const transfer of c.rawTransit.values()) {
      const route=rawFeedRoute(this.sim.scenario.board,this.sim.frame,this.sim.device,transfer.order.u,transfer.source);
      const elapsed=(c.time-transfer.leftAt)/(transfer.arriveAt-transfer.leftAt)*route.seconds;
      // Interior lift/belt are deliberately concealed; the same record emerges in the inspection opening.
      if(elapsed<route.visibleFrom-.08) continue;
      open.add(lanes.indexOf(transfer.order.u));
      this.pos.copy(rawFeedPosition(route,elapsed));
      this.matrix.compose(this.pos,this.rotation.identity(),this.scale.setScalar(this.sim.frame.scale));this.moving.setMatrixAt(n,this.matrix);
      this.moving.setColorAt(n++,this.color.setHex(palette[transfer.order.id%palette.length]));
    }
    const snap=this.sim.plinkoSnap;
    for(let i=0;i<snap.count;i++)if(snap.b[i]<-.25) {let best=0;for(let j=1;j<lanes.length;j++)if(Math.abs(lanes[j]-snap.a[i])<Math.abs(lanes[best]-snap.a[i]))best=j;open.add(best);}
    this.gates.forEach((g,i)=>g.position.z=open.has(i)?1.65:.3);
    this.moving.count=n;this.moving.instanceMatrix.needsUpdate=true;if(this.moving.instanceColor)this.moving.instanceColor.needsUpdate=true;
    if(c.rawTransit.size)this.drive.rotation.y+=dt*2.5;
  }
  dispose() {this.placement.dispose();this.resources.dispose();this.root.removeFromParent();this.hopper.removeFromParent();}
}
