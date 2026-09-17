import {BoundsIndex} from './reservations';
import { canonicalJSON, cloneJSON, exactKeys,immutableJSON } from "./canonical";
import type { BuildingRuleReference } from "./building-rule-contract";
import type { RuleSpatialAdapter, SpatialAdapterReference, RulePreflightInput, RuleSpatialEnvelope } from "./rule-spatial-contract";
import { cellBox16, mergeBoxes16, containedInUnion, validateBox16, hasSceneAssetBounds,hasFaceAssetBounds } from "./placement-bounds";
import type { Box16 } from "./environment-contract";
import type { Vec3 } from "./analysis";

const registry = new Map<string, RuleSpatialAdapter>();
const key = (ref: SpatialAdapterReference) => `${ref.id}@${ref.version}`;
export function registerRuleSpatialAdapter(adapter: RuleSpatialAdapter) {
  exactKeys(adapter.reference, ["id","version","definition"]);
  if (!/^[a-z][a-z0-9-]*$/.test(adapter.reference.id) || !/^\d+\.\d+\.\d+$/.test(adapter.reference.version) || registry.has(key(adapter.reference))) throw new Error("DUPLICATE_OR_INVALID_SPATIAL_ADAPTER");
  registry.set(key(adapter.reference), {...adapter, reference:cloneJSON(adapter.reference), ruleDefinition:cloneJSON(adapter.ruleDefinition)});
}
export function resolveRuleSpatialAdapter(rule: BuildingRuleReference, reference?: SpatialAdapterReference): RuleSpatialAdapter {
  if (!reference) throw new Error("RULE_SPATIAL_CONTRACT_REQUIRED");
  exactKeys(reference, ["id","version","definition"]);
  const adapter = registry.get(key(reference));
  if (!adapter || adapter.ruleId !== rule.id || adapter.ruleVersion !== rule.version ||
    canonicalJSON(adapter.ruleDefinition) !== canonicalJSON(rule.definition) || canonicalJSON(adapter.reference) !== canonicalJSON(reference)) throw new Error("RULE_SPATIAL_VERSION_MISMATCH");
  return adapter;
}
export function adapterReferenceFor(rule: BuildingRuleReference): SpatialAdapterReference {
  const adapter = [...registry.values()].find(a => a.ruleId === rule.id && a.ruleVersion === rule.version && canonicalJSON(a.ruleDefinition) === canonicalJSON(rule.definition));
  if (!adapter) throw new Error("RULE_SPATIAL_CONTRACT_REQUIRED");
  return cloneJSON(adapter.reference);
}
const ownedAnalyses=new WeakSet<object>(),ownedInputs=new WeakSet<object>();
export function preparePreflightInput(input:RulePreflightInput){immutableJSON(input);ownedInputs.add(input);return input;}
/** Execution owns this detached analysis; adapters share its deeply immutable snapshot. */
export function preparePreflightAnalysis<T extends object>(analysis:T):T {freeze(analysis);ownedAnalyses.add(analysis);return analysis;}
function freeze<T>(value:T):T{return immutableJSON(value);}
/** Caller supplies the union of original input cells, not generated placements. */
export function preflightRule(rule: BuildingRuleReference, reference: SpatialAdapterReference, input: RulePreflightInput, originalCells: Vec3[]): RuleSpatialEnvelope {
  if (Object.hasOwn(input.options,"context")) throw new Error("PREFLIGHT_DOWNSTREAM_CONTEXT_FORBIDDEN");
  const adapter = resolveRuleSpatialAdapter(rule, reference);
  const envelope = cloneJSON(adapter.describeEnvelope(ownedInputs.has(input)?input:freeze(ownedAnalyses.has(input.analysis)?{...cloneJSON({...input,analysis:undefined}),analysis:input.analysis}:cloneJSON(input))));
  exactKeys(envelope, ["version","requiredBoxes16","deferredAttachmentBounds16","supportedAssetKeys","diagnostics"]);
  if (envelope.version !== 1 || !Array.isArray(envelope.requiredBoxes16) || !Array.isArray(envelope.deferredAttachmentBounds16) || !Array.isArray(envelope.supportedAssetKeys) || envelope.supportedAssetKeys.some(k => typeof k !== "string") || !Array.isArray(envelope.diagnostics)) throw new Error("INVALID_RULE_SPATIAL_ENVELOPE");
  for (const d of envelope.diagnostics) { exactKeys(d,["code","message"]); if (typeof d.code !== "string" || typeof d.message !== "string") throw new Error("INVALID_RULE_SPATIAL_ENVELOPE"); }
  const all = [...envelope.requiredBoxes16,...envelope.deferredAttachmentBounds16];
  for (const asset of envelope.supportedAssetKeys) if (!hasSceneAssetBounds(asset)&&!hasFaceAssetBounds(asset)) throw new Error(`RULE_OUTPUT_BOUNDS_UNKNOWN:${asset}`);
  const bounds = [0,2].map(a => {
    let min = Infinity, max = -Infinity;
    for (const c of originalCells) { min = Math.min(min,c[a]); max = Math.max(max,c[a]); }
    return [Math.max(-1000000,min-1)*16, (Math.min(1000000,max+1)+1)*16];
  });
  for (const box of all) {
    validateBox16(box);
    if ([0,2].some((a,i) => box.min[a] < bounds[i][0] || box.max[a] > bounds[i][1])) throw new Error("RULE_SPATIAL_EXTENT_UNSUPPORTED");
  }
  envelope.supportedAssetKeys = [...new Set(envelope.supportedAssetKeys)].sort();
  for (const boxes of [envelope.requiredBoxes16,envelope.deferredAttachmentBounds16]) boxes.sort((a,b) => {
    for (let i=0;i<3;i++) if(a.min[i]!==b.min[i]) return a.min[i]-b.min[i];
    for (let i=0;i<3;i++) if(a.max[i]!==b.max[i]) return a.max[i]-b.max[i];
    return 0;
  });
  return envelope;
}
export function envelopeIndex(envelope:RuleSpatialEnvelope,attachment=false){const index=new BoundsIndex<null>();for(const box of attachment?envelope.deferredAttachmentBounds16:envelope.requiredBoxes16)index.add(box,null);return index;}
export function assertOutputBounds(asset: string, actual: Box16, envelope: RuleSpatialEnvelope, attachment = false,index?:BoundsIndex<null>) {
  if (!envelope.supportedAssetKeys.includes(asset)) throw new Error(`RULE_OUTPUT_BOUNDS_UNKNOWN:${asset}`);
  validateBox16(actual);
  if (!containedInUnion(actual, index?index.query(actual).map(hit=>hit.box):attachment ? envelope.deferredAttachmentBounds16 : envelope.requiredBoxes16)) throw new Error(`RULE_ENVELOPE_VIOLATION:${asset}`);
}
export const PARKING_SPATIAL_REFERENCE: SpatialAdapterReference = { id:"parking-cell-envelope", version:"1.0.0", definition:{bounds:"cell-union-v1",assets:"parking-structure-v1"} };
export const PARKING_RULE_DEFINITION = { structure:"open-decks-v1", slabThickness:0.12, columnWidth:0.12, bayPattern:"grid-stride-v1" };
registerRuleSpatialAdapter({
  reference:PARKING_SPATIAL_REFERENCE, ruleId:"parking",ruleVersion:"1.0.0",ruleDefinition:PARKING_RULE_DEFINITION,
  describeEnvelope(input) { return { version:1,requiredBoxes16:mergeBoxes16(input.cells.map(cellBox16)), deferredAttachmentBounds16:[], supportedAssetKeys:["parking-deck","parking-roof-deck","parking-column","parking-bay"],diagnostics:[] }; },
});
