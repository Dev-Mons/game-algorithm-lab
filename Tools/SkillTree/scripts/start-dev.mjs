import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const canonical = path => resolve(path).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const args = process.argv.slice(2);
let firstPort = 4191;
let noOpen = false;

async function isThisProject(url) {
  try {
    const response = await fetch(`${url}__skill_tree_source`, { signal: AbortSignal.timeout(750) });
    const identity = await response.json();
    return identity.app === 'skill-tree-studio' && identity.protocol === 1
      && typeof identity.root === 'string' && canonical(identity.root) === canonical(root);
  } catch {
    return false;
  }
}

async function openBrowser(url) {
  if (noOpen) return;
  const command = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}'`]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Browser opener exited with code ${code}`)));
    });
  } catch (error) {
    console.warn(`[WARNING] ${error.message}. Open ${url} manually.`);
  }
}

async function main() {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--no-open') noOpen = true;
    else if (arg === '--port') firstPort = Number(args[++index]);
    else if (arg.startsWith('--port=')) firstPort = Number(arg.slice(7));
    else throw new Error('Usage: run.bat [--no-open] [--port=4191]');
  }
  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }

  console.log(`[Source] ${root}`);
  for (let port = firstPort; port < Math.min(firstPort + 20, 65536); port++) {
    const url = `http://127.0.0.1:${port}/`;
    if (await isThisProject(url)) {
      console.log(`[Reuse] Skill Tree Studio from this folder is already running.\n[Open] ${url}`);
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
        console.log(`[Busy] ${url} is in use; checking the next port.`);
        continue;
      }
      throw error;
    }

    console.log(`[Started] Skill Tree Studio is ready.\n[Open] ${url}`);
    console.log('Keep this window open while using the app. Press Ctrl+C to stop the server.');
    const stop = async () => { await server.close(); process.exit(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await openBrowser(url);
    return;
  }
  throw new Error('No available port in the next 20 ports. Try run.bat --port=another-number.');
}

main().catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });
