import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { parseCrowdRun, runCrowdReplay, type CrowdRunOutput } from '../src/core/port-contract';

export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const argument = (name: string): string | undefined => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Read-only frozen oracle. Never recompute or overwrite expected results. */
export function verifyFixtures(directory = 'porting/fixtures') {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as {
    schema: string; files: Record<string, string>;
  };
  if (manifest.schema !== 'crowd-port-manifest-v1') throw new Error('Unknown fixture manifest.');
  const files = Object.keys(manifest.files).sort();
  const actual = readdirSync(directory).filter(name => name.endsWith('.json') && name !== 'manifest.json').sort();
  if (!isDeepStrictEqual(files, actual)) throw new Error('Fixture inventory differs from the manifest.');
  return files.map(name => {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error('Invalid fixture name.');
    const bytes = readFileSync(resolve(directory, name));
    if (sha256(bytes) !== manifest.files[name]) throw new Error(`Fixture integrity failure: ${name}`);
    const fixture = JSON.parse(bytes.toString('utf8')) as { expected: CrowdRunOutput };
    const run = parseCrowdRun(fixture);
    const output = runCrowdReplay(run);
    if (!isDeepStrictEqual(output, fixture.expected)) throw new Error(`Reference differs from frozen fixture: ${name}. Do not refresh the baseline.`);
    return { name, bytes, output };
  });
}

/** Include the actual import closure, retaining relative paths for inspection. */
export function coreSourceFiles(): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const name = relative(resolve('.'), file).replaceAll('\\', '/');
    if (!/^src\/(core|algorithms\/(flow-field|spatial-hash))\//.test(name)
      || /\/(simulation|spawn-layout|random|fixed-clock|lab-results)\.ts$/.test(name)) {
      throw new Error(`Non-core dependency: ${name}`);
    }
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const dependency of ts.preProcessFile(source, true, true).importedFiles) {
      if (!dependency.fileName.startsWith('.')) throw new Error(`External core dependency: ${dependency.fileName}`);
      visit(resolve(dirname(file), `${dependency.fileName}.ts`));
    }
  };
  visit(resolve('src/core/index.ts'));
  return [...seen].sort();
}
