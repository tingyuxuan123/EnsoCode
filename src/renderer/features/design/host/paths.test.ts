import { describe, expect, it } from 'vitest';
import { DesignPaths } from './paths';

describe('design authoritative roots', () => {
  const root = { ref: { kind: 'session' as const, sessionId: 's' }, path: '/work/project' };
  it('maps exact and nested paths, preferring the most specific root', () => {
    const paths = new DesignPaths();
    paths.remember(root);
    paths.remember({ ref: { kind: 'project', projectId: 'p' }, path: '/work/project/sub' });
    expect(paths.map('/work/project')).toEqual({ root: root.ref, rel: '' });
    expect(paths.map('/work/project/a.vetd/设计.json')).toEqual({
      root: root.ref,
      rel: 'a.vetd/设计.json',
    });
    expect(paths.map('/work/project/sub/a')).toEqual({
      root: { kind: 'project', projectId: 'p' },
      rel: 'a',
    });
  });
  it.each([
    '/work/project-other/a',
    '/etc/passwd',
    '/work/project/../secret',
    '/work/project/./a',
    'relative',
    'ssh://host/work/project/a',
    '/work/project/a\\b',
    '/work/project/a\0b',
  ])('rejects unsafe path %s before IPC', (path) => {
    const paths = new DesignPaths();
    paths.remember(root);
    expect(() => paths.map(path)).toThrow();
  });
});
