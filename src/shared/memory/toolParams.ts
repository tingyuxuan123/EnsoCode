import {
  DEFAULT_INDEX_LIMIT,
  DEFAULT_NOTE_TYPE,
  DEFAULT_SEARCH_LIMIT,
  isNoteStatus,
  isUpsertMode,
  MAX_INDEX_LIMIT,
  MAX_SEARCH_LIMIT,
  type NoteStatus,
  type UpsertMode,
} from './constants';
import { normalizeNoteType } from './markdown';

export const MEMORY_SEARCH_SPACES = ['all', 'global', 'project', 'bot', 'chat'] as const;
export type MemorySearchSpace = (typeof MEMORY_SEARCH_SPACES)[number];

export const MEMORY_WRITE_SPACES = ['global', 'project', 'bot', 'chat'] as const;
export type MemoryWriteSpace = (typeof MEMORY_WRITE_SPACES)[number];

export interface MemoryIndexRequest {
  spaceId?: MemorySearchSpace;
  type?: string;
  limit: number;
  includeRaw: boolean;
}

export interface MemorySearchRequest {
  query: string;
  spaceId?: MemorySearchSpace;
  type?: string;
  status?: NoteStatus;
  limit: number;
}

export interface MemoryReadRequest {
  note: string;
  spaceId?: MemorySearchSpace;
}

export interface MemoryUpsertRequest {
  note?: string;
  title: string;
  type: string;
  description?: string;
  content: string;
  mode: UpsertMode;
  section?: string;
  tags?: string[];
  sources?: string[];
  resource?: string;
  staleAfter?: string;
  spaceId?: MemoryWriteSpace;
}

export interface MemoryArchiveRequest {
  note: string;
  reason?: string;
  supersededBy?: string;
  spaceId?: MemoryWriteSpace;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function coerceInt(value: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function coerceBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const low = value.trim().toLowerCase();
    if (low === 'true' || low === '1') return true;
    if (low === 'false' || low === '0') return false;
  }
  return fallback;
}

function coerceSearchSpace(value: unknown): MemorySearchSpace | undefined {
  const s = cleanStr(value)?.toLowerCase();
  return s && (MEMORY_SEARCH_SPACES as readonly string[]).includes(s)
    ? (s as MemorySearchSpace)
    : undefined;
}

