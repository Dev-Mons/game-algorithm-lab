import type {Box16,Heading} from './environment-contract';
import type {Vec3} from './analysis';
export type FixturePrototypeId='bench'|'bin'|'hydrant'|'safety-bollard'|'pay-station'|'raised-barrier-post'|'lamp-16'|'lamp-32'|'lamp-64'|'utility-cabinet'|'air-conditioner'|'water-tank'|'wall-lamp';
export interface FixturePrototype {id:FixturePrototypeId;size16:Vec3;bodyBoxes16:Box16[];priority:500|400|300;family:string;color:string}
const specifications:[FixturePrototypeId,Vec3,500|400|300,string,string][]=[
  ['bench',[12,8,4],300,'bench','#c5a27b'],['bin',[4,10,4],300,'bin','#658d86'],['hydrant',[4,8,4],500,'hydrant','#c97159'],
  ['safety-bollard',[4,12,4],500,'safety-bollard','#e4c869'],['pay-station',[6,12,4],300,'pay-station','#708a9e'],['raised-barrier-post',[4,16,4],500,'barrier','#e5d5b6'],
  ['lamp-16',[4,16,4],400,'lamp','#b9cbd0'],['lamp-32',[4,32,4],400,'lamp','#b9cbd0'],['lamp-64',[4,64,4],400,'lamp','#b9cbd0'],
  ['utility-cabinet',[12,12,12],300,'utility','#93a5a0'],['air-conditioner',[12,8,12],300,'utility','#afbbb9'],['water-tank',[12,24,12],300,'utility','#a7b5c0'],['wall-lamp',[4,6,2],400,'lamp','#ffe2a1'],
];
export const FIXTURE_CATALOG=Object.fromEntries(specifications.map(([id,size16,priority,family,color])=>[id,{id,size16,priority,family,color,bodyBoxes16:[{min:[-size16[0]/2,0,-size16[2]/2],max:[size16[0]/2,size16[1],size16[2]/2]}]}])) as Record<FixturePrototypeId,FixturePrototype>;
export function transformFixtureBox(box:Box16,center16:Vec3,heading:Heading):Box16 {
  const corners:Vec3[]=[];
  for(const x of [box.min[0],box.max[0]])for(const z of [box.min[2],box.max[2]]){let u=x,v=z;for(let i=0;i<heading;i++)[u,v]=[v,-u];corners.push([center16[0]+u,center16[1]+box.min[1],center16[2]+v],[center16[0]+u,center16[1]+box.max[1],center16[2]+v]);}
  return {min:[0,1,2].map(a=>Math.floor(Math.min(...corners.map(c=>c[a])))) as Vec3,max:[0,1,2].map(a=>Math.ceil(Math.max(...corners.map(c=>c[a])))) as Vec3};
}
