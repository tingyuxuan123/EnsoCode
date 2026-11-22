import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_INDEX_FILENAME,
  FALLBACK_INDEX_FILENAME,
  LOG_FILENAME,
  MANAGED_INDEX_MARKER,
  type NoteStatus,
  SCHEMA_FILENAME,
  type VaultPreset,
} from '@shared/memory/constants';
import {
  parseMarkdownNote,
  relPathToSlug,
  resolveSafeRelPath,
  serializeMarkdownNote,
} from '@shared/memory/markdown';
import { buildPresetSchemaMarkdown } from '@shared/memory/presets';
import { MemoryValidationError } from './types';

const IGNORED_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const SYSTEM_FILES = new Set([
  DEFAULT_INDEX_FILENAME,
  FALLBACK_INDEX_FILENAME,
  LOG_FILENAME,
  SCHEMA_FILENAME,
]);

/** 按 spaceId 串行化写入锁，避免并发会话 / 后台编译 / watcher 互相覆盖文件或损坏 index.md */
const spaceLocks = new Map<string, Promise<unknown>>();

export function withSpaceLock<T>(spaceId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = spaceLocks.get(spaceId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  // 队尾只负责顺序：next 的失败由调用方处理，这里必须消费掉，否则拒绝的写入会变成
  // unhandled rejection（例如向 raw/ 写入被拒、状态页路径冲突）。
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  const tracked = settled.then(() => {
    if (spaceLocks.get(spaceId) === tracked) spaceLocks.delete(spaceId);
  });
  spaceLocks.set(spaceId, tracked);
  return next;
}

export interface ScannedVaultFile {
  relPath: string;
  absPath: string;
  mtimeMs: number;
  sizeBytes: number;
  isRaw: boolean;
  isArchived: boolean;
}

export interface IndexCatalogItem {
  relPath: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: NoteStatus;
  isRaw: boolean;
  isArchived: boolean;
}

export function ensureVaultScaffold(
  rootPath: string,
  preset: VaultPreset,
  language: string = 'zh',
  isExternal: boolean = false
): void {
  fs.mkdirSync(rootPath, { recursive: true });
  if (!isExternal) {
    fs.mkdirSync(path.join(rootPath, 'wiki'), { recursive: true });
  }
  const schemaPath = path.join(rootPath, SCHEMA_FILENAME);
  if (!fs.existsSync(schemaPath)) {
    writeFileAtomicRaw(schemaPath, buildPresetSchemaMarkdown(preset, language));
  }
}

export function readSchemaFile(
  rootPath: string,
  preset: VaultPreset,
  language: string = 'zh'
): string {
  const schemaPath = path.join(rootPath, SCHEMA_FILENAME);
  try {
    if (fs.existsSync(schemaPath)) return fs.readFileSync(schemaPath, 'utf8');
  } catch {}
  return buildPresetSchemaMarkdown(preset, language);
}

export function writeSchemaFile(rootPath: string, content: string): void {
  fs.mkdirSync(rootPath, { recursive: true });
  writeFileAtomicRaw(path.join(rootPath, SCHEMA_FILENAME), content.replace(/\r\n?/g, '\n'));
}

/**
 * 路径边界校验：解析相对路径、规范化软链，并确保目标严格位于 realRoot 内部。
 * 若父目录尚未创建，逐级向上找到最近已存在的祖先并验证其 realpath 仍在 realRoot 内。
 */
export function resolveVaultFilePath(rootPath: string, relPath: string): string | null {
  const safeRel = resolveSafeRelPath(relPath);
  if (!safeRel) return null;
  if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootPath);
  } catch {
    return null;
  }
  const candidate = path.resolve(realRoot, safeRel);
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (!candidate.startsWith(prefix)) return null;

  // Walk upward to verify no existing ancestor (including target) is a symlink escaping realRoot
  let probe = candidate;
  while (probe !== realRoot) {
    if (fs.existsSync(probe)) {
      try {
        const realProbe = fs.realpathSync(probe);
        if (realProbe !== realRoot && !realProbe.startsWith(prefix)) return null;
      } catch {
        return null;
      }
      break;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  return candidate;
}

function writeFileAtomicRaw(absPath: string, content: string): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, absPath);
}

