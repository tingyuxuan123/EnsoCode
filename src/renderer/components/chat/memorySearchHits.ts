import type { NoteStatus } from '@shared/memory/constants';

export interface MemorySearchHit {
  id: string;
  slug: string | null;
  title: string;
  content: string;
  noteType: string | null;
  status: NoteStatus | null;
  space: 'global' | 'project' | null;
}

export type MemoryCaptureView =
  | { written: true; action: 'created' | 'updated'; memory: MemorySearchHit }
  | { written: false; pendingReview: true; memory: MemorySearchHit };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseRecord(output: string | null): Record<string, unknown> | null {
  if (!output) return null;
  try {
    const parsed: unknown = JSON.parse(output);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function spaceOf(spaceId: unknown): 'global' | 'project' | null {
  if (spaceId === 'global') return 'global';
  if (typeof spaceId === 'string' && spaceId.startsWith('proj:')) return 'project';
  return null;
}

function statusOf(raw: unknown): NoteStatus | null {
  return raw === 'draft' || raw === 'verified' || raw === 'deprecated' ? raw : null;
}

function parseHits(list: unknown): MemorySearchHit[] | null {
  if (!Array.isArray(list)) return null;
  const hits: MemorySearchHit[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string') {
      return null;
    }
    const content =
      typeof raw.snippet === 'string'
        ? raw.snippet
        : typeof raw.description === 'string'
          ? raw.description
          : typeof raw.content === 'string'
            ? raw.content
            : null;
    if (content === null) return null;
    hits.push({
      id: raw.id,
      slug: typeof raw.slug === 'string' && raw.slug ? raw.slug : null,
      title: raw.title,
      content,
      noteType: typeof raw.type === 'string' && raw.type ? raw.type : null,
      status: statusOf(raw.status),
      space: spaceOf(raw.spaceId),
    });
  }
  return hits;
}

/** memory_search 输出（Main bridge 投影的 JSON）→ 命中列表；形状不符返回 null，由调用方回退原文 */
export function parseMemorySearchHits(output: string | null): MemorySearchHit[] | null {
  const parsed = parseRecord(output);
  return parsed ? parseHits(parsed.results) : null;
}

/** memory_upsert 输出 → 展示模型；写入回执不带正文，正文取自调用参数 */
export function parseMemoryCapture(
  output: string | null,
  content: string | undefined
): MemoryCaptureView | null {
  const parsed = parseRecord(output);
  if (!parsed || !content) return null;

  if (parsed.status === 'pending_review' && typeof parsed.title === 'string') {
    return {
      written: false,
      pendingReview: true,
      memory: {
        id: typeof parsed.pendingId === 'string' ? parsed.pendingId : parsed.title,
        slug: typeof parsed.slug === 'string' ? parsed.slug : null,
        title: parsed.title,
        content,
        noteType: null,
        status: 'draft',
        space: spaceOf(parsed.spaceId),
      },
    };
  }

  if (
    (parsed.status === 'created' || parsed.status === 'updated') &&
    typeof parsed.title === 'string'
  ) {
    const slug = typeof parsed.slug === 'string' ? parsed.slug : null;
    return {
      written: true,
      action: parsed.status,
      memory: {
        id:
          typeof parsed.spaceId === 'string' && typeof parsed.relPath === 'string'
            ? `${parsed.spaceId}::${parsed.relPath}`
            : (slug ?? parsed.title),
        slug,
        title: parsed.title,
        content,
        noteType: typeof parsed.type === 'string' && parsed.type ? parsed.type : null,
        status: statusOf(parsed.noteStatus),
        space: spaceOf(parsed.spaceId),
      },
    };
  }

  return null;
}
