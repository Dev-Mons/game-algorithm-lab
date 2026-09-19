import type { Vec3 } from "./core/generate";
import type {Profile} from './core/document';
export function box(x: number, y: number, z: number): Vec3[] {
  const cells: Vec3[] = [];
  for (let a = 0; a < x; a++)
    for (let b = 0; b < y; b++)
      for (let c = 0; c < z; c++) cells.push([a, b, c]);
  return cells;
}
const sealed = box(3, 3, 3).filter((c) => c.join(",") !== "1,1,1");
const shift = (cells: Vec3[], x: number, y: number, z: number): Vec3[] =>
  cells.map((c) => [c[0] + x, c[1] + y, c[2] + z]);
const annex = box(3, 4, 3).concat(shift(box(4, 2, 3), 3, 0, 0));
const quarter: Vec3[] = [];
for (let row = 0; row < 3; row++)
  for (let column = 0; column < 3; column++) {
    const height = 2 + ((row + column * 2) % 4);
    quarter.push(
      ...shift(
        box(3 + (column === 1 ? 1 : 0), height, 3),
        column * 7,
        0,
        row * 7,
      ),
    );
    if (row === 1 && column === 1)
      quarter.push(...shift(box(2, 2, 3), column * 7 + 4, 0, row * 7));
  }
// Reference A: twin wings, a recessed central terrace and a tall entry void.
// The volume is editable input; facade generation uses the common rule path.
export const REFERENCE_A_CELLS=box(20,32,9).filter(([x,y,z])=>{
  if(x>=7&&x<13){
    if(y<3&&(x===7||x===12))return true;
    if(y<6)return z<2;
    if(y>=14)return z<3&&y<28;
    return z<8;
  }
  if(y>=30)return x!==0&&x!==6&&x!==13&&x!==19&&z>0&&z<8;
  return true;
});
export const FIXTURES: Record<string, { label: string; cells: Vec3[];profile?:Profile }> = {
  referenceCLow:{label:'C · 저층 수평 띠와 옥탑',cells:[...box(10,4,6),...shift(box(5,2,3),2,4,1)],profile:'urban-shop'},
  referenceCHigh:{label:'C · 고층 수평 띠와 옥탑',cells:[...box(10,10,6),...shift(box(5,3,3),2,10,1)],profile:'urban-shop'},
  referenceCPortal:{label:'C · 계단형 매스와 높은 개구부',cells:box(11,13,6).filter(([x,y,z])=>
    (x<5&&y<7)||(x>=3&&x<7&&y<10&&z<5)||(x>=3&&y>=10&&z<5)||(x===10&&y<10&&(z===0||z===4))),profile:'urban-shop'},
  referenceA:{label:'A · 수평 띠 트윈 타워',cells:REFERENCE_A_CELLS,profile:'shop'},
  referenceB:{label:'B · 브론즈 커튼월 오피스',cells:box(12,10,9),profile:'office'},
  evenEntrance: {
    label: "Wide frontage · 14칸 외벽",
    cells: box(14, 3, 3),
  },
  symmetryGallery: {
    label: "Facade rhythm · 절대 좌표 반복",
    cells: [...box(6, 4, 4), ...shift(box(5, 4, 4), 9, 0, 0)],
  },
  styleGallery: {
    label: "Style gallery · 1층/2층/본동·별동",
    cells: [
      ...box(4, 1, 3),
      ...shift(box(5, 2, 3), 7, 0, 0),
      ...shift(box(8, 5, 4), 0, 0, 7),
      ...shift(box(3, 2, 4), 8, 0, 7),
    ],
  },
  quarter: { label: "Village quarter · 마을 블록", cells: quarter },
  annex: { label: "Low annex · 낮은 별동", cells: annex },
  facade: { label: "Facade rhythm · 파사드", cells: box(4, 3, 3) },
  coveredTop: {
    label: "Covered terrace · 덮인 상면",
    cells: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
      [1, 0, 0],
      [1, 2, 0],
    ],
  },
  single: { label: "Single cell · 단일 셀", cells: [[0, 0, 0]] },
  adjacent: {
    label: "Adjacent · 인접 셀",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  },
  cube: { label: "Cube · 정육면체", cells: box(2, 2, 2) },
  l: {
    label: "L courtyard · 오목 코너",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
  },
  step: {
    label: "Stepped · 단차",
    cells: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ],
  },
  overhang: {
    label: "Overhang · 돌출부",
    cells: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  sealed: { label: "Sealed cavity · 밀폐 공동", cells: sealed },
  opened: {
    label: "Open cavity · 열린 공동",
    cells: sealed.filter((c) => c.join(",") !== "1,1,0"),
  },
  separated: {
    label: "Separated · 분리 성분",
    cells: [
      [0, 0, 0],
      [0, 1, 0],
      [3, 0, 0],
    ],
  },
  edgeContact: {
    label: "Edge contact · 진단",
    cells: [
      [0, 0, 0],
      [1, 1, 0],
    ],
  },
  vertexContact: {
    label: "Vertex contact · 진단",
    cells: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  },
  terrace: {
    label: "Terrace house · 테라스 하우스",
    cells: box(6, 2, 5).concat(
      box(3, 2, 3).map(([x, y, z]) => [x + 2, y + 2, z + 1] as Vec3),
    ),
  },
};
