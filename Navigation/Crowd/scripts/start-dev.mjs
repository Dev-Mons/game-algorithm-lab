import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Anchor to this checkout, even when run.bat is opened from another directory.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const firstPort = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 4273);
const noOpen = args.includes('--no-open');
const canonical = path => resolve(path).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

async function isThisProject(url) {
  try {
    const response = await fetch(`${url}__crowd_source`, { signal: AbortSignal.timeout(750) });
    const identity = await response.json();
    return identity.app === 'crowd-navigation-lab' && identity.protocol === 1
      && typeof identity.root === 'string' && canonical(identity.root) === canonical(root);
  } catch {
    return false;
  }
}

async function openBrowser(url) {
  if (noOpen) return;
  // URL is constructed only from loopback + a validated numeric port.
  const command = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}'`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command[1], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let detail = '';
    child.stderr.on('data', chunk => { detail = (detail + chunk).slice(-2000); });
    const failed = reason => new Error(`Browser could not be opened: ${reason}\nOpen ${url} manually.`);
    child.once('error', error => reject(failed(error.message)));
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(failed(detail.trim() || `opener exited with code ${code}`));
    });
  });
}

async function main() {
  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65535
    || args.some(arg => arg !== '--no-open' && !arg.startsWith('--port='))) {
    throw new Error('Usage: run.bat [--no-open] [--port=4273]');
  }
  console.log(`\n[Source] ${root}`);
  for (let port = firstPort; port < Math.min(firstPort + 20, 65536); port++) {
    const url = `http://127.0.0.1:${port}/`;
    if (await isThisProject(url)) {
      console.log(`[Reuse] Same source folder is already running.\n[Open] ${url}`);
      await openBrowser(url);
      return;
    }
    const server = await createServer({
      root, configFile: resolve(root, 'vite.config.ts'),
      server: { host: '127.0.0.1', port, strictPort: true, open: false },
    });
    try {
      await server.listen();
    } catch (error) {
      await server.close();
      if (error.code === 'EADDRINUSE' || /Port \d+ is already in use/.test(error.message)) {
        console.log(`[Busy] ${url} belongs to another server; checking the next port.`);
        continue;
      }
      throw error;
    }
    console.log(`[Started] This source folder is ready.\n[Open] ${url}`);
    const stop = async () => { await server.close(); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await openBrowser(url);
    return;
  }
  throw new Error('No available port in the next 20 ports. Try run.bat --port=another-number.');
}

main().catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });
