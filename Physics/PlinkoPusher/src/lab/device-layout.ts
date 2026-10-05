import { BOARD_DISPLAY_SCALE, type BoardDims, type TrayDims } from '../core/config';
import { localToWorld, type BoardFrame } from '../core/frame';
import type { ChutePacket } from '../core/game-core';
import { vec3, type Vec3 } from '../core/math';
import { RAW_ENTRY_V, RAW_FEED_V, RAW_EXIT_SPEED } from '../core/raw-feed';
export { RAW_ENTRY_V } from '../core/raw-feed';
import type { SiloSpec } from '../physics/silo-2d';
import { trayGeometry } from '../physics/tray-geometry';

/** One source for the receiving pockets, compactor cavity and four connected outlets. */
export interface DeviceLayout {
  trayZ0: number; trayTopY: number; floorY: number;
  silo: SiloSpec & { x: number; z: number; depth: number };
  scrap: SiloSpec & { x: number; z: number };
  scrapBelt: { left: number; right: number; y: number; z: number; depth: number };
  coinRail: { frontZ: number; backZ: number; y: number };
  scrapCoverY: number;
  boardScale: number;
  boardAnchor: Vec3; compressor: Vec3; collector: Vec3;
  pressIn: Vec3; die: Vec3; feedZ: number; dropY: number;
  passageWidth: number; cargoColumns: number; cargoRows: number; cargoPitch: number; layerPitch: number;
  pressHalfWidth: number; pressHalfDepth: number; pressTop: number; ramParkZ: number;
  outletCount: number; outletWidth: number; outletY: number; outletZ: number;
  housingFrontZ: number; housingBackZ: number;
}
export const ITEM_DEPTH = 0.3;
export const RECEIVER_TRAVEL = .5;
export const PROCESS_FRACTION = 0.12;
export const SCRAP_BELT_SECONDS = 3.2;
export const PROCESSOR_EXIT_V = 2.5;
export const POCKET_COUNT = 8;
export const POCKET_LEAD = .65;
export const POCKET_WALL_HALF = .06;
export const PLANAR_LOWER_SECONDS = 0.22;
export const COIN_TRANSFER_SECONDS = 4;
export const DIE_OPEN_FRACTION = .08;
export const OUTLET_STAGGER_SECONDS = .10;
export const RAMP_START = .85;
export const VISIBLE_EXIT_FRACTION = .96;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: Vec3, b: Vec3, t: number) => vec3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);

export function deviceLayout(board: BoardDims, tray: TrayDims, stacked = true): DeviceLayout {
  const g=trayGeometry(tray), trayZ0=-tray.depth/2, r=tray.tokenRadius;
  const feedZ=stacked ? Math.max(g.lip.zFront+r+.1,tray.faceMin+tray.stroke-tray.pusherDepth/2) : tray.faceMin+r+tray.stroke*.5;
  const outletY=g.wallHeight+.75, outletZ=trayZ0+feedZ;
  const boardScale=BOARD_DISPLAY_SCALE, machineWidth=Math.max(board.width*boardScale,tray.width);
  const cargoColumns=Math.max(4,Math.min(8,Math.floor((Math.min(board.width*boardScale,tray.width)-.6)/(r*2+.14)/4)*4));
  const cargoPitch=r*2+.14, passageWidth=Math.min(board.width*boardScale,tray.width)-.6;
  const pressWidth=4.4,pressX=-machineWidth/2-pressWidth/2-1;
  // Keep the machine's existing layout; only the outlet neck moves back over the moving plate.
  const serviceZ=trayZ0+(stacked?tray.faceMin+tray.stroke+r+.4:feedZ)-1.2;
  const coinRail={frontZ:serviceZ,backZ:serviceZ-3*cargoPitch,y:outletY+.6};
  const die=vec3(pressX,coinRail.y,coinRail.frontZ);
  const scrapBelt={left:pressX+pressWidth/2-.2,right:board.width*boardScale/2+.25,y:coinRail.y+1,z:coinRail.frontZ-.15,depth:1.05};
  const pressIn=vec3(0,scrapBelt.y+.4,scrapBelt.z-.1), tilt=40*Math.PI/180;
  const anchor=vec3(0,pressIn.y+.5+((board.height/2+PROCESSOR_EXIT_V)*Math.cos(tilt)-ITEM_DEPTH*Math.sin(tilt))*boardScale,pressIn.z-((board.height/2+PROCESSOR_EXIT_V)*Math.sin(tilt)+ITEM_DEPTH*Math.cos(tilt))*boardScale);
  const siloRadius=board.itemRadius*boardScale,siloWidth=8.2/3;
  return {
    trayZ0,trayTopY:0,floorY:-3.6,boardAnchor:anchor,boardScale,
    silo:{x:machineWidth/2+1.9+siloWidth/2,z:die.z-.6,width:siloWidth,depth:siloRadius*2.12+.16,radius:siloRadius,outletHalfWidth:Math.max(.65,siloRadius*3.3),bottom:-1.2,throatY:-2.3,top:pressIn.y+1.2+(board.height+PROCESSOR_EXIT_V+4)*Math.cos(tilt)*boardScale,displayCapacity:720},
    scrap:{x:pressX,width:pressWidth,bottom:die.y+1,throatY:die.y+.85,top:die.y+4.1,outletHalfWidth:.7,radius:.21,displayCapacity:24,inletWidth:pressWidth,radiusVariation:.22,gravity:14,z:die.z+.1},
    scrapBelt,coinRail,
    scrapCoverY:die.y+.6,
    compressor:die,pressIn,die,collector:vec3(0,-2.8,tray.depth/2+1.5),feedZ,dropY:stacked?outletY:tray.tokenHalfHeight,
    passageWidth,cargoColumns,cargoRows:stacked?Math.ceil(24/cargoColumns):1,cargoPitch,layerPitch:tray.tokenHalfHeight*2+.05,
    pressHalfWidth:(pressWidth+.7)/2,pressHalfDepth:.8,pressTop:die.y+1.85,ramParkZ:die.z,
    outletCount:4,outletWidth:cargoColumns/4*cargoPitch+.16,outletY,outletZ,housingFrontZ:die.z+.75,housingBackZ:coinRail.backZ-.7,
  };
}

