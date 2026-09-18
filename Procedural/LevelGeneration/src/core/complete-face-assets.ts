import { TRIM_ASSETS } from './banded-facade-assets';
import { FACADE_ASSETS } from './facade-assets';

// Fixed authored finish alternatives. These have no dimensions, Grid or transforms.
// Missing pieces are explicit clearance variants, not geometry clipped to a volume.
const edgeProfiles = (kind: 'cap' | 'belt') => {
  const profiles: string[][] = [];
  for (const strip of ['', 'plain', 'start', 'end', 'both'])
    for (const negative of ['', 'inner-negative', 'outer-negative'])
      for (const positive of ['', 'inner-positive', 'outer-positive']) {
        const keys = [strip, negative, positive].filter(Boolean).map(s => `trim.${kind}.${s}`).sort();
        const boxes = keys.flatMap(k => TRIM_ASSETS[k].boxes16);
        if (boxes.some((a, i) => boxes.slice(0, i).some(b =>
          a.min.every((v, axis) => v < b.max[axis] && b.min[axis] < a.max[axis])))) continue;
        profiles.push(keys);
      }
  return profiles;
};
const profileId = (keys: readonly string[]) => keys.join('+') || 'plain';
export const FACE_FINISH_PROFILES: ReadonlyMap<string, readonly string[]> = new Map(
  edgeProfiles('cap').flatMap(cap => edgeProfiles('belt').map(belt => {
    const keys = [...cap, ...belt].sort();
    return [profileId(keys), Object.freeze(keys)] as const;
  })),
);
const isFace = (key: string) => ['unit-panel', 'crafted.plaster', 'crafted.roof', 'crafted.paving', 'crafted.soffit'].includes(key)
  || Object.hasOwn(FACADE_ASSETS, key) && !['facade.cap', 'facade.cornice'].includes(key);

/** Select a complete prototype from fixed base/finish alternatives. No geometry work. */
export function selectCompleteFaceAsset(baseAssetKey: string, finishAssetKeys: readonly string[] = []): string {
  const profile = profileId([...finishAssetKeys].sort());
  if (!isFace(baseAssetKey) || !FACE_FINISH_PROFILES.has(profile)
    || (profile !== 'plain' && !baseAssetKey.startsWith('facade.') && baseAssetKey !== 'crafted.plaster' && baseAssetKey !== 'unit-panel'))
    throw new Error(`UNKNOWN_COMPLETE_FACE_VARIANT:${baseAssetKey}:${profile}`);
  return `face-v1|${baseAssetKey}|${profile}`;
}

export function completeFaceAsset(assetKey: string) {
  const [version, baseAssetKey, profile, extra] = assetKey.split('|');
  if (version !== 'face-v1' || extra !== undefined || selectCompleteFaceAsset(baseAssetKey, FACE_FINISH_PROFILES.get(profile) ?? ['invalid']) !== assetKey)
    throw new Error('UNKNOWN_COMPLETE_FACE_VARIANT');
  return { baseAssetKey, finishAssetKeys: FACE_FINISH_PROFILES.get(profile)! };
}
