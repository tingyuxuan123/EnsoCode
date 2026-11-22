import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openIndexDb, syncSpaceIndex } from './indexDb';
import { runVaultLint } from './lint';
import { writeNoteAtomic } from './vault';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-lint-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('deterministic vault lint', () => {
  it('detects broken links, orphans, stale notes, old drafts, missing descriptions, and oversized pages', () => {
    const work = tmpDir();
    const vault = path.join(work, 'vault');
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      writeNoteAtomic(
        vault,
        'wiki/systems/hub.md',
        [
          '---',
          'type: systems',
          'title: Hub',
          'description: Central hub',
          'status: verified',
          'stale_after: 2026-01-01',
          '---',
          '',
          'Links to [[systems/leaf]] and [[does-not-exist]].',
        ].join('\n')
      );
      writeNoteAtomic(
        vault,
        'wiki/systems/leaf.md',
        [
          '---',
          'type: systems',
          'title: Leaf',
          'status: draft',
          'generated:',
          '  by: collabra-compiler',
          '  at: 2026-10-01T00:00:00Z',
          '---',
          '',
          Array.from({ length: 320 }, (_, i) => `Line ${i + 1}`).join('\n'),
        ].join('\n')
      );
      writeNoteAtomic(
        vault,
        'wiki/notes/lonely.md',
        [
          '---',
          'type: notes',
          'title: Lonely',
          'description: No links anywhere',
          'status: verified',
          '---',
          '',
          'Isolated note.',
        ].join('\n')
      );

      syncSpaceIndex(db, 'proj:lint', vault);
      const report = runVaultLint(db, {
        spaceIds: ['proj:lint'],
        now: new Date('2026-11-20T00:00:00Z'),
        spaceLabel: () => 'Demo',
      });

      const kinds = new Set(report.issues.map((i) => i.kind));
      expect(kinds.has('broken_link')).toBe(true);
      expect(kinds.has('orphan')).toBe(true);
      expect(kinds.has('stale')).toBe(true);
      expect(kinds.has('unverified_draft')).toBe(true);
      expect(kinds.has('missing_description')).toBe(true);
      expect(kinds.has('oversized')).toBe(true);
      expect(report.checkedNotes).toBe(3);
    } finally {
      db.close();
    }
  });

  it('flags append-style revision markers and duplicated topics', () => {
    const work = tmpDir();
    const vault = path.join(work, 'vault');
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      writeNoteAtomic(
        vault,
        'wiki/domains/voxel.md',
        [
          '---',
          'type: domains',
          'title: 体素哈希参数',
          'description: 哈希表装载因子',
          'status: verified',
          '---',
          '',
          '装载因子保持在 0.85 以下。',
          '',
          '## Update (2026-11-12)',
          '',
          '街景数据下 0.85 会卡死，改用 0.70。',
        ].join('\n')
      );
      writeNoteAtomic(
        vault,
        'wiki/systems/hash.md',
        [
          '---',
          'type: systems',
          'title: 体素哈希',
          'description: 哈希表结构',
          'status: verified',
          '---',
          '',
          '正文。',
        ].join('\n')
      );
      writeNoteAtomic(
        vault,
        'wiki/notes/hash-copy.md',
        [
          '---',
          'type: notes',
          'title: 体素哈希',
          'description: 同一主题的另一份记录',
          'status: verified',
          '---',
          '',
          '正文。',
        ].join('\n')
      );
      writeNoteAtomic(
        vault,
        'wiki/systems/updater.md',
        [
          '---',
          'type: systems',
          'title: 自动更新',
          'description: 检查与安装',
          'status: verified',
          '---',
          '',
          '## 更新机制',
          '',
          '启动时检查一次。',
        ].join('\n')
      );

      syncSpaceIndex(db, 'proj:lint2', vault);
      const report = runVaultLint(db, {
        spaceIds: ['proj:lint2'],
        now: new Date('2026-11-20T00:00:00Z'),
      });

      const ofKind = (kind: string) =>
        report.issues
          .filter((i) => i.kind === kind)
          .map((i) => i.slug)
          .sort();
      expect(ofKind('revision_marker')).toEqual(['domains/voxel']);
      expect(ofKind('duplicate_title')).toEqual(['notes/hash-copy', 'systems/hash']);
    } finally {
      db.close();
    }
  });

  it('keeps the status page unique, short, and fresh, and never treats it as an orphan', () => {
    const work = tmpDir();
    const vault = path.join(work, 'vault');
    const db = openIndexDb(path.join(work, 'index.db'));
    try {
      const longBody = Array.from({ length: 70 }, (_, i) => `第 ${i + 1} 行当前状态`).join('\n');
      writeNoteAtomic(
        vault,
        'wiki/status.md',
        [
          '---',
          'type: status',
          'title: 项目状态',
          'description: 当前进展、下一步与卡点',
          'status: verified',
          '---',
          '',
          'As of 2026-06-01',
          '',
          longBody,
        ].join('\n')
      );
      for (const slug of ['wiki/systems/a.md', 'wiki/systems/b.md']) {
        writeNoteAtomic(
          vault,
          slug,
          [
            '---',
            'type: systems',
            'title: 孤立页',
            'description: 没有链接',
            'status: verified',
            '---',
            '',
            '正文。',
          ].join('\n')
        );
      }
      writeNoteAtomic(
        vault,
        'wiki/notes/old-status.md',
        [
          '---',
          'type: status',
          'title: 旧状态页',
          'description: 早前的进展',
          'status: verified',
          '---',
          '',
          'As of 2026-01-01',
        ].join('\n')
      );

      syncSpaceIndex(db, 'proj:lint3', vault);
      const report = runVaultLint(db, {
        spaceIds: ['proj:lint3'],
        now: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      });

      const ofKind = (kind: string) =>
        report.issues
          .filter((i) => i.kind === kind)
          .map((i) => i.slug)
          .sort();
      expect(ofKind('status_oversized')).toEqual(['status']);
      expect(ofKind('status_duplicate')).toEqual(['notes/old-status', 'status']);
      expect(ofKind('status_stale')).toEqual(['notes/old-status', 'status']);
      expect(ofKind('orphan')).toEqual(['systems/a', 'systems/b']);
    } finally {
      db.close();
    }
  });
});
