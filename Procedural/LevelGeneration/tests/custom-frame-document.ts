import {createDocument as create, type Profile} from '../src/core/document';
import {urbanStyle} from '../src/core/building-style';

// Test the general multi-floor grammar with an explicit custom definition,
// independently of the three selectable building concepts.
export function createDocument(
  grid:Parameters<typeof create>[0],seed=0,profile:Profile|'urban-office'='office',
  definition?:Parameters<typeof create>[3],buildings?:Parameters<typeof create>[4],
  scene?:Parameters<typeof create>[5],
){
  return create(grid,seed,profile==='urban-office'?'office':profile,
    definition??(profile==='urban-office'?urbanStyle('office'):undefined),buildings,scene);
}
