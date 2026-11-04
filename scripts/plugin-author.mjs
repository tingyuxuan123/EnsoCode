import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = await mkdtemp(join(tmpdir(), 'enso-plugin-author-vite-'));
let vite;
try {
  vite = await createServer({
    root,
    cacheDir,
    configFile: false,
    envFile: false,
    publicDir: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    resolve: { alias: { '@shared': join(root, 'src/shared') } },
  });
  // Fixed repository entry. User paths only ever reach the filesystem validator.
  const { runPluginAuthor } = await vite.ssrLoadModule('/src/tooling/pluginAuthor.ts');
  process.exitCode = await runPluginAuthor(process.argv.slice(2), {
    repositoryRoot: root,
    stdout: console.log,
    stderr: console.error,
  });
} finally {
  try {
    await vite?.close();
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
}
