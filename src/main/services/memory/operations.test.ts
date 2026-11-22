import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultBindingStore } from './bindings';
import { listIndexedNotes, openIndexDb, syncSpaceIndex } from './indexDb';
import { markNoteVerified, resolveTargetRelPath, upsertWikiNote } from './operations';
import { readNoteFile, writeNoteAtomic } from './vault';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-ops-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('status page identity', () => {
  it('keeps exactly one status page per space at wiki/status.md', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      expect(resolveTargetRelPath(db, 'proj:p1', undefined, '项目状态', 'status').relPath).toBe(
        'wiki/status.md'
      );

      const first = await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '项目状态',
        type: 'status',
        description: '当前进展与卡点',
        content: 'As of 2026-06-01\n\n- 正在做：记忆就地重写',
        mode: 'replace',
        actor: 'user',
      });
      expect(first.relPath).toBe('wiki/status.md');

      const second = await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '本周进展',
        type: 'status',
        description: '当前进展与卡点',
        content: 'As of 2026-06-02\n\n- 正在做：status 页',
        mode: 'replace',
        actor: 'user',
      });
      expect(second.action).toBe('updated');
      expect(second.relPath).toBe('wiki/status.md');

      const listed = listIndexedNotes(db, { spaceId: 'proj:p1', limit: 10, offset: 0 });
      expect(listed.items.filter((n) => n.type === 'status')).toHaveLength(1);
      expect(listed.items[0].slug).toBe('status');

      // 状态页永远整篇覆盖：append 不能制造两段互相矛盾的“现在”
      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '项目状态',
        type: 'status',
        description: '当前进展与卡点',
        content: 'As of 2026-06-03\n\n- 正在做：状态页覆盖',
        mode: 'append',
        actor: 'collabra-compiler',
        status: 'draft',
      });
      const space = bindings.resolveSpace('proj:p1');
      const raw = readNoteFile(space.rootPath, 'wiki/status.md') ?? '';
      expect(raw).toContain('As of 2026-06-03');
      expect(raw).not.toContain('2026-06-01');

      // 显式给目录也不能绕过“每空间一篇”
      expect(
        resolveTargetRelPath(db, 'proj:p1', 'notes/other-status', '别的状态', 'status').relPath
      ).toBe('wiki/status.md');
    } finally {
      db.close();
    }
  });

  it('reuses the on-disk spelling of the status page so a case-insensitive disk keeps one file', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const space = bindings.resolveSpace('proj:p1');
      writeNoteAtomic(
        space.rootPath,
        'wiki/Status.md',
        [
          '---',
          'type: status',
          'title: 项目状态',
          'description: 当前进展',
          'status: verified',
          '---',
          '',
          'As of 2026-06-01',
        ].join('\n')
      );
      syncSpaceIndex(db, 'proj:p1', space.rootPath);

      expect(resolveTargetRelPath(db, 'proj:p1', undefined, '项目状态', 'status').relPath).toBe(
        'wiki/Status.md'
      );
    } finally {
      db.close();
    }
  });
});

