import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    realpathSync: vi.fn(actual.realpathSync),
  };
});

import { canonicalAppPath } from './appPath';

const tempDirs: string[] = [];

function tempDirectory(): string {
  // macOS /var is a symlink to /private/var; compare real filesystem paths post-realpath.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-app-path-')));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  vi.mocked(realpathSync).mockReset();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('canonical app identity paths', () => {
  it.each(['unbundled', 'Fake.app/Contents/MacOS'])(
    'resolves executable symlinks before finding the owning app bundle: %s',
    (alias) => {
      const root = tempDirectory();
      const app = path.join(root, 'Real.app');
      const binDir = path.join(app, 'Contents/MacOS');
      mkdirSync(binDir, { recursive: true });
      const executable = path.join(binDir, 'Real');
      writeFileSync(executable, 'binary');
      const aliasDir = path.join(root, alias);
      const link = path.join(aliasDir, 'Real');
      if (process.platform === 'win32') {
        // Windows junctions work without file-symlink privilege. Still resolve the real link,
        // but present the executable path with macOS separators for the bundle lookup.
        mkdirSync(path.dirname(aliasDir), { recursive: true });
        symlinkSync(binDir, aliasDir, 'junction');
        vi.mocked(realpathSync).mockImplementationOnce((input) =>
          realpathSync(input).replaceAll('\\', '/')
        );
      } else {
        mkdirSync(aliasDir, { recursive: true });
        symlinkSync(executable, link);
      }
      expect(canonicalAppPath(link)).toBe(app);
    }
  );
  it('a plain directory is not an executable app; missing paths fail closed', () => {
    const root = tempDirectory();
    expect(canonicalAppPath(root)).toBeNull();
    expect(canonicalAppPath(path.join(root, 'missing'))).toBeNull();
  });
  it('standalone executables bind their canonical file path, not an unrelated app directory', () => {
    const root = tempDirectory();
    const file = path.join(root, 'python3');
    writeFileSync(file, 'binary');
    expect(canonicalAppPath(file)).toBe(file);
  });
});