export function readNoteFile(rootPath: string, relPath: string): string | null {
  const abs = resolveVaultFilePath(rootPath, relPath);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    if (!fs.statSync(abs).isFile()) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function readNoteMtimeIso(rootPath: string, relPath: string): string | null {
  const abs = resolveVaultFilePath(rootPath, relPath);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    const stat = fs.statSync(abs);
    return stat.isFile() ? new Date(stat.mtimeMs).toISOString() : null;
  } catch {
    return null;
  }
}

export function writeNoteAtomic(rootPath: string, relPath: string, markdown: string): string {
  const safeRel = resolveSafeRelPath(relPath);
  if (!safeRel) {
    throw new MemoryValidationError('invalid_path', `Unsafe note path: ${relPath}`);
  }
  const abs = resolveVaultFilePath(rootPath, safeRel);
  if (!abs) {
    throw new MemoryValidationError('invalid_path', `Path escapes vault root: ${relPath}`);
  }
  writeFileAtomicRaw(abs, markdown);
  return safeRel;
}

export function deleteNoteFile(rootPath: string, relPath: string): boolean {
  const abs = resolveVaultFilePath(rootPath, relPath);
  if (!abs || !fs.existsSync(abs)) return false;
  fs.unlinkSync(abs);
  return true;
}

export function archiveNoteFile(
  rootPath: string,
  relPath: string,
  opts: { reason?: string; supersededBy?: string; now?: Date } = {}
): { relPath: string; slug: string } {
  const raw = readNoteFile(rootPath, relPath);
  if (raw === null) {
    throw new MemoryValidationError('not_found', `Note not found: ${relPath}`);
  }
  const parsed = parseMarkdownNote(raw, relPathToSlug(relPath));
  const slug = relPathToSlug(relPath);
  const archiveRel = relPath.startsWith('archive/') ? relPath : `archive/${slug}.md`;
  const nextFm = {
    ...parsed.frontmatter,
    status: 'deprecated' as const,
    ...(opts.supersededBy?.trim() ? { superseded_by: opts.supersededBy.trim() } : {}),
  };
  let nextBody = parsed.body;
  if (opts.reason?.trim()) {
    const noteLine = `> Archived (${(opts.now ?? new Date()).toISOString().slice(0, 10)}): ${opts.reason.trim()}`;
    nextBody = nextBody ? `${noteLine}\n\n${nextBody}` : noteLine;
  }
  const serialized = serializeMarkdownNote(nextFm, nextBody);
  const writtenRel = writeNoteAtomic(rootPath, archiveRel, serialized);
  if (writtenRel !== relPath) {
    deleteNoteFile(rootPath, relPath);
  }
  appendVaultLog(rootPath, {
    action: 'archive',
    slug,
    detail:
      opts.reason?.trim() ||
      (opts.supersededBy ? `superseded by ${opts.supersededBy}` : 'archived'),
    now: opts.now,
  });
  return { relPath: writtenRel, slug };
}

export function restoreNoteFile(
  rootPath: string,
  relPath: string,
  now?: Date
): { relPath: string; slug: string } {
  const raw = readNoteFile(rootPath, relPath);
  if (raw === null) {
    throw new MemoryValidationError('not_found', `Note not found: ${relPath}`);
  }
  const parsed = parseMarkdownNote(raw, relPathToSlug(relPath));
  const slug = relPathToSlug(relPath);
  const restoredRel = relPath.startsWith('archive/') ? `wiki/${slug}.md` : relPath;
  const nextFm = {
    ...parsed.frontmatter,
    status: parsed.frontmatter.verified ? ('verified' as const) : ('draft' as const),
  };
  delete nextFm.superseded_by;
  const writtenRel = writeNoteAtomic(
    rootPath,
    restoredRel,
    serializeMarkdownNote(nextFm, parsed.body)
  );
  if (writtenRel !== relPath) {
    deleteNoteFile(rootPath, relPath);
  }
  appendVaultLog(rootPath, { action: 'restore', slug, detail: 'restored from archive', now });
  return { relPath: writtenRel, slug };
}

/**
 * 若根目录不存在 `index.md` 或已有 `index.md` 含 Collabra 托管标记，则写 `index.md`；
 * 否则视为外部 Obsidian Vault 中用户手写的 `index.md`，自动回退到 `_collabra-index.md`。
 */
