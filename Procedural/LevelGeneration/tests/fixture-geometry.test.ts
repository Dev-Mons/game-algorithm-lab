import {expect,it} from 'vitest';
import {FIXTURE_CATALOG,type FixturePrototypeId,transformFixtureBox} from '../src/core/fixture-catalog';
import {buildFixtureGeometry,FixtureGeometryLibrary} from '../src/fixture-geometry';
import {Matrix4,Vector3,Quaternion} from 'three';
it('all real fixture prototypes fit their declared body bounds in every heading',()=>{
  const signatures=new Set<string>();
  for(const id of Object.keys(FIXTURE_CATALOG) as FixturePrototypeId[]){
    const geometry=buildFixtureGeometry(id),positions=geometry.getAttribute('position'),descriptor=FIXTURE_CATALOG[id];
    signatures.add(JSON.stringify(Array.from(positions.array)));
    for(const heading of [0,1,2,3] as const){const bounds=transformFixtureBox(descriptor.bodyBoxes16[0],[-24,16,40],heading),matrix=new Matrix4().compose(new Vector3(-24,16+descriptor.size16[1]/2,40),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),heading*Math.PI/2),new Vector3(...descriptor.size16));
      for(let i=0;i<positions.count;i++){const point=new Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix).toArray();for(let a=0;a<3;a++){expect(point[a],id).toBeGreaterThanOrEqual(bounds.min[a]-1e-5);expect(point[a],id).toBeLessThanOrEqual(bounds.max[a]+1e-5);}}
    }
    geometry.dispose();
  }
  expect(signatures.size).toBeGreaterThanOrEqual(10);
  const library=new FixtureGeometryLibrary();expect(library.get('fixture.bench')).toBe(library.get('fixture.bench'));expect(library.size).toBe(1);library.dispose();
});
