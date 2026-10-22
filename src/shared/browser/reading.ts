import { parseSnapshotEntries, type SnapshotEntry } from './snapshot';

export interface ReadRequest {
  scope?: 'viewport' | 'document';
  ref?: string;
  maxChars?: number;
  limit?: number;
  role?: string;
  text?: string;
  cursor?: string;
}
export interface PageReadSnapshot {
  snapshotId: string;
  text: string;
  entries: SnapshotEntry[];
  diagnostics: string[];
  truncated: boolean;
}

export function parseReadRequest(raw: unknown): ReadRequest {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Read params must be an object');
  const data = raw as Record<string, unknown>;
  const out: ReadRequest = {};
  if (data.scope !== undefined) {
    if (data.scope !== 'viewport' && data.scope !== 'document')
      throw new Error('Invalid read scope');
    out.scope = data.scope;
  }
  for (const key of ['ref', 'role', 'text', 'cursor'] as const) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== 'string' || data[key].length > 512) throw new Error(`Invalid ${key}`);
    out[key] = data[key];
  }
  for (const [key, max] of [
    ['maxChars', 24000],
    ['limit', 500],
  ] as const) {
    if (data[key] === undefined) continue;
    if (
      typeof data[key] !== 'number' ||
      !Number.isInteger(data[key]) ||
      data[key] < 1 ||
      data[key] > max
    )
      throw new Error(`Invalid ${key}`);
    out[key] = data[key];
  }
  return out;
}

export function parsePageReadSnapshot(raw: unknown, snapshotId: string): PageReadSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Unexpected page read result');
  const value = raw as Record<string, unknown>;
  const entries = parseSnapshotEntries(value.entries);
  if (
    !entries ||
    typeof value.text !== 'string' ||
    value.text.length > 500000 ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every((item) => typeof item === 'string') ||
    typeof value.truncated !== 'boolean'
  )
    throw new Error('Unexpected page read result');
  return {
    snapshotId,
    text: value.text,
    entries,
    diagnostics: value.diagnostics.slice(0, 50),
    truncated: value.truncated,
  };
}

export function readPageSlice(
  snapshot: PageReadSnapshot,
  request: ReadRequest,
  kind: 'text' | 'elements'
) {
  let offset = 0;
  if (request.cursor) {
    const prefix = `${snapshot.snapshotId}:`;
    if (!request.cursor.startsWith(prefix) || !/^\d+$/.test(request.cursor.slice(prefix.length)))
      throw new Error('Stale or invalid read cursor');
    offset = Number(request.cursor.slice(prefix.length));
    if (!Number.isSafeInteger(offset)) throw new Error('Invalid read cursor');
  }
  const entries = snapshot.entries.filter(
    (entry) =>
      (!request.role || entry.role.toLowerCase() === request.role.toLowerCase()) &&
      (!request.text || entry.name.toLowerCase().includes(request.text.toLowerCase()))
  );
  const total = kind === 'text' ? snapshot.text.length : entries.length;
  if (offset > total) throw new Error('Invalid read cursor offset');
  const end = Math.min(
    total,
    offset + (kind === 'text' ? (request.maxChars ?? 12000) : (request.limit ?? 100))
  );
  return {
    snapshotId: snapshot.snapshotId,
    ...(kind === 'text'
      ? { text: snapshot.text.slice(offset, end) }
      : { entries: entries.slice(offset, end) }),
    total,
    nextCursor: end < total ? `${snapshot.snapshotId}:${end}` : undefined,
    diagnostics: snapshot.diagnostics,
    truncated: snapshot.truncated,
  };
}
