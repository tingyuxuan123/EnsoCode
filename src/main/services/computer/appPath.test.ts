import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalAppPath } from './appPath';

describe('canonical app identity paths', () => {
  it('resolves executable symlinks before finding the owning app bundle', () => {
    // macOS /var is a symlink to /private/var; canonical paths must be compared post-realpath.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-app-path-')));
    const app = path.join(root, 'Real.app');
    mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    const executable = path.join(app, 'Contents/MacOS/Real');
    writeFileSync(executable, 'binary');
    const link = path.join(root, 'fake-executable');
    symlinkSync(executable, link);
    expect(canonicalAppPath(link)).toBe(app);
  });
  it('a plain directory is not an executable app; missing paths fail closed', () => {
    // macOS /var is a symlink to /private/var; canonical paths must be compared post-realpath.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-app-path-')));
    expect(canonicalAppPath(root)).toBeNull();
    expect(canonicalAppPath(path.join(root, 'missing'))).toBeNull();
  });
  it('standalone executables bind their canonical file path, not an unrelated app directory', () => {
    // macOS /var is a symlink to /private/var; canonical paths must be compared post-realpath.
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'enso-app-path-')));
    const file = path.join(root, 'python3');
    writeFileSync(file, 'binary');
    expect(canonicalAppPath(file)).toBe(file);
  });
});
