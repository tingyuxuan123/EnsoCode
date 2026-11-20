import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_NOTE_TYPE, isNoteStatus, type NoteStatus } from './constants';

export interface NoteProvenance {
  by: string;
  at: string;
}

/**
 * OKF v0.2 兼容 YAML Frontmatter。
 * 必填字段仅 `type`（开放词表）；未知的 Obsidian / Dataview 属性保留在 `extra` 中原样写回。
 */
export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  status: NoteStatus;
  tags: string[];
  resource?: string;
  generated?: NoteProvenance;
  verified?: NoteProvenance;
  stale_after?: string;
  sources: string[];
  superseded_by?: string;
  extra: Record<string, unknown>;
}

export interface ParsedWikiLink {
  raw: string;
  target: string;
  heading: string | null;
  alias: string | null;
}

export interface ParsedNote {
  frontmatter: OkfFrontmatter;
  body: string;
  links: ParsedWikiLink[];
  lineCount: number;
}

export interface WikiLinkTargetCandidate {
  relPath: string;
  slug: string;
  title: string;
}

const KNOWN_FRONTMATTER_KEYS = new Set([
  'type',
  'title',
  'description',
  'status',
  'tags',
  'resource',
  'generated',
  'verified',
  'stale_after',
  'sources',
  'superseded_by',
]);

const RESERVED_SEGMENTS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const text = cleanString(typeof item === 'number' ? String(item) : item);
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    return out;
  }
  const single = cleanString(value);
  if (!single) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of single.split(/[,，]/)) {
    const text = part.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

function parseProvenance(value: unknown): NoteProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const by = cleanString(row.by);
  const at =
    value instanceof Date
      ? value.toISOString()
      : row.at instanceof Date
        ? row.at.toISOString()
        : cleanString(row.at);
  if (!by || !at) return undefined;
  return { by, at };
}

function parseIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = cleanString(value);
  if (!text) return undefined;
  return ISO_DATE_RE.test(text) ? text : undefined;
}

function extractFirstHeading(body: string): string | undefined {
  let inFence = false;
  let fenceChar = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (trimmed[0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const h1 = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (h1?.[1]?.trim()) return h1[1].trim();
  }
  return undefined;
}

function splitFrontmatter(normalized: string): { yamlRaw: string | null; body: string } {
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { yamlRaw: null, body: normalized };
  }
  const endMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!endMatch) {
    return { yamlRaw: null, body: normalized };
  }
  const yamlRaw = endMatch[1];
  const rest = normalized.slice(endMatch[0].length).replace(/^\n+/, '');
  return { yamlRaw, body: rest };
}

export function normalizeNoteType(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_NOTE_TYPE;
  const cleaned = value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[/\\]+/g, ' ')
    .replace(/\.\.+/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_NOTE_TYPE;
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += input.charCodeAt(i) < 32 ? ' ' : input[i];
  }
  return out;
}

function hasControlChar(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) < 32) return true;
  }
  return false;
}

export function normalizeNoteSlug(input: string): string {
  const withoutExt = input.normalize('NFC').trim().replace(/\.md$/i, '');
  const cleaned = stripControlChars(withoutExt)
    .toLowerCase()
    .replace(/\.\.+/g, ' ')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 96) || 'untitled';
}

export function resolveSafeRelPath(input: string): string | null {
  const raw = input.normalize('NFC').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) return null;
  const segments = raw.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return null;
    if (segment.startsWith('.')) return null;
    if (RESERVED_SEGMENTS.has(segment.toLowerCase())) return null;
    if (/[<>:"|?*]/.test(segment) || hasControlChar(segment)) return null;
  }
  const joined = segments.join('/');
  return joined.toLowerCase().endsWith('.md') ? joined : `${joined}.md`;
}

export function relPathToSlug(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\.md$/i, '');
  if (normalized.startsWith('wiki/')) return normalized.slice('wiki/'.length);
  if (normalized.startsWith('archive/')) return normalized.slice('archive/'.length);
  return normalized;
}

export function makeNoteId(spaceId: string, relPath: string): string {
  return `${spaceId}::${relPath.replace(/\\/g, '/')}`;
}

