import {createDocument,replaceGrid,setBuildingTheme,type GenerationDocument,type Profile} from '../src/core/document';
import type {Vec3} from '../src/core/analysis';
import {box,FIXTURES,REFERENCE_D_CELLS} from '../src/fixtures';

export const CONCEPTS=[['A','shop'],['B','office'],['C','urban-shop'],['D','tower11-d']] as const;
export interface PreservationCase {id:string;document:GenerationDocument;render?:boolean}
const shifted=(cells:Vec3[],dx:number,dy:number,dz:number)=>cells.map(([x,y,z])=>[x+dx,y+dy,z+dz] as Vec3);
export function conceptPreservationCases():PreservationCase[]{
  const cases:PreservationCase[]=[];
  const add=(id:string,profile:Profile,cells:Vec3[],render=false)=>{
    const value={id,document:createDocument(cells,42,profile),render};cases.push(value);return value;
  };
  for(const [label,profile] of CONCEPTS){
    const reference=label==='D'?REFERENCE_D_CELLS:FIXTURES[label==='C'?'referenceCHigh':`reference${label}`].cells;
    add(`${label}-reference`,profile,reference,true);
    add(`${label}-low`,profile,box(7,2,5),true);
    add(`${label}-high`,profile,box(9,24,6),true);
    add(`${label}-stepped`,profile,box(10,13,7).filter(([x,y,z])=>y<4||y<9&&x>=2&&z<6||x>=4&&x<8&&z>1&&z<5),true);
    // Every supported height tests both sides of all proportion/allocation boundaries.
    for(let h=1;h<=32;h++)add(`${label}-height-${h}`,profile,box(7,h,3));
    // Absolute phase, short walls and incomplete repeat groups in all four orientations.
    for(let width=1;width<=8;width++)add(`${label}-width-${width}`,profile,shifted(box(width,9,3),-5,0,-3));
    add(`${label}-covered`,profile,[[0,0,0],[0,1,0],[0,2,0],[1,0,0],[1,2,0]]);
    add(`${label}-notch`,profile,box(8,9,4).filter(([x,y,z])=>x!==3||y!==4||z!==3));
    const mixed=add(`${label}-tiles`,profile,box(7,9,4),true);
    mixed.document=setBuildingTheme(mixed.document,mixed.document.buildings[0].componentId,{...mixed.document.buildingDefinition,tileSettings:{base:'D',corner:'B',body:'C',crown:'A'}});
    const solid=add(`${label}-solid`,profile,box(2,5,2));
    solid.document=setBuildingTheme(solid.document,solid.document.buildings[0].componentId,{...solid.document.buildingDefinition,tileSettings:{base:'wall',corner:'wall',body:'wall',crown:'wall'}});
    const grown=add(`${label}-anchor-growth`,profile,shifted(box(7,8,4),-3,0,-2));
    grown.document=replaceGrid(grown.document,[...grown.document.grid,[-4,0,-2]]);
    const city=FIXTURES[`city${label}`];
    cases.push({id:`${label}-city`,document:createDocument(city.cells,42,profile,undefined,undefined,city.sceneInputs)});
    for(const seed of [0,17,43])cases.push({id:`${label}-seed-${seed}`,document:createDocument(box(10,12,6).filter(([x,y,z])=>y<5||x>1&&z<4),seed,profile)});
  }
  cases.push({id:'C-low-reference',document:createDocument(FIXTURES.referenceCLow.cells,42,'urban-shop')});
  cases.push({id:'C-portal-reference',document:createDocument(FIXTURES.referenceCPortal.cells,42,'urban-shop')});
  return cases;
}
