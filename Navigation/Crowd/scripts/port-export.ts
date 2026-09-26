import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { argument, coreSourceFiles, sha256, verifyFixtures } from './port-support';

const fixtures = verifyFixtures();
const sourceFiles = coreSourceFiles();
const output = resolve(argument('output') ?? `test-results/crowd-port-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
const payloads = new Map<string, Buffer>();
const add = (name: string, path: string): void => { payloads.set(name, readFileSync(path)); };
for (const fixture of fixtures) payloads.set(`fixtures/${fixture.name}`, fixture.bytes);
add('fixtures/manifest.json', 'porting/fixtures/manifest.json');
add('contract.json', 'porting/contract.json');
add('check.py', 'porting/check.py');
add('reference/tsconfig.json', 'tsconfig.core.json');
for (const file of sourceFiles) add(`reference/${relative(resolve('.'), file).replaceAll('\\', '/')}`, file);
payloads.set('README.md', Buffer.from(`# Crowd native port reference\n\nRead contract.json first. The reference/src/core/index.ts import closure is a CPU algorithm reference, not a target runtime dependency. Implement it in the engine's native language.\n\nPython 3 standard library only:\n\n    python check.py verify .\n    python check.py compare fixtures/open-goal.json target/open-goal.json\n    python check.py compare-all fixtures target\n\nEach target JSON must use crowd-port-output-v1 with the same case ID, checkpoints, goals, agent order and every agent state field. Default comparison tolerances are absolute 1e-8 and relative 1e-10 for continuous values; IDs, counts, ticks, flow and active flags are exact. Use --atol=0 --rtol=0 for exact numerical comparison. A nonzero exit code means failure.\n\nExpected outputs were frozen before the extraction. Do not regenerate them to accept changed results. Frames are observations, not resumable snapshots.\n`));
const manifest = { schema: 'crowd-port-bundle-v1', files: Object.fromEntries([...payloads].map(([name, bytes]) => [name, sha256(bytes)])) };
// Never overwrite an existing package, even if verification failed on a previous run.
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output);
for (const [name, bytes] of payloads) {
  const target = resolve(output, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
}
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(`Exported ${fixtures.length} frozen cases and ${sourceFiles.length} reference files to ${output}`);
