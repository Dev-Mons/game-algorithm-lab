import historical from './fixtures/road-presentation-v1.json';
import {digest,fingerprint} from './concept-preservation-contract';
import type {GenerationDocument} from '../src/core/document';
import type {GenerationResult} from '../src/core/generate';
import type {ScenePlacement} from '../src/core/scene-inputs';

/** Explicit historical comparison, NOT the current semantic-v1 output.
 * Only kind=road placements are substituted, using output extracted from the
 * pre-change commit. Building/object/parking output, order, access and all
 * reservations must still match the untouched 214-case baseline exactly.
 */
export function roadPreservationCheck(document:GenerationDocument,result:GenerationResult){
  const current=fingerprint(document,result);
  if(!document.sceneInputs.roads.length)return {current,preserved:current,changes:[] as string[]};
  const sample=Object.entries(historical.samples).find(([hash])=>hash===digest(document.sceneInputs.roads))?.[1];
  if(!sample)throw new Error('UNKNOWN_HISTORICAL_ROAD_MASK');
  const placements:ScenePlacement[]=sample.placements.map(p=>{
    if(p.kind!=='road'||p.center.length!==3||p.size.length!==3)throw new Error('INVALID_HISTORICAL_ROAD_PLACEMENT');
    return {...p,kind:'road',center:[p.center[0],p.center[1],p.center[2]],size:[p.size[0],p.size[1],p.size[2]]};
  });
  const scene=result.scenePlacements??[],first=scene.findIndex(p=>p.kind==='road'),count=scene.filter(p=>p.kind==='road').length;
  if(first<0||scene.slice(first,first+count).some(p=>p.kind!=='road'))throw new Error('ROAD_OUTPUT_ORDER_CHANGED');
  const original={...result,scenePlacements:[...scene.slice(0,first),...placements,...scene.slice(first+count)]};
  return {current,preserved:fingerprint(document,original),changes:['scenePlacements[kind=road]:road-presentation-v2']};
}