export function parseNoteId(id: string): { spaceId: string; relPath: string } | null {
  const idx = id.indexOf('::');
  if (idx <= 0) return null;
  const spaceId = id.slice(0, idx).trim();
  const safePath = resolveSafeRelPath(id.slice(idx + 2));
  if (!spaceId || !safePath) return null;
  return { spaceId, relPath: safePath };
}

export function extractWikiLinks(markdown: string): ParsedWikiLink[] {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const links: ParsedWikiLink[] = [];
  const seen = new Set<string>();

  let inFence = false;
  let fenceChar = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (trimmed[0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    // Strip inline code spans before scanning for wikilinks
    const withoutInlineCode = line.replace(/`+[^`]*`+/g, '');
    const linkRe = /(!)?\[\[([^\]]+)\]\]/g;
    for (const match of withoutInlineCode.matchAll(linkRe)) {
      if (match[1] === '!') continue; // skip ![[embed]]
      const inner = match[2].trim();
      if (!inner) continue;
      const pipeIdx = inner.indexOf('|');
      const targetPart = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const alias = pipeIdx >= 0 ? (cleanString(inner.slice(pipeIdx + 1)) ?? null) : null;
      const hashIdx = targetPart.indexOf('#');
      const target = (hashIdx >= 0 ? targetPart.slice(0, hashIdx) : targetPart).trim();
      const heading = hashIdx >= 0 ? (cleanString(targetPart.slice(hashIdx + 1)) ?? null) : null;
      if (!target) continue;
      const dedupeKey = `${target.toLowerCase()}#${(heading ?? '').toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      links.push({
        raw: match[0],
        target,
        heading,
        alias,
      });
    }
  }
  return links;
}

export function resolveWikiLinkTarget(
  targetRaw: string,
  candidates: readonly WikiLinkTargetCandidate[]
): string | null {
  const cleaned = targetRaw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const withoutMd = lower.replace(/\.md$/i, '');

  // 1. Exact relative path match
  for (const c of candidates) {
    const rel = c.relPath.replace(/\\/g, '/').toLowerCase();
    if (rel === lower || rel.replace(/\.md$/i, '') === withoutMd) return c.relPath;
  }
  // 2. Exact slug match
  for (const c of candidates) {
    if (c.slug.toLowerCase() === withoutMd) return c.relPath;
  }
  // 3. Basename match (Obsidian shortest-path resolution)
  for (const c of candidates) {
    const base = c.relPath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.md$/i, '')
      .toLowerCase();
    if (base === withoutMd) return c.relPath;
  }
  // 4. Title match
  for (const c of candidates) {
    if (c.title.trim().toLowerCase() === withoutMd) return c.relPath;
  }
  return null;
}

export function parseMarkdownNote(raw: string, fallbackTitle?: string): ParsedNote {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const { yamlRaw, body: rawBody } = splitFrontmatter(normalized);
  const body = rawBody.replace(/\n+$/, '');

  let parsedObj: Record<string, unknown> | null = null;
  if (yamlRaw !== null) {
    try {
      const doc = parseYaml(yamlRaw);
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        parsedObj = doc as Record<string, unknown>;
      }
    } catch {
      parsedObj = null;
    }
  }

  const extra: Record<string, unknown> = {};
  if (parsedObj) {
    for (const [key, value] of Object.entries(parsedObj)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(key)) extra[key] = value;
    }
  }

  const derivedTitle = extractFirstHeading(body) ?? cleanString(fallbackTitle) ?? 'Untitled';
  const generated = parseProvenance(parsedObj?.generated);
  const verified = parseProvenance(parsedObj?.verified);
  // 外部人类手写的 Obsidian 笔记没有 frontmatter/generated 时默认视为 verified；AI 写入会显式声明 draft
  const defaultStatus: NoteStatus = generated && !verified ? 'draft' : 'verified';
  const status: NoteStatus = isNoteStatus(parsedObj?.status) ? parsedObj.status : defaultStatus;

  const frontmatter: OkfFrontmatter = {
    type: parsedObj?.type !== undefined ? normalizeNoteType(parsedObj.type) : DEFAULT_NOTE_TYPE,
    title: cleanString(parsedObj?.title) ?? derivedTitle,
    ...(cleanString(parsedObj?.description)
      ? { description: cleanString(parsedObj?.description) }
      : {}),
    status,
    tags: parseStringList(parsedObj?.tags),
    ...(cleanString(parsedObj?.resource) ? { resource: cleanString(parsedObj?.resource) } : {}),
    ...(generated ? { generated } : {}),
    ...(verified ? { verified } : {}),
    ...(parseIsoDate(parsedObj?.stale_after)
      ? { stale_after: parseIsoDate(parsedObj?.stale_after) }
      : {}),
    sources: parseStringList(parsedObj?.sources),
    ...(cleanString(parsedObj?.superseded_by)
      ? { superseded_by: cleanString(parsedObj?.superseded_by) }
      : {}),
    extra,
  };

  const links = extractWikiLinks(body);
  const lineCount = normalized ? normalized.split('\n').length : 0;
  return { frontmatter, body, links, lineCount };
}