export function chooseIndexFilename(rootPath: string): string {
  const primary = path.join(rootPath, DEFAULT_INDEX_FILENAME);
  if (!fs.existsSync(primary)) return DEFAULT_INDEX_FILENAME;
  try {
    const head = fs.readFileSync(primary, 'utf8').slice(0, 512);
    if (head.includes(MANAGED_INDEX_MARKER)) return DEFAULT_INDEX_FILENAME;
    return FALLBACK_INDEX_FILENAME;
  } catch {
    return FALLBACK_INDEX_FILENAME;
  }
}

export function renderManagedIndex(notes: readonly IndexCatalogItem[]): string {
  const active = notes.filter((n) => !n.isArchived);
  const wiki = active.filter((n) => !n.isRaw);
  const raw = active.filter((n) => n.isRaw);

  const byType = new Map<string, IndexCatalogItem[]>();
  for (const n of wiki) {
    const bucket = byType.get(n.type) ?? [];
    bucket.push(n);
    byType.set(n.type, bucket);
  }
  const sortedTypes = [...byType.keys()].sort((a, b) => a.localeCompare(b));

  const lines: string[] = [
    MANAGED_INDEX_MARKER,
    '# Knowledge Index',
    '',
    `> Auto-maintained by Collabra (${wiki.length} wiki notes${raw.length > 0 ? `, ${raw.length} raw references` : ''}).`,
    '',
  ];

  for (const type of sortedTypes) {
    lines.push(`## ${type}`);
    lines.push('');
    const items = (byType.get(type) ?? []).sort((a, b) => a.slug.localeCompare(b.slug));
    for (const item of items) {
      const desc = item.description ? ` — ${item.description}` : '';
      const badge = item.status === 'draft' ? ' *(draft)*' : '';
      lines.push(`- [[${item.slug}|${item.title}]]${desc}${badge}`);
    }
    lines.push('');
  }

  if (raw.length > 0) {
    lines.push('## raw (read-only)');
    lines.push('');
    for (const item of raw.sort((a, b) => a.relPath.localeCompare(b.relPath))) {
      const desc = item.description ? ` — ${item.description}` : '';
      lines.push(`- [[${item.slug}|${item.title}]]${desc}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeManagedIndex(rootPath: string, notes: readonly IndexCatalogItem[]): string {
  fs.mkdirSync(rootPath, { recursive: true });
  const filename = chooseIndexFilename(rootPath);
  const content = renderManagedIndex(notes);
  const target = path.join(rootPath, filename);
  try {
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) {
      return filename;
    }
  } catch {}
  writeFileAtomicRaw(target, content);
  return filename;
}

export function appendVaultLog(
  rootPath: string,
  entry: { action: string; slug: string; detail?: string; now?: Date }
): void {
  fs.mkdirSync(rootPath, { recursive: true });
  const ts = (entry.now ?? new Date()).toISOString().slice(0, 16).replace('T', ' ');
  const detail = entry.detail?.trim() ? ` — ${entry.detail.trim().replace(/\s+/g, ' ')}` : '';
  const line = `## [${ts}] ${entry.action} | [[${entry.slug}]]${detail}\n`;
  const logPath = path.join(rootPath, LOG_FILENAME);
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `# Vault Activity Log\n\n${line}`, 'utf8');
  } else {
    fs.appendFileSync(logPath, line, 'utf8');
  }
}

export function scanVaultMarkdownFiles(rootPath: string): ScannedVaultFile[] {
  if (!fs.existsSync(rootPath)) return [];
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(rootPath);
  } catch {
    return [];
  }
  const results: ScannedVaultFile[] = [];
  const visitedDirs = new Set<string>([realRoot]);

  const walk = (absDir: string, relPrefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
      const absChild = path.join(absDir, entry.name);
      const relChild = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        try {
          const realChild = fs.realpathSync(absChild);
          if (!realChild.startsWith(`${realRoot}${path.sep}`) || visitedDirs.has(realChild))
            continue;
          visitedDirs.add(realChild);
        } catch {
          continue;
        }
        walk(absChild, relChild);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        if (!relPrefix && SYSTEM_FILES.has(entry.name.toLowerCase())) continue;
        try {
          const stat = fs.statSync(absChild);
          const lower = relChild.toLowerCase();
          results.push({
            relPath: relChild,
            absPath: absChild,
            mtimeMs: stat.mtimeMs,
            sizeBytes: stat.size,
            isRaw: lower.startsWith('raw/'),
            isArchived: lower.startsWith('archive/'),
          });
        } catch {}
      }
    }
  };

  walk(realRoot, '');
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}
