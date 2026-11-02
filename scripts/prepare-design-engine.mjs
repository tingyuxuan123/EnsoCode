import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '.enso-design-engine-stamp.json';

async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      timeout: 600_000,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`npm ci exited with ${signal ?? code}; check npm/network output above`));
    });
  });
}

/** Install the complete dev-server toolchain, not just the template's production deps. */
export async function prepareDesignEngine({
  engineDir = path.join(root, 'resources', 'design', 'engine'),
  platform = process.env.npm_config_platform || process.platform,
  arch = process.env.npm_config_arch || process.arch,
  runNpm: install = runNpm,
} = {}) {
  if (!/^[a-z0-9_-]+$/.test(platform) || !/^[a-z0-9_-]+$/.test(arch)) {
    throw new Error('Invalid design engine target platform/architecture');
  }
  const lock = await readFile(path.join(engineDir, 'package-lock.json'));
  const stampPath = path.join(engineDir, STAMP);
  const stamp = `${JSON.stringify({
    version: 1,
    sha256: createHash('sha256').update(lock).digest('hex'),
    platform,
    arch,
  })}\n`;
  const modulesExist = await stat(path.join(engineDir, 'node_modules')).then(
    (entry) => entry.isDirectory(),
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (modulesExist && (await readIfPresent(stampPath)) === stamp) return false;

  // A failed npm ci may leave a partial node_modules; it must never inherit an old stamp.
  await rm(stampPath, { force: true });
  const args = [
    'ci',
    '--no-audit',
    '--no-fund',
    '--include=dev',
    `--os=${platform}`,
    `--cpu=${arch}`,
  ];
  // Cross-built esbuild must not run its install-time HOST binary probe (mac x64 on arm64 CI).
  // Its runtime launcher resolves the explicit @esbuild/<target> optional package directly.
  if (platform !== process.platform || arch !== process.arch) args.push('--ignore-scripts');
  await install(args, engineDir);
  if (!(await stat(path.join(engineDir, 'node_modules'))).isDirectory()) {
    throw new Error('npm ci did not create design engine node_modules');
  }
  await writeFile(stampPath, stamp);
  return true;
}

function allows(values, target) {
  if (!Array.isArray(values)) return true;
  if (values.includes(`!${target}`)) return false;
  const positive = values.filter((value) => !value.startsWith('!'));
  return positive.length === 0 || positive.includes(target) || positive.includes('any');
}

/** Prune platform optionals in extraResources before signing; never mutate the source tree. */
export async function stripForeignDesignPackages(modulesDir, platform, arch) {
  const removed = [];
  async function visitModules(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const packageDir = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        await visitModules(packageDir);
        continue;
      }
      const text = await readIfPresent(path.join(packageDir, 'package.json'));
      if (text !== null) {
        const metadata = JSON.parse(text);
        if (!allows(metadata.os, platform) || !allows(metadata.cpu, arch)) {
          await rm(packageDir, { recursive: true, force: true });
          removed.push(path.relative(modulesDir, packageDir));
          continue;
        }
      }
      await visitModules(path.join(packageDir, 'node_modules'));
    }
  }
  await visitModules(modulesDir);
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const installed = await prepareDesignEngine();
    console.log(
      `[design-engine] ${installed ? 'npm ci complete' : 'already prepared (lock/target unchanged)'}`
    );
  } catch (error) {
    console.error(`[design-engine] preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
