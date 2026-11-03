import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit maintainer action only: never downloads on app startup/build/install.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources/design/history-runner/source');
const temp = await mkdtemp(path.join(os.tmpdir(), 'enso-design-runner-'));
function run(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: 'inherit', timeout: 600000 });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${file} exited ${signal ?? code}`))
    );
  });
}
try {
  await cp(path.join(source, 'build-tools.package.json'), path.join(temp, 'package.json'));
  const lockFile = path.join(source, 'build-tools.package-lock.json');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  // The original snapshot's lock was emitted while its build-tools directory was
  // linked from a temporary workspace. Relocate keys, preserving versions/hashes.
  lock.packages = Object.fromEntries(
    Object.entries(lock.packages).map(([key, value]) => {
      if (key === '' || key.startsWith('node_modules/')) return [key, value];
      const index = key.indexOf('/node_modules/');
      if (index < 0) throw new Error(`Unexpected runner lock path: ${key}`);
      return [key.slice(index + 1), value];
    })
  );
  if (String(lock.version).startsWith('file:')) delete lock.version;
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(path.join(temp, 'package-lock.json'), lockText);
  await mkdir(path.join(temp, 'history-runner/src'), { recursive: true });
  await cp(
    path.join(source, 'runner-entry.ts'),
    path.join(temp, 'history-runner/src/runner-entry.ts')
  );
  await cp(
    path.join(root, 'src/shared/design/archive.ts'),
    path.join(temp, 'history-runner/src/archive.ts')
  );
  await cp(path.join(source, 'vite.runner.config.ts'), path.join(temp, 'vite.runner.config.ts'));
  await run(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['ci', '--no-audit', '--no-fund'],
    temp
  );
  await writeFile(lockFile, lockText);
  await run(
    process.execPath,
    [
      path.join(temp, 'node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      'vite.runner.config.ts',
    ],
    temp
  );
  const bytes = await readFile(path.join(temp, 'history-runner/dist/runner.mjs'));
  await writeFile(path.join(root, 'resources/design/history-runner/runner.mjs'), bytes);
  // Package the preferred decoder source too, so rebuilding the standalone LGPL
  // combined artifact does not require fetching the application's source tree.
  await cp(path.join(root, 'src/shared/design/archive.ts'), path.join(source, 'archive.ts'));
  console.log(`runner SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
