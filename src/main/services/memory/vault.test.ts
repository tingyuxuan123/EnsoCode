import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendVaultLog,
  archiveNoteFile,
  chooseIndexFilename,
  ensureVaultScaffold,
  readNoteFile,
  resolveVaultFilePath,
  scanVaultMarkdownFiles,
  writeManagedIndex,
  writeNoteAtomic,
} from './vault';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-vault-fs-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('vault filesystem operations', () => {
  it('scaffolds managed vault without overwriting existing user schema.md', () => {
    const root = tmpDir();
    ensureVaultScaffold(root, 'engineering', 'zh', false);
    expect(fs.existsSync(path.join(root, 'schema.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'wiki'))).toBe(true);

    // Custom schema must never be overwritten
    fs.writeFileSync(path.join(root, 'schema.md'), '# My Custom Schema\n');
    ensureVaultScaffold(root, 'personal', 'en', false);
    expect(fs.readFileSync(path.join(root, 'schema.md'), 'utf8')).toBe('# My Custom Schema\n');
  });

  it('protects non-managed index.md in external Obsidian vaults by falling back to _collabra-index.md', () => {
    const root = tmpDir();
    // Missing index.md → managed index.md
    expect(chooseIndexFilename(root)).toBe('index.md');
    writeManagedIndex(root, [
      {
        relPath: 'wiki/systems/auth.md',
        slug: 'systems/auth',
        title: '认证系统',
        description: 'OAuth 流程',
        type: 'systems',
        status: 'verified',
        isRaw: false,
        isArchived: false,
      },
    ]);
    expect(fs.existsSync(path.join(root, 'index.md'))).toBe(true);
    // Managed index.md keeps using index.md on subsequent updates
    expect(chooseIndexFilename(root)).toBe('index.md');

    // Hand-written user index.md (without collabra marker) → must NOT overwrite
    const external = tmpDir();
    fs.writeFileSync(path.join(external, 'index.md'), '# My Personal Home Page\n');
    expect(chooseIndexFilename(external)).toBe('_collabra-index.md');
    writeManagedIndex(external, [
      {
        relPath: 'notes/a.md',
        slug: 'notes/a',
        title: 'Note A',
        description: 'Summary A',
        type: 'notes',
        status: 'draft',
        isRaw: false,
        isArchived: false,
      },
    ]);
    expect(fs.readFileSync(path.join(external, 'index.md'), 'utf8')).toBe(
      '# My Personal Home Page\n'
    );
    expect(fs.readFileSync(path.join(external, '_collabra-index.md'), 'utf8')).toContain(
      '[[notes/a|Note A]]'
    );
  });

  it('blocks path traversal and symlink escapes outside the vault root', () => {
    const root = tmpDir();
    const outside = tmpDir();
    const secret = path.join(outside, 'secret.md');
    fs.writeFileSync(secret, 'TOP SECRET');
    fs.mkdirSync(path.join(root, 'wiki'), { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'wiki', 'escape-dir'));

    expect(resolveVaultFilePath(root, '../secret.md')).toBeNull();
    expect(resolveVaultFilePath(root, 'wiki/escape-dir/secret.md')).toBeNull();
    expect(resolveVaultFilePath(root, '.obsidian/config.md')).toBeNull();
    expect(resolveVaultFilePath(root, 'wiki/systems/auth.md')).toBe(
      path.join(fs.realpathSync(root), 'wiki', 'systems', 'auth.md')
    );
  });

  it('writes notes atomically, appends log.md, archives softly, and scans skipping ignored folders', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(root, '.obsidian', 'hidden.md'), 'ignored');
    writeNoteAtomic(root, 'raw/db-schema.md', '# DB Schema\n\nusers table\n');
    writeNoteAtomic(
      root,
      'wiki/incidents/crash.md',
      '---\ntype: incidents\ntitle: 启动崩溃\nstatus: draft\n---\n\n根因说明。\n'
    );
    appendVaultLog(root, { action: 'create', slug: 'incidents/crash', detail: '初始化记录' });

    const scanned = scanVaultMarkdownFiles(root);
    expect(
      scanned.map((f) => ({ relPath: f.relPath, isRaw: f.isRaw, isArchived: f.isArchived }))
    ).toEqual([
      { relPath: 'raw/db-schema.md', isRaw: true, isArchived: false },
      { relPath: 'wiki/incidents/crash.md', isRaw: false, isArchived: false },
    ]);

    const archived = archiveNoteFile(root, 'wiki/incidents/crash.md', {
      reason: '已被新机制替代',
      supersededBy: '[[incidents/crash-v2]]',
    });
    expect(archived.relPath).toBe('archive/incidents/crash.md');
    expect(readNoteFile(root, 'wiki/incidents/crash.md')).toBeNull();
    const archivedRaw = readNoteFile(root, 'archive/incidents/crash.md');
    expect(archivedRaw).toContain('status: deprecated');
    expect(archivedRaw).toContain('superseded_by: "[[incidents/crash-v2]]"');

    const logContent = fs.readFileSync(path.join(root, 'log.md'), 'utf8');
    expect(logContent).toContain('create | [[incidents/crash]]');
    expect(logContent).toContain('archive | [[incidents/crash]]');
  });
});
