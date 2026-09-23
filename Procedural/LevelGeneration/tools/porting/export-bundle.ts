import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { conceptPreservationCases } from '../../tests/concept-preservation-fixtures';
import { digest, fingerprint, meaningfulResult } from '../../tests/concept-preservation-contract';
import { generateDocument } from '../../src/core/generate-document';
import { BUILDING_PROFILES, SETTINGS, type GenerationDocument } from '../../src/core/document';
import { canonicalJSON } from '../../src/core/canonical';
import { BASES, DIRECTIONS } from '../../src/core/analysis';
import { ENVIRONMENT, PARKING_BUDGET } from '../../src/core/environment-settings';
import { FACADE_ASSETS } from '../../src/core/facade-assets';
import { TRIM_ASSETS } from '../../src/core/banded-facade-assets';
import { FACE_FINISH_PROFILES } from '../../src/core/complete-face-assets';
import { CRAFTED_RULES } from '../../src/core/modules';
import { facadeColors, facadeFinish } from '../../src/facade-finishes';
import { buildCraftedGeometry, FACE_MATERIAL_SLOTS } from '../../src/crafted-geometry';

const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface FileRecord {
  sha256: string;
  bytes: number;
}
interface ResourceRef {
  $ref: string;
}
type Baseline = {
  sourceCommit: string;
  projection: string;
  rows: Record<string, ReturnType<typeof fingerprint>>;
  geometry: Record<string, string>;
};

