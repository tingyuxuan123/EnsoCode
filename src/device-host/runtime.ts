// Where the device host finds the programs it runs: npm packages it loads at runtime, the helpers
// shipped in the app's resources, and the Node.js it runs them with.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { isExecutableFile } from './find-command';

// The host runs as an ESM bundle: `__filename` is absent there, and the paths a CommonJS
// `require` would report point at the bundle rather than the app. Main passes its own entry
// so the lookup starts where the app's node_modules actually are.
const require = createRequire(process.env.ENSO_APP_REQUIRE_FROM || __filename);

/** Packaged apps keep native modules and executables outside the archive, where they can run. */
export function unpacked(file: string): string {
  return file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/**
 * The root folder of an installed npm package, found where Node.js would look for it, since a
 * package's `exports` may give `require` nothing to resolve.
 */
export function packageRoot(name: string): string {
  const fromApp = process.env.ENSO_APP_REQUIRE_FROM;
  const roots = [
    // The app root itself: development is the repository, packaged is .../Resources/app.asar.
    ...(fromApp
      ? [
          path.join(fromApp, 'node_modules'),
          path.join(fromApp, '..', 'app.asar.unpacked', 'node_modules'),
        ]
      : []),
    ...(require.resolve.paths(name) ?? []),
    // Packaged: node_modules sits beside the app's resources; development: at the repo root.
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked', 'node_modules'),
    path.join(process.resourcesPath ?? '', 'app', 'node_modules'),
    path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules'),
  ].filter((dir) => dir.length > 0);
  for (const dir of roots) {
    const root = path.join(dir, name);
    if (existsSync(path.join(root, 'package.json'))) return unpacked(root);
  }
  throw new Error(`${name} is not installed with Kettu`);
}

/** How to run a Node.js script: this process's own runtime, as Node.js under Electron. */
export function nodeCommand(env: NodeJS.ProcessEnv): { file: string; env: NodeJS.ProcessEnv } {
  if (process.versions.electron) {
    return { file: process.execPath, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { file: process.execPath, env };
}

/** A loopback port nothing listens on now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

/**
 * A helper Kettu builds: from the app's resources when packaged, from `out/helpers` in
 * development. Null when it is not there, as on a platform it is not built for.
 */
export async function helperPath(
  name: string,
  resourcesPath: string | null
): Promise<string | null> {
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, 'helpers', name)] : []),
    // Beside the bundle under `out/`: the daemon's `out/daemon`, or the app's `out/main/chunks`.
    path.resolve(__dirname, '..', 'helpers', name),
    path.resolve(__dirname, '..', '..', 'helpers', name),
  ];
  for (const file of candidates) {
    if (await isExecutableFile(file, process.platform)) return file;
  }
  return null;
}