export function cargoOffset(dev:DeviceLayout,index:number):Vec3 {
  const layer=Math.floor(index/dev.cargoColumns),seat=index%dev.cargoColumns;
  const port=seat%dev.outletCount,pair=Math.floor(seat/dev.outletCount),pairCount=dev.cargoColumns/dev.outletCount;
  return vec3(outletCenter(dev,port)+(pair-(pairCount-1)/2)*dev.cargoPitch,layer*dev.layerPitch,0);
}
export function outletCenter(dev:DeviceLayout,outlet:number):number {
  return (outlet-(dev.outletCount-1)/2)*dev.passageWidth/dev.outletCount;
}
/** Concealed distribution from the left cassette, followed by a vertical outlet over the plate. */
export function coinTransferPoint(dev:DeviceLayout,index:number,progress:number):Vec3 {
  const o=cargoOffset(dev,index),port=index%dev.outletCount,pair=Math.floor(index%dev.cargoColumns/dev.outletCount);
  const pairCount=dev.cargoColumns/dev.outletCount;
  const a=vec3(dev.die.x+(pair-(pairCount-1)/2)*dev.cargoPitch,dev.coinRail.y+o.y,dev.coinRail.frontZ-port*dev.cargoPitch);
  const b=vec3(o.x,a.y,a.z),c=vec3(o.x,a.y,dev.outletZ),end=vec3(o.x,dev.outletY+o.y,dev.outletZ);
  const p=clamp01(progress);
  if(p<=DIE_OPEN_FRACTION)return a;
  if(p<.65)return lerp(a,b,(p-DIE_OPEN_FRACTION)/(.65-DIE_OPEN_FRACTION));
  if(p<RAMP_START)return lerp(b,c,(p-.65)/(RAMP_START-.65));
  return lerp(c,end,(p-RAMP_START)/(1-RAMP_START));
}
export function coinExitVelocity(dev:DeviceLayout):Vec3 {
  return vec3(0,(dev.outletY-dev.coinRail.y)/(COIN_TRANSFER_SECONDS*(1-RAMP_START)),0);
}