/** Export a read-only handoff. A failed export deliberately has no manifest. */
export async function exportPortingBundle(root: string, output: string): Promise<void> {
  const baselineBytes = await readFile(join(root, 'benchmarks/concept-preservation-baseline.json'));
  const baseline = JSON.parse(baselineBytes.toString('utf8')) as Baseline;
  const cases = conceptPreservationCases();
  if (
    !isDeepStrictEqual(
      cases.map((c) => c.id),
      Object.keys(baseline.rows),
    )
  ) {
    throw new Error('PORTING_CASE_SET_DIFFERS_FROM_BASELINE');
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // No overwriting, including partial or earlier exports.
  const files: Record<string, FileRecord> = {};
  const resources = new Map<string, unknown>();
  async function put(path: string, bytes: string | Uint8Array): Promise<string> {
    const buffer = Buffer.from(bytes);
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), buffer, { flag: 'wx' });
    files[path] = { sha256: sha256(buffer), bytes: buffer.length };
    return path;
  }
  const json = (path: string, value: unknown) => put(path, canonicalJSON(value));
  async function resource(value: unknown): Promise<ResourceRef> {
    const bytes = canonicalJSON(value),
      path = `data/${sha256(bytes)}.json`;
    if (!files[path]) {
      await put(path, bytes);
      resources.set(path, JSON.parse(bytes));
    }
    return { $ref: path };
  }
  function expand(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') {
      const fields = value as Record<string, unknown>;
      if (Object.keys(fields).length === 1 && typeof fields.$ref === 'string') {
        if (!resources.has(fields.$ref)) throw new Error(`UNKNOWN_PORTING_RESOURCE:${fields.$ref}`);
        return expand(resources.get(fields.$ref));
      }
      return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, expand(item)]));
    }
    return value;
  }
  async function portableDocument(document: GenerationDocument) {
    const buildings = [];
    for (const building of document.buildings) {
      buildings.push({ ...building, ...(building.theme ? { theme: await resource(building.theme) } : {}) });
    }
    return {
      ...document,
      buildings,
      buildingDefinition: await resource(document.buildingDefinition),
      catalog: await resource(document.catalog),
    };
  }

  const styles: Record<string, ResourceRef> = {};
  for (const [id, style] of Object.entries(BUILDING_PROFILES)) styles[id] = await resource(style);
  const data = {
    styles,
    constants: await json('data/constants.json', {
      settings: SETTINGS,
      environment: ENVIRONMENT,
      parkingBudget: PARKING_BUDGET,
      directions: DIRECTIONS,
      faceBases: BASES,
      faceMaterialSlots: FACE_MATERIAL_SLOTS,
    }),
    selectionRules: await json('data/selection-rules.json', CRAFTED_RULES),
    facadeDescriptors: await json('data/facade-descriptors.json', FACADE_ASSETS),
    trimDescriptors: await json('data/trim-descriptors.json', TRIM_ASSETS),
    finishProfiles: await json('data/finish-profiles.json', Object.fromEntries(FACE_FINISH_PROFILES)),
    materials: await json(
      'data/materials.json',
      Object.fromEntries(
        Object.keys(FACADE_ASSETS).map((key) => {
          const finish = facadeFinish(key);
          return [
            key,
            {
              finish,
              palettes: Object.fromEntries(
                ['clay', 'sage', 'sand'].map((palette) => [
                  palette,
                  facadeColors(finish, palette as 'clay' | 'sage' | 'sand'),
                ]),
              ),
            },
          ];
        }),
      ),
    ),
  };

  const fixtures = [],
    meshKeys = new Set<string>();
  for (const { id, document } of cases) {
    const result = generateDocument(document, { cache: false });
    const actual = fingerprint(document, result);
    if (!isDeepStrictEqual(actual, baseline.rows[id])) throw new Error(`PORTING_BASELINE_MISMATCH:${id}`);
    const input = await portableDocument(document);
    if (canonicalJSON(expand(input)) !== canonicalJSON(document)) {
      throw new Error(`PORTING_INPUT_ROUNDTRIP_MISMATCH:${id}`);
    }
    const inputFile = await json(`cases/${id}/input.json`, {
      format: 'native-port-input-v1',
      document: input,
    });
    const expectedFile = await json(`cases/${id}/expected.json`, meaningfulResult(result));
    // Stage diagnostics are explanatory. Their internal representation is not golden.
    const referenceFile = await json(`cases/${id}/reference.json`, {
      vertical: result.environment!.vertical,
      columns: result.environment!.columns,
      facades: result.environment!.facades,
      traces: result.environment!.traces,
    });
    fixtures.push({
      id,
      input: inputFile,
      expected: expectedFile,
      reference: referenceFile,
      baseline: actual,
    });
    for (const placement of result.placements)
      if (placement.faceAssetKey) meshKeys.add(placement.faceAssetKey);
    if (fixtures.length % 32 === 0)
      console.log(`Validated/exported ${fixtures.length}/${cases.length} cases`);
  }
  if (!isDeepStrictEqual([...meshKeys].sort(), Object.keys(baseline.geometry).sort())) {
    throw new Error('PORTING_GEOMETRY_SET_DIFFERS_FROM_BASELINE');
  }
  const meshes = [];
  for (const key of [...meshKeys].sort()) {
    const geometry = buildCraftedGeometry(key);
    try {
      const raw = {
        groups: geometry.groups,
        index: Array.from(geometry.index!.array),
        attributes: Object.fromEntries(
          Object.entries(geometry.attributes).map(([name, attribute]) => [
            name,
            { itemSize: attribute.itemSize, array: Array.from(attribute.array) },
          ]),
        ),
      };
      if (digest(raw) !== baseline.geometry[key]) throw new Error(`PORTING_GEOMETRY_MISMATCH:${key}`);
      geometry.computeBoundingBox();
      const path = await json(`meshes/${sha256(key)}.json`, {
        format: 'native-face-mesh-v1',
        key,
        geometry: raw,
        bounds: { min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray() },
      });
      meshes.push({ key, path, baselineSha256: baseline.geometry[key] });
    } finally {
      geometry.dispose();
    }
  }
  await put('hash-vectors.json', await readFile(join(root, 'fixtures/hash-vectors.json')));
  await put('check.py', await readFile(join(root, 'porting/check.py')));
  await put('START_HERE.md', await readFile(join(root, 'docs/NATIVE_PORTING.md')));
  for (const name of ['NATIVE_PORTING.md', 'BUILDING_RULES_PORTING.md', 'PORTING_CONTRACT.md', 'COMPLETE_FACE_ASSETS.md']) {
    await put(`spec/${name}`, await readFile(join(root, 'docs', name)));
  }
  for (const name of await readdir(join(root, 'porting/schemas'))) {
    await put(`schemas/${name}`, await readFile(join(root, 'porting/schemas', name)));
  }
  const sourceFiles: Record<string, string> = {};
  for (const directory of ['src', 'tests', 'tools/porting']) {
    for (const entry of await readdir(join(root, directory), { recursive: true })) {
      if (!/\.(ts|mjs)$/.test(entry)) continue;
      const path = `${directory}/${entry.replaceAll('\\', '/')}`;
      sourceFiles[path] = sha256(await readFile(join(root, path)));
    }
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const manifest = {
    format: 'native-building-port-v1',
    projection: baseline.projection,
    source: { commit: sourceCommit, files: sourceFiles },
    baseline: { sourceCommit: baseline.sourceCommit, sha256: sha256(baselineBytes) },
    coverage: {
      cases: fixtures.length,
      meshes: meshes.length,
      meshScope:
        'complete face assets used by these fixtures; scene object meshes and other variants excluded',
      materialScope: 'facade palette colors; browser-generated textures and lighting excluded',
    },
    data,
    fixtures,
    meshes,
    files,
  };
  await writeFile(join(output, 'manifest.json'), canonicalJSON(manifest), { flag: 'wx' });
  console.log(
    `Export complete: ${fixtures.length} baseline-matched cases, ${meshes.length} meshes: ${output}`,
  );
}