describe('model-side verification', () => {
  it('flips status and records who verified, leaving the body untouched', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const written = await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '缓存策略',
        type: 'systems',
        description: '本地缓存',
        content: '## 策略\n\n使用 LRU。',
        mode: 'replace',
        actor: 'collabra-compiler',
        status: 'draft',
      });
      expect(written.status).toBe('draft');

      await expect(
        markNoteVerified(db, bindings, {
          spaceId: 'proj:p1',
          relPath: written.relPath,
          by: 'collabra-verifier',
        })
      ).resolves.toBe(true);

      const space = bindings.resolveSpace('proj:p1');
      const raw = readNoteFile(space.rootPath, written.relPath) ?? '';
      expect(raw).toContain('status: verified');
      expect(raw).toContain('collabra-verifier');
      expect(raw).toContain('## 策略\n\n使用 LRU。');

      // 已归档/废弃的页面不会被核验翻回 verified
      await expect(
        markNoteVerified(db, bindings, {
          spaceId: 'proj:p1',
          relPath: 'wiki/systems/never-written.md',
          by: 'collabra-verifier',
        })
      ).resolves.toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('content-preserving write guards', () => {
  it('refuses to repurpose an ordinary note sitting at the status path', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        note: 'status',
        title: '状态机设计',
        type: 'systems',
        description: '关于状态机的笔记',
        content: '这是普通主题笔记。',
        mode: 'replace',
        actor: 'user',
      });

      await expect(
        upsertWikiNote(db, bindings, {
          spaceId: 'proj:p1',
          title: '项目状态',
          type: 'status',
          description: '当前进展',
          content: 'As of 2026-06-01',
          mode: 'replace',
          actor: 'user',
        })
      ).rejects.toThrow(/already holds/);

      const space = bindings.resolveSpace('proj:p1');
      expect(readNoteFile(space.rootPath, 'wiki/status.md')).toContain('这是普通主题笔记。');
    } finally {
      db.close();
    }
  });

  it('downgrades replace to append when the body changed under the writer', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        note: 'systems/cache',
        title: '缓存策略',
        type: 'systems',
        description: '本地缓存',
        content: '旧结论：使用 LRU。',
        mode: 'replace',
        actor: 'user',
      });

      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        note: 'systems/cache',
        title: '缓存策略',
        type: 'systems',
        description: '本地缓存',
        content: '旧结论：使用 LRU。\n\n新结论：改用 FIFO。',
        mode: 'replace',
        actor: 'collabra-compiler',
        status: 'draft',
        expectedBodyHash: 'stale-hash-from-before-the-external-edit',
        conflictFallbackContent: '新结论：改用 FIFO。',
      });

      const space = bindings.resolveSpace('proj:p1');
      const raw = readNoteFile(space.rootPath, 'wiki/systems/cache.md') ?? '';
      expect(raw).toContain('旧结论');
      expect(raw).toContain('新结论');
      // 只追加增量：整页重写结果不能被追加进来，否则旧结论被写回第二遍
      expect(raw.split('旧结论').length - 1).toBe(1);
      expect(raw).toContain('status: draft');
    } finally {
      db.close();
    }
  });

  it('refuses a status rewrite when the page changed while it was being written', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '项目状态',
        type: 'status',
        description: '当前进展',
        content: 'As of 2026-06-01\n\n- 正在做：A',
        mode: 'replace',
        actor: 'user',
      });

      await expect(
        upsertWikiNote(db, bindings, {
          spaceId: 'proj:p1',
          title: '项目状态',
          type: 'status',
          description: '当前进展',
          content: 'As of 2026-06-02\n\n- 正在做：B',
          mode: 'replace',
          actor: 'collabra-compiler',
          status: 'draft',
          expectedBodyHash: 'stale-hash-from-before-the-external-edit',
        })
      ).rejects.toThrow(/changed while the status page was being written/);

      const space = bindings.resolveSpace('proj:p1');
      expect(readNoteFile(space.rootPath, 'wiki/status.md')).toContain('正在做：A');
    } finally {
      db.close();
    }
  });

  it('keeps a human signature instead of re-stamping a note the user already verified', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const written = await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        title: '缓存策略',
        type: 'systems',
        description: '本地缓存',
        content: '使用 LRU。',
        mode: 'replace',
        actor: 'user',
      });

      await expect(
        markNoteVerified(db, bindings, {
          spaceId: 'proj:p1',
          relPath: written.relPath,
          by: 'collabra-verifier',
        })
      ).resolves.toBe(false);

      const space = bindings.resolveSpace('proj:p1');
      expect(readNoteFile(space.rootPath, written.relPath)).toContain('by: user');
    } finally {
      db.close();
    }
  });

  it('sanitizes the conflict fallback before it reaches the vault', async () => {
    const work = tmpDir();
    const bindings = new VaultBindingStore(work);
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        note: 'systems/leak',
        title: '泄漏检查',
        type: 'systems',
        description: '测试',
        content: '旧正文。',
        mode: 'replace',
        actor: 'user',
      });

      await upsertWikiNote(db, bindings, {
        spaceId: 'proj:p1',
        note: 'systems/leak',
        title: '泄漏检查',
        type: 'systems',
        description: '测试',
        content: '整页重写结果。',
        mode: 'replace',
        actor: 'collabra-compiler',
        status: 'draft',
        expectedBodyHash: 'stale-hash',
        conflictFallbackContent: '增量结论 sk-1234567890abcdefghijklmnop 到此为止。',
      });

      const space = bindings.resolveSpace('proj:p1');
      const raw = readNoteFile(space.rootPath, 'wiki/systems/leak.md') ?? '';
      expect(raw).not.toContain('sk-1234567890');
      expect(raw).toContain('[REDACTED]');
    } finally {
      db.close();
    }
  });
});
