import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argument, coreSourceFiles, verifyFixtures } from './port-support';

const files = coreSourceFiles();
const results = verifyFixtures(argument('fixtures'));
const output = argument('output');
if (output) {
  // Exclusive creation protects prior target results and evidence.
  mkdirSync(dirname(resolve(output)), { recursive: true });
  mkdirSync(resolve(output));
  for (const result of results) writeFileSync(resolve(output, result.name), JSON.stringify(result.output) + '\n', { flag: 'wx' });
}
console.log(`Verified ${results.length} frozen cases exactly; ${files.length} engine-independent source files.${output ? ` Outputs: ${resolve(output)}` : ''}`);
