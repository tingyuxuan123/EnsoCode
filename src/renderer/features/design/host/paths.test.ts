import { describe, expect, it } from 'vitest';
import { DesignPaths } from './paths';

describe('design authoritative roots', () => {
  const root = { ref: { kind: 'session' as const, sessionId: 's' }, path: '/work/project' };
  it('maps canonical Windows roots, Unicode, most-specific authority and drive roots', () => {
    const paths = new DesignPaths();
    paths.remember({ ...root, path: 'C:/' });
    expect(paths.map('C:/')).toEqual({ root: root.ref, rel: '' });
    expect(paths.map('C:/设计/app.vetd')).toEqual({ root: root.ref, rel: '设计/app.vetd' });
    const nested = { kind: 'project' as const, projectId: 'p' };
    paths.remember({ ref: nested, path: 'C:/设计' });
    expect(paths.map('C:/设计/封面.png')).toEqual({ root: nested, rel: '封面.png' });
    expect(paths.map('C:/设计-other/封面.png')).toEqual({
      root: root.ref,
      rel: '设计-other/封面.png',
    });
    expect(() => paths.map('D:/设计/a')).toThrow();
    paths.remember({ ref: { kind: 'project', projectId: 'd' }, path: 'D:/' });
    expect(paths.map('D:/app.vetd')).toEqual({
      root: { kind: 'project', projectId: 'd' },
      rel: 'app.vetd',
    });
  });
  it.each([
    'c:/设计',
    'C:设计',
    'C:\\设计',
    '//server/share',
    '\\\\server\\share',
    '//?/C:/设计',
    '/C:/设计',
    'C:/设计/../a',
    'C:/设计/./a',
    'C:/设计/a\0',
  ])('rejects noncanonical Windows root %s', (path) => {
    const paths = new DesignPaths();
    expect(() => paths.remember({ ...root, path })).toThrow();
  });
  it('does not map a Windows prefix collision to the pinned project', () => {
    const paths = new DesignPaths();
    paths.remember({ ...root, path: 'C:/设计' });
    expect(() => paths.map('C:/设计-other/a')).toThrow();
  });
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
  it('uses the latest authority for a shared path when a Bot session rotates', () => {
    const paths = new DesignPaths();
    const next = { ...root, ref: { kind: 'session' as const, sessionId: 'new-bot-session' } };
    paths.remember(root);
    paths.remember(next);
    expect(paths.map('/work/project/group.vetd')).toEqual({
      root: next.ref,
      rel: 'group.vetd',
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