/** Belt to left service lift, then concealed distributor over the physical press chamber. */
export function scrapTransferPoint(dev:DeviceLayout,uFraction:number,index:number,progress:number):Vec3 {
  const belt=dev.scrapBelt,lane=(index%3-1)*.27;
  const start=vec3((clamp01(uFraction)-.5)*dev.passageWidth,belt.y+.2,belt.z+lane);
  const end=vec3(belt.left,belt.y+.2,belt.z+lane);
  const delay=Math.min(.45,index*.006),p=clamp01((progress-delay)/(1-delay));
  if(p<.7)return lerp(start,end,p/.7);
  const lift=vec3(end.x,dev.scrap.top+1.05,dev.housingBackZ+.4);
  if(p<.8)return lerp(end,vec3(end.x,end.y,lift.z),(p-.7)/.1);
  if(p<.93)return lerp(vec3(end.x,end.y,lift.z),lift,(p-.8)/.13);
  return lerp(lift,vec3(dev.scrap.x,dev.scrap.top+.9,dev.scrap.z),(p-.93)/.07);
}
export function pocketLane(board:BoardDims,u:number):number {
  return Math.max(0,Math.min(POCKET_COUNT-1,Math.floor(u/board.width*POCKET_COUNT)));
}
/** The physical body has already crossed the pockets. Its final pose continues into the opaque manifold. */
export function receiverPoint(board:BoardDims,frame:BoardFrame,p:ChutePacket,elapsed:number):Vec3 {
  const duration=(p.arriveAt-p.leftAt)*PROCESS_FRACTION,t=clamp01(elapsed/duration);
  const distance=RECEIVER_TRAVEL*(1-Math.exp(-Math.max(0,p.vv)*elapsed/RECEIVER_TRAVEL));
  const u=Math.max(board.itemRadius,Math.min(board.width-board.itemRadius,p.u+p.vu*duration*t*(1-t)*.15));
  return localToWorld(frame,u,p.v+distance,ITEM_DEPTH);
}
/** A sealed loft connects every rotated pocket to the fixed upper receiving reservoir. */
export function byproductPoint(board:BoardDims,frame:BoardFrame,dev:DeviceLayout,progress:number,across=0,depth=0):Vec3 {
  const a=localToWorld(frame,board.width/2+across/frame.scale,board.height+PROCESSOR_EXIT_V,ITEM_DEPTH+depth/frame.scale);
  return lerp(a,vec3(across,dev.pressIn.y,dev.pressIn.z+depth),clamp01(progress));
}
/** Fast approach, slower loaded stroke, short hold, then return. */
export function pressStroke(phase:string,time:number,cycle:number,retract:number):number {
  if(phase==='retracting')return 1-clamp01(time/Math.max(.001,retract));
  if(phase!=='pressing')return 0;
  const t=clamp01(time/Math.max(.001,cycle));
  if(t<.2)return .7*t/.2;
  if(t<.8)return .7+.3*(t-.2)/.6;
  return 1;
}


export interface RawFeedRoute { points: Vec3[]; durations: number[]; seconds: number; visibleFrom: number }
/** Enclosed route: silo floor -> base drive -> rear lift -> full-width distributor -> metering mouth. */
export function rawFeedRoute(board: BoardDims, frame: BoardFrame, dev: DeviceLayout, u: number, source?: Vec3): RawFeedRoute {
  const silo = dev.silo;
  const entry = localToWorld(frame, board.width - 0.4, RAW_FEED_V, -0.7);
  const atLane = localToWorld(frame, u, RAW_FEED_V, -0.7);
  const visible = localToWorld(frame, u, RAW_FEED_V, ITEM_DEPTH);
  const mouth = localToWorld(frame, u, RAW_ENTRY_V, ITEM_DEPTH);
  const rear = localToWorld(frame, board.width + 1.0, RAW_FEED_V, -1.8);
  const points = [source ?? vec3(silo.x, silo.throatY - silo.radius - .02, silo.z), vec3(silo.x, silo.throatY-.6, silo.z), vec3(silo.x, silo.throatY-.6, rear.z), vec3(rear.x, silo.throatY-.6, rear.z), rear, entry, atLane, visible, mouth];
  // Presentation placements must not change local release times or economic outcomes.
  // Hidden drive speed adapts to the service housing length; the final visible descent keeps its speed.
  const seconds = 3.8 + board.height * .08 + (board.width-u) / 10;
  const visibleSeconds = (RAW_ENTRY_V-RAW_FEED_V) / RAW_EXIT_SPEED;
  const distances = points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y,p.z-points[i].z));
  const hiddenLength = distances.slice(0,-1).reduce((a,b)=>a+b,0);
  const durations = distances.map((length,i)=>i===distances.length-1?visibleSeconds:length/hiddenLength*(seconds-visibleSeconds));
  return { points, durations, seconds, visibleFrom: seconds-visibleSeconds };
}
export function rawFeedPosition(route: RawFeedRoute, elapsed: number): Vec3 {
  let remaining = Math.max(0, elapsed);
  for (let i=0;i<route.durations.length;i++) {
    const duration=route.durations[i];
    if (remaining <= duration && duration > 1e-8) {
      const a=route.points[i], b=route.points[i+1], t=remaining/duration;
      return vec3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t);
    }
    remaining-=duration;
  }
  return { ...route.points[route.points.length-1] };
}
