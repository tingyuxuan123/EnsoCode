import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { designResourcePaths } from './paths';

describe('designResourcePaths', () => {
  it('reads bundled resources from resourcesPath when packaged', () => {
    const paths = designResourcePaths({
      packaged: true,
      resourcesPath: '/App/Contents/Resources',
      appPath: '/ignored',
      userDataPath: '/Users/u/Library/Application Support/EnsoCode',
    });
    expect(paths.resourceRoot).toBe(path.join('/App/Contents/Resources', 'design'));
    expect(paths.engineTemplate).toBe(path.join('/App/Contents/Resources', 'design', 'engine'));
    expect(paths.skillsDir).toBe(path.join('/App/Contents/Resources', 'design', 'skills'));
    expect(paths.historyRunner).toBe(
      path.join('/App/Contents/Resources', 'design', 'history-runner', 'runner.mjs')
    );
  });

  it('reads from the checkout resources folder in development', () => {
    const paths = designResourcePaths({
      packaged: false,
      resourcesPath: '/electron/Resources',
      appPath: '/repo',
      userDataPath: '/data',
    });
    expect(paths.resourceRoot).toBe(path.join('/repo', 'resources', 'design'));
  });

  it('keeps writable state under userData, never under resources', () => {
    const paths = designResourcePaths({
      packaged: true,
      resourcesPath: '/R',
      appPath: '/A',
      userDataPath: '/data',
    });
    expect(paths.engineBase).toBe(path.join('/data', 'design', 'engine'));
    expect(paths.storageDir).toBe(path.join('/data', 'design', 'data'));
  });
});