export function serializeMarkdownNote(frontmatter: OkfFrontmatter, body: string): string {
  const record: Record<string, unknown> = {
    type: normalizeNoteType(frontmatter.type),
  };
  if (frontmatter.title?.trim()) record.title = frontmatter.title.trim();
  if (frontmatter.description?.trim()) record.description = frontmatter.description.trim();
  record.status = frontmatter.status;
  if (frontmatter.tags.length > 0)
    record.tags = [...new Set(frontmatter.tags.map((t) => t.trim()).filter(Boolean))];
  if (frontmatter.resource?.trim()) record.resource = frontmatter.resource.trim();
  if (frontmatter.generated) record.generated = frontmatter.generated;
  if (frontmatter.verified) record.verified = frontmatter.verified;
  if (frontmatter.stale_after?.trim()) record.stale_after = frontmatter.stale_after.trim();
  if (frontmatter.sources.length > 0) {
    record.sources = [...new Set(frontmatter.sources.map((s) => s.trim()).filter(Boolean))];
  }
  if (frontmatter.superseded_by?.trim()) record.superseded_by = frontmatter.superseded_by.trim();
  for (const [key, value] of Object.entries(frontmatter.extra ?? {})) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key) && value !== undefined) {
      record[key] = value;
    }
  }

  const yamlText = stringifyYaml(record, { lineWidth: 120 }).trimEnd();
  const cleanBody = body.replace(/\r\n?/g, '\n').trim();
  return cleanBody ? `---\n${yamlText}\n---\n\n${cleanBody}\n` : `---\n${yamlText}\n---\n`;
}

export function patchMarkdownSection(
  body: string,
  sectionHeading: string,
  newContent: string
): string {
  const normalizedBody = body.replace(/\r\n?/g, '\n').trimEnd();
  const target = sectionHeading
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
  const replacement = newContent.replace(/\r\n?/g, '\n').trim();
  if (!target) return normalizedBody ? `${normalizedBody}\n\n${replacement}` : replacement;

  const lines = normalizedBody ? normalizedBody.split('\n') : [];
  let inFence = false;
  let fenceChar = '';
  let matchIndex = -1;
  let matchLevel = 2;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (trimmed[0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    if (heading[2].trim().toLowerCase() === target) {
      matchIndex = i;
      matchLevel = heading[1].length;
      break;
    }
  }

  if (matchIndex === -1) {
    const cleanHeading = sectionHeading.replace(/^#+\s*/, '').trim();
    const appended = `## ${cleanHeading}\n\n${replacement}`;
    return normalizedBody ? `${normalizedBody}\n\n${appended}` : appended;
  }

  // Find next heading with level <= matchLevel outside fenced code blocks
  let endIndex = lines.length;
  inFence = false;
  fenceChar = '';
  for (let i = matchIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (trimmed[0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+/);
    if (heading && heading[1].length <= matchLevel) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, matchIndex);
  const headingLine = lines[matchIndex];
  const after = lines.slice(endIndex);
  const sectionBlock = [headingLine, '', replacement];
  const merged = [...before, ...sectionBlock, ...(after.length > 0 ? ['', ...after] : [])];
  return merged
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
