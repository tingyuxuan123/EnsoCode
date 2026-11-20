import { describe, expect, it } from 'vitest';
import {
  normalizeMemoryArchiveParams,
  normalizeMemoryIndexParams,
  normalizeMemoryReadParams,
  normalizeMemorySearchParams,
  normalizeMemoryUpsertParams,
  parseMemoryArchiveRequest,
  parseMemoryIndexRequest,
  parseMemoryReadRequest,
  parseMemorySearchRequest,
  parseMemoryUpsertRequest,
} from './toolParams';

describe('wiki memory tool param normalization & parsing', () => {
  it('normalizes memory_index params', () => {
    const raw = normalizeMemoryIndexParams({
      spaceId: ' PROJECT ',
      type: '  Incidents ',
      limit: '50',
      includeRaw: 'true',
    });
    expect(parseMemoryIndexRequest(raw)).toEqual({
      spaceId: 'project',
      type: 'incidents',
      limit: 50,
      includeRaw: true,
    });
    expect(parseMemoryIndexRequest(normalizeMemoryIndexParams({}))).toEqual({
      limit: 80,
      includeRaw: false,
    });
  });

  it('normalizes memory_search params with bounds and alias coercion', () => {
    const raw = normalizeMemorySearchParams({
      q: '  OAuth 刷新  ',
      space: 'all',
      category: 'incident',
      status: 'verified',
      limit: 999,
    });
    expect(parseMemorySearchRequest(raw)).toEqual({
      query: 'OAuth 刷新',
      spaceId: 'all',
      type: 'incident',
      status: 'verified',
      limit: 30,
    });
    expect(parseMemorySearchRequest(normalizeMemorySearchParams({ query: '   ' }))).toBeNull();
  });

  it('normalizes memory_read params accepting note/slug/path aliases', () => {
    expect(
      parseMemoryReadRequest(
        normalizeMemoryReadParams({ slug: 'systems/auth', spaceId: 'project' })
      )
    ).toEqual({
      note: 'systems/auth',
      spaceId: 'project',
    });
    expect(parseMemoryReadRequest(normalizeMemoryReadParams({ path: 'wiki/a.md' }))).toEqual({
      note: 'wiki/a.md',
    });
    expect(parseMemoryReadRequest(normalizeMemoryReadParams({}))).toBeNull();
  });

  it('normalizes memory_upsert params: aliases, string tags, section mode, and strips empty optionals', () => {
    const raw = normalizeMemoryUpsertParams({
      slug: 'systems/auth',
      title: ' 认证系统 ',
      category: 'systems',
      summary: ' OAuth 与刷新机制 ',
      body: '正文内容 [[incidents/oauth-refresh]]',
      mode: 'section',
      section: '已知坑点',
      tags: 'auth, oauth, auth',
      sources: 'session:1',
      staleAfter: '2027-05-01',
      resource: '',
    });
    expect(parseMemoryUpsertRequest(raw)).toEqual({
      note: 'systems/auth',
      title: '认证系统',
      type: 'systems',
      description: 'OAuth 与刷新机制',
      content: '正文内容 [[incidents/oauth-refresh]]',
      mode: 'section',
      section: '已知坑点',
      tags: ['auth', 'oauth'],
      sources: ['session:1'],
      staleAfter: '2027-05-01',
    });

    // section mode without section falls back to append cleanly or is rejected if malformed
    const fallback = normalizeMemoryUpsertParams({
      title: 'T',
      content: 'Body',
      mode: 'section',
      section: '   ',
    });
    expect(parseMemoryUpsertRequest(fallback)?.mode).toBe('append');
    expect(
      parseMemoryUpsertRequest(normalizeMemoryUpsertParams({ title: 'Only title' }))
    ).toBeNull();
  });

  it('normalizes memory_archive params', () => {
    const raw = normalizeMemoryArchiveParams({
      slug: 'old-note',
      superseded_by: '[[new-note]]',
      reason: ' 已被新方案替代 ',
      spaceId: 'global',
    });
    expect(parseMemoryArchiveRequest(raw)).toEqual({
      note: 'old-note',
      supersededBy: '[[new-note]]',
      reason: '已被新方案替代',
      spaceId: 'global',
    });
    expect(parseMemoryArchiveRequest(normalizeMemoryArchiveParams({}))).toBeNull();
  });
});
