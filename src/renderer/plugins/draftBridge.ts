import type { MentionSegment } from '@/components/chat/mentionComposer';

export interface DraftTarget {
  key: string;
  segments(): readonly MentionSegment[];
  insertText(text: string): void;
  setText(text: string): void;
  busy(): boolean;
  hasReferences?(): boolean;
  revision?(): number;
}
export interface DraftRequest {
  sessionId: string;
  op: 'readDraft' | 'insertText' | 'replaceDraft';
  payload: Record<string, unknown>;
}
export type DraftResult = { ok: true; value: unknown } | { ok: false; code: string; error: string };
let current: {
  target: DraftTarget;
  generation: string;
  revision: number;
  fingerprint: string;
} | null = null;
export function registerDraftTarget(target: DraftTarget): () => void {
  const registered = {
    target,
    generation: crypto.randomUUID(),
    revision: 0,
    fingerprint: draftRev(target.segments()),
  };
  current = registered;
  return () => {
    if (current === registered) current = null;
  };
}
export function draftRev(segments: readonly MentionSegment[]): string {
  return JSON.stringify(segments);
}
/** Internal reference-only edit, using the same owner, busy and optimistic revision lock. */
export function mutateDraftReferences(
  sessionId: string,
  expect: { generation: string; rev: string },
  mutate: () => void
): DraftResult {
  const read = handleDraftRequest({ sessionId, op: 'readDraft', payload: {} });
  if (!read.ok) return read;
  const registered = current;
  if (!registered || registered.target.busy())
    return { ok: false, code: 'DRAFT_BUSY', error: 'Composer is busy or composing' };
  const value = read.value as { generation: string; rev: string };
  if (value.generation !== expect.generation || value.rev !== expect.rev)
    return { ok: false, code: 'DRAFT_CHANGED', error: 'Read the draft again before writing' };
  mutate();
  registered.revision++;
  return { ok: true, value: undefined };
}
export function handleDraftRequest(request: DraftRequest): DraftResult {
  const fail = (code: string, error: string): DraftResult => ({ ok: false, code, error });
  const registered = current;
  if (!registered || registered.target.key !== request.sessionId)
    return fail('NO_COMPOSER', 'No composer in the originating window');
  const { target, generation } = registered;
  const segments = target.segments();
  const fingerprint = draftRev(segments);
  if (fingerprint !== registered.fingerprint) {
    registered.revision++;
    registered.fingerprint = fingerprint;
  }
  const rev = `${registered.revision}:${target.revision?.() ?? 0}`;
  const hasReferences =
    Boolean(target.hasReferences?.()) || segments.some((segment) => segment.type !== 'text');
  if (request.op === 'readDraft')
    return {
      ok: true,
      value: {
        text: segments.map((segment) => (segment.type === 'text' ? segment.text : '')).join(''),
        hasReferences,
        generation,
        rev,
      },
    };
  const { text, expect } = request.payload;
  if (typeof text !== 'string') return fail('INVALID_ARGS', 'text must be a string');
  if (new TextEncoder().encode(text).length > 32768)
    return fail('TOO_LARGE', 'Draft text exceeds 32KB');
  if (target.busy()) return fail('DRAFT_BUSY', 'Composer is busy or composing');
  if (hasReferences)
    return fail('DRAFT_HAS_REFERENCES', 'Draft contains attachments or references');
  if (
    typeof expect !== 'object' ||
    expect === null ||
    !('generation' in expect) ||
    !('rev' in expect) ||
    expect.generation !== generation ||
    expect.rev !== rev
  )
    return fail('DRAFT_CHANGED', 'Read the draft again before writing');
  if (request.op === 'insertText') target.insertText(text);
  else if (request.op === 'replaceDraft') target.setText(text);
  else return fail('INVALID_ARGS', 'Unknown draft operation');
  registered.revision++;
  registered.fingerprint = draftRev(target.segments());
  return {
    ok: true,
    value: { generation, rev: `${registered.revision}:${target.revision?.() ?? 0}` },
  };
}