function coerceWriteSpace(value: unknown): MemoryWriteSpace | undefined {
  const s = cleanStr(value)?.toLowerCase();
  return s && (MEMORY_WRITE_SPACES as readonly string[]).includes(s)
    ? (s as MemoryWriteSpace)
    : undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = [...new Set(value.map(cleanStr).filter((v): v is string => Boolean(v)))];
    return out.length > 0 ? out : undefined;
  }
  const single = cleanStr(value);
  if (!single) return undefined;
  const out = [
    ...new Set(
      single
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
  return out.length > 0 ? out : undefined;
}

export function normalizeMemoryIndexParams(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return { limit: DEFAULT_INDEX_LIMIT, includeRaw: false };
  const out: Record<string, unknown> = {
    limit: coerceInt(raw.limit, DEFAULT_INDEX_LIMIT, 1, MAX_INDEX_LIMIT),
    includeRaw: coerceBool(raw.includeRaw ?? raw.include_raw, false),
  };
  const spaceId = coerceSearchSpace(raw.spaceId ?? raw.space_id ?? raw.space);
  if (spaceId) out.spaceId = spaceId;
  const type = cleanStr(raw.type ?? raw.category);
  if (type) out.type = normalizeNoteType(type);
  return out;
}

export function parseMemoryIndexRequest(raw: unknown): MemoryIndexRequest | null {
  if (!isRecord(raw)) return null;
  const normalized = normalizeMemoryIndexParams(raw);
  return {
    ...(normalized.spaceId ? { spaceId: normalized.spaceId as MemorySearchSpace } : {}),
    ...(typeof normalized.type === 'string' ? { type: normalized.type } : {}),
    limit: normalized.limit as number,
    includeRaw: normalized.includeRaw as boolean,
  };
}

export function normalizeMemorySearchParams(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const query = cleanStr(raw.query ?? raw.q ?? raw.keywords);
  if (query) out.query = query;
  const spaceId = coerceSearchSpace(raw.spaceId ?? raw.space_id ?? raw.space);
  if (spaceId) out.spaceId = spaceId;
  const type = cleanStr(raw.type ?? raw.category);
  if (type) out.type = normalizeNoteType(type);
  const status = cleanStr(raw.status)?.toLowerCase();
  if (status && isNoteStatus(status)) out.status = status;
  if (raw.limit !== undefined) {
    out.limit = coerceInt(raw.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  }
  return out;
}

export function parseMemorySearchRequest(raw: unknown): MemorySearchRequest | null {
  if (!isRecord(raw)) return null;
  const n = normalizeMemorySearchParams(raw);
  if (typeof n.query !== 'string' || !n.query) return null;
  return {
    query: n.query,
    ...(n.spaceId ? { spaceId: n.spaceId as MemorySearchSpace } : {}),
    ...(typeof n.type === 'string' ? { type: n.type } : {}),
    ...(n.status ? { status: n.status as NoteStatus } : {}),
    limit: typeof n.limit === 'number' ? n.limit : DEFAULT_SEARCH_LIMIT,
  };
}

export function normalizeMemoryReadParams(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const note = cleanStr(raw.note ?? raw.slug ?? raw.path ?? raw.id);
  if (note) out.note = note;
  const spaceId = coerceSearchSpace(raw.spaceId ?? raw.space_id ?? raw.space);
  if (spaceId) out.spaceId = spaceId;
  return out;
}

export function parseMemoryReadRequest(raw: unknown): MemoryReadRequest | null {
  if (!isRecord(raw)) return null;
  const n = normalizeMemoryReadParams(raw);
  if (typeof n.note !== 'string' || !n.note) return null;
  return {
    note: n.note,
    ...(n.spaceId ? { spaceId: n.spaceId as MemorySearchSpace } : {}),
  };
}

export function normalizeMemoryUpsertParams(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const note = cleanStr(raw.note ?? raw.slug ?? raw.path);
  if (note) out.note = note;
  const title = cleanStr(raw.title);
  if (title) out.title = title.slice(0, 120);
  const typeRaw = cleanStr(raw.type ?? raw.category);
  out.type = typeRaw ? normalizeNoteType(typeRaw) : DEFAULT_NOTE_TYPE;
  const description = cleanStr(raw.description ?? raw.summary);
  if (description) out.description = description.slice(0, 240);
  const content = cleanStr(raw.content ?? raw.body);
  if (content) out.content = content;
  const section = cleanStr(raw.section ?? raw.heading);
  const modeRaw = cleanStr(raw.mode)?.toLowerCase();
  let mode: UpsertMode = modeRaw && isUpsertMode(modeRaw) ? modeRaw : 'replace';
  if (mode === 'section' && !section) mode = 'append';
  out.mode = mode;
  if (mode === 'section' && section) out.section = section;
  const tags = coerceStringArray(raw.tags);
  if (tags) out.tags = tags;
  const sources = coerceStringArray(raw.sources);
  if (sources) out.sources = sources;
  const resource = cleanStr(raw.resource);
  if (resource) out.resource = resource;
  const staleAfter = cleanStr(raw.staleAfter ?? raw.stale_after);
  if (staleAfter && ISO_DATE_RE.test(staleAfter)) out.staleAfter = staleAfter;
  const spaceId = coerceWriteSpace(raw.spaceId ?? raw.space_id ?? raw.space);
  if (spaceId) out.spaceId = spaceId;
  return out;
}

export function parseMemoryUpsertRequest(raw: unknown): MemoryUpsertRequest | null {
  if (!isRecord(raw)) return null;
  const n = normalizeMemoryUpsertParams(raw);
  if (typeof n.content !== 'string' || !n.content) return null;
  if (typeof n.title !== 'string' || !n.title) return null;
  return {
    ...(typeof n.note === 'string' ? { note: n.note } : {}),
    title: n.title,
    type: typeof n.type === 'string' ? n.type : DEFAULT_NOTE_TYPE,
    ...(typeof n.description === 'string' ? { description: n.description } : {}),
    content: n.content,
    mode: isUpsertMode(n.mode) ? n.mode : 'replace',
    ...(typeof n.section === 'string' ? { section: n.section } : {}),
    ...(Array.isArray(n.tags) ? { tags: n.tags as string[] } : {}),
    ...(Array.isArray(n.sources) ? { sources: n.sources as string[] } : {}),
    ...(typeof n.resource === 'string' ? { resource: n.resource } : {}),
    ...(typeof n.staleAfter === 'string' ? { staleAfter: n.staleAfter } : {}),
    ...(n.spaceId ? { spaceId: n.spaceId as MemoryWriteSpace } : {}),
  };
}

export function normalizeMemoryArchiveParams(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  const note = cleanStr(raw.note ?? raw.slug ?? raw.path ?? raw.id);
  if (note) out.note = note;
  const reason = cleanStr(raw.reason);
  if (reason) out.reason = reason.slice(0, 240);
  const supersededBy = cleanStr(raw.supersededBy ?? raw.superseded_by);
  if (supersededBy) out.supersededBy = supersededBy;
  const spaceId = coerceWriteSpace(raw.spaceId ?? raw.space_id ?? raw.space);
  if (spaceId) out.spaceId = spaceId;
  return out;
}

export function parseMemoryArchiveRequest(raw: unknown): MemoryArchiveRequest | null {
  if (!isRecord(raw)) return null;
  const n = normalizeMemoryArchiveParams(raw);
  if (typeof n.note !== 'string' || !n.note) return null;
  return {
    note: n.note,
    ...(typeof n.reason === 'string' ? { reason: n.reason } : {}),
    ...(typeof n.supersededBy === 'string' ? { supersededBy: n.supersededBy } : {}),
    ...(n.spaceId ? { spaceId: n.spaceId as MemoryWriteSpace } : {}),
  };
}
