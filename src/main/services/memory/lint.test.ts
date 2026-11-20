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
});
