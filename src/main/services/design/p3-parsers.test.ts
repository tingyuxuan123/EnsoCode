import { expect, it } from 'vitest';
import { parseOpenFiles, parsePreview, parseProjects } from './parsers';

it('accepts only identifier-scoped gallery requests, never arbitrary project paths', () => {
  expect(parseProjects({ op: 'list' })).toEqual({ op: 'list' });
  expect(parseProjects({ op: 'create', name: 'Weekend' })).toEqual({
    op: 'create',
    name: 'Weekend',
  });
  expect(parseProjects({ op: 'setArchived', projectId: 'p', archived: true })).toEqual({
    op: 'setArchived',
    projectId: 'p',
    archived: true,
  });
  for (const raw of [
    null,
    { op: 'list', path: '/evil' },
    { op: 'create', name: '../x' },
    { op: 'create', name: '.' },
    { op: 'setArchived', projectId: 'p', archived: 1 },
  ])
    expect(parseProjects(raw)).toBeNull();
});
it('native file picker accepts only design extensions and bounded read options', () => {
  expect(parseOpenFiles({})).toEqual({});
  expect(
    parseOpenFiles({ filters: [{ name: 'Design', extensions: ['vetdz', 'vetd'] }] })
  ).not.toBeNull();
  for (const raw of [
    null,
    { path: '/etc/passwd' },
    { maxBytes: 33 * 1024 * 1024 },
    { multiple: 1 },
    { filters: [{ name: 'Any', extensions: ['*'] }] },
    { filters: [{ name: 'JavaScript', extensions: ['js'] }] },
  ])
    expect(parseOpenFiles(raw)).toBeNull();
});
it('preview input is bounded content or an opaque id, not URLs or file paths', () => {
  expect(parsePreview({ op: 'open', html: '<h1>test</h1>' })).toEqual({
    op: 'open',
    html: '<h1>test</h1>',
  });
  expect(parsePreview({ op: 'close', previewId: 'id' })).toEqual({ op: 'close', previewId: 'id' });
  for (const raw of [
    null,
    { op: 'open', url: 'file:///tmp/x' },
    { op: 'open', html: 2 },
    { op: 'close', previewId: '' },
    { op: 'open', html: 'x', path: '/evil' },
  ])
    expect(parsePreview(raw)).toBeNull();
});
