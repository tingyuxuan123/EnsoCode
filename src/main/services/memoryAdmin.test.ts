import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VaultBindingStore } from './memory/bindings';
import { openIndexDb } from './memory/indexDb';
import {
  type AdminContext,
  applyPresetToSpace,
  archiveNoteById,
  createNoteManual,
  deleteNotePermanentlyById,
  editNoteManual,
  getMemoryStats,
  getNoteDetailById,
  getSchemaForSpace,
  listNotesForAdmin,
  readVaultDoc,
  restoreNoteById,
  runLintForAdmin,
} from './memoryAdmin';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-memory-admin-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('memoryAdmin wiki operations', () => {
  it('supports create, edit/verify, archive, restore, delete, stats, lint, and preset switching', async () => {
    const work = tmpDir();
    const dbPath = path.join(work, 'index.db');
    const db = openIndexDb(dbPath);
    const bindings = new VaultBindingStore(work);
    const ctx: AdminContext = {
      db,
      bindings,
      indexDbPath: dbPath,
      language: 'zh',
      spaceLabel: (id) => (id === 'global' ? 'Global' : id),
    };

    try {
      const created = await createNoteManual(ctx, {
        spaceId: 'global',
        slug: 'preferences/editor',
        title: '编辑器偏好',
        type: 'preferences',
        description: '使用 Obsidian 查看 Markdown',
        tags: ['obsidian'],
        body: '偏好本地 Markdown，参见 [[notes/missing]]。',
      });
      expect(created.ok).toBe(true);
      expect(created.note?.status).toBe('verified');
      const id = created.note!.id;

      const listed = listNotesForAdmin(ctx, { spaceId: 'global', limit: 20, offset: 0 });
      expect(listed.total).toBe(1);
      expect(listed.types).toEqual(['preferences']);

      const edited = await editNoteManual(ctx, id, {
        title: '编辑器与 Obsidian 偏好',
        body: '更新后的偏好正文。',
        status: 'verified',
      });
      expect(edited.ok).toBe(true);
      expect(getNoteDetailById(ctx, id)?.title).toBe('编辑器与 Obsidian 偏好');

      const lint = runLintForAdmin(ctx, 'global');
      expect(lint.checkedNotes).toBe(1);

      const archived = await archiveNoteById(ctx, id);
      expect(archived.ok).toBe(true);
      expect(archived.note?.isArchived).toBe(true);

      const restored = await restoreNoteById(ctx, archived.note!.id);
      expect(restored.ok).toBe(true);
      expect(restored.note?.isArchived).toBe(false);

      const stats = getMemoryStats(ctx);
      expect(stats.totalNotes).toBe(1);
      expect(stats.verifiedCount).toBe(1);

      applyPresetToSpace(ctx, 'global', 'engineering');
      expect(getSchemaForSpace(ctx, 'global')).toContain('systems');

      const deleted = await deleteNotePermanentlyById(ctx, restored.note!.id);
      expect(deleted.ok).toBe(true);
      expect(listNotesForAdmin(ctx, { spaceId: 'global', limit: 20, offset: 0 }).total).toBe(0);
    } finally {
      db.close();
    }
  });

  it('detects external disk modifications via expectedUpdatedAt and reads system vault docs', async () => {
    const work = tmpDir();
    const dbPath = path.join(work, 'index.db');
    const db = openIndexDb(dbPath);
    const bindings = new VaultBindingStore(work);
    const ctx: AdminContext = {
      db,
      bindings,
      indexDbPath: dbPath,
      language: 'zh',
      spaceLabel: (id) => (id === 'global' ? 'Global' : id),
    };

    try {
      const created = await createNoteManual(ctx, {
        spaceId: 'global',
        slug: 'systems/conflict-check',
        title: 'Conflict Check',
        type: 'systems',
        body: 'Initial content',
      });
      expect(created.ok).toBe(true);
      const id = created.note!.id;

      // Simulate Obsidian editing the file externally and bumping mtime
      const resolved = bindings.resolveSpace('global');
      const absPath = path.join(resolved.rootPath, created.note!.relPath);
      fs.writeFileSync(absPath, `${fs.readFileSync(absPath, 'utf8')}\n\n## Edited in Obsidian\n`);
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(absPath, future, future);

      const staleAttempt = await editNoteManual(ctx, id, {
        body: 'Stale overwrite attempt',
        expectedUpdatedAt: created.note!.updatedAt,
      });
      expect(staleAttempt.ok).toBe(false);
      expect(staleAttempt.conflict).toBe(true);
      expect(staleAttempt.currentNote?.body).toContain('Edited in Obsidian');

      // Writing with latest expectedUpdatedAt succeeds cleanly
      const updated = await editNoteManual(ctx, id, {
        body: 'Merged overwrite',
        expectedUpdatedAt: staleAttempt.currentNote!.updatedAt,
      });
      expect(updated.ok).toBe(true);
      expect(updated.note?.body).toBe('Merged overwrite');

      // System vault docs: index, log, schema
      const indexDoc = readVaultDoc(ctx, 'global', 'index');
      const logDoc = readVaultDoc(ctx, 'global', 'log');
      const schemaDoc = readVaultDoc(ctx, 'global', 'schema');
      expect(indexDoc?.filename).toBe('index.md');
      expect(indexDoc?.content).toContain('[[systems/conflict-check');
      expect(logDoc?.filename).toBe('log.md');
      expect(logDoc?.content).toContain('conflict-check');
      expect(schemaDoc?.filename).toBe('schema.md');
      expect(schemaDoc?.content).toContain('OKF v0.2');
    } finally {
      db.close();
    }
  });
});
