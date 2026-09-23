import { createServer } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error('Usage: npm run port:export -- [--output NEW_DIRECTORY]');
}
const output = resolve(root, args[1] ?? 'artifacts/native-porting');
// This loader belongs only to the reference exporter, never the target runtime.
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, watch: null, hmr: false },
});
try {
  const { exportPortingBundle } = await server.ssrLoadModule('/tools/porting/export-bundle.ts');
  await exportPortingBundle(root, output);
} finally {
  await server.close();
}
