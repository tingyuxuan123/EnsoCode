import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildWikiGraph,
  buildWikiTree,
  listIndexedNotes,
  openIndexDb,
  resolveNoteRef,
  searchIndexedNotes,
  syncSpaceIndex,
} from './indexDb';
import { writeNoteAtomic } from './vault';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-index-db-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('disposable SQLite wiki index', () => {
  it('indexes markdown files, resolves wikilinks, supports CJK FTS5 + short LIKE, and rebuilds cleanly if deleted', () => {
    const work = tmpDir();
    const vault = path.join(work, 'vault');
    const dbPath = path.join(work, 'index.db');

    writeNoteAtomic(
      vault,
      'wiki/systems/auth.md',
      [
        '---',
        'type: systems',
        'title: 认证与令牌刷新',
        'description: OAuth PKCE 与 Worker 刷新边界',
        'status: verified',
        'tags: [oauth, mcp]',
        '---',
        '',
        '遇到刷新死锁时见 [[incidents/oauth-refresh]] 和 [[missing-note]]。',
      ].join('\n')
    );
    writeNoteAtomic(
      vault,
      'wiki/incidents/oauth-refresh.md',
      [
        '---',
        'type: incidents',
        'title: MCP 反复要求授权',
        'description: worker 刷新令牌后未持久化导致重复授权',
        'status: draft',
        'tags: [mcp]',
        '---',
        '',
        '根因在 [[systems/auth|认证系统]] 的主库写回缺失。',
      ].join('\n')
    );

    const db = openIndexDb(dbPath);
    try {
      const stats = syncSpaceIndex(db, 'proj:demo', vault);
      expect(stats.indexed).toBe(2);

      // >=3 char Chinese FTS5 trigram
      const hits1 = searchIndexedNotes(db, {
        spaceIds: ['proj:demo'],
        query: '令牌刷新',
        limit: 5,
      });
      expect(hits1.length).toBeGreaterThanOrEqual(1);
      expect(hits1[0].slug).toBe('systems/auth');
      expect(hits1[0].neighbors.some((n) => n.slug === 'incidents/oauth-refresh')).toBe(true);

      // <3 char Chinese LIKE fallback
      const hits2 = searchIndexedNotes(db, { spaceIds: ['proj:demo'], query: '主库', limit: 5 });
      expect(hits2.map((h) => h.slug)).toContain('incidents/oauth-refresh');

      // Type and status filters
      const list = listIndexedNotes(db, {
        spaceId: 'proj:demo',
        type: 'incidents',
        status: 'draft',
        limit: 20,
        offset: 0,
      });
      expect(list.total).toBe(1);
      expect(list.items[0].slug).toBe('incidents/oauth-refresh');
      expect(list.items[0].inboundCount).toBe(1);

      // Resolution by slug, basename, and title
      expect(resolveNoteRef(db, ['proj:demo'], 'oauth-refresh')?.relPath).toBe(
        'wiki/incidents/oauth-refresh.md'
      );
      expect(resolveNoteRef(db, ['proj:demo'], '认证与令牌刷新')?.relPath).toBe(
        'wiki/systems/auth.md'
      );

      // Graph & Tree
      const graph = buildWikiGraph(db, { spaceId: 'proj:demo', limit: 50 });
      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(2); // mutual wikilinks

      const tree = buildWikiTree(db, { spaceId: 'proj:demo', groupBy: 'type', limitPerGroup: 20 });
      expect(tree.map((g) => g.label).sort()).toEqual(['incidents', 'systems']);
    } finally {
      db.close();
    }

    // Delete index.db completely → rebuilds identically from Markdown SoT
    fs.rmSync(dbPath, { force: true });
    const rebuilt = openIndexDb(dbPath);
    try {
      syncSpaceIndex(rebuilt, 'proj:demo', vault);
      const list = listIndexedNotes(rebuilt, { spaceId: 'proj:demo', limit: 20, offset: 0 });
      expect(list.total).toBe(2);
    } finally {
      rebuilt.close();
    }
  });
});
