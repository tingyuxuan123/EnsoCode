import type { AttachedImage } from '@shared/types/agent';
import { type AgentTypeMentionCandidate, parseMentionCandidate } from '@shared/types/mentions';
import type { MentionSegment } from './mentionComposer';

export interface ComposerDraft {
  segments: MentionSegment[];
  images: AttachedImage[];
  slash: string | null;
  recipient?: AgentTypeMentionCandidate;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (focusKey: string) => `enso-composer-draft:${focusKey}`;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Rebuild only known fields; localStorage is untrusted and never contains image bodies. */
function segment(value: unknown): MentionSegment | null {
  if (!record(value)) return null;
  if (value.type === 'text' && typeof value.text === 'string')
    return { type: 'text', text: value.text };
  if (value.type === 'file' && nonempty(value.path))
    return {
      type: 'file',
      path: value.path,
      ...(nonempty(value.label) ? { label: value.label } : {}),
    };
  if (value.type === 'chat' && nonempty(value.label) && nonempty(value.sessionFile))
    return { type: 'chat', label: value.label, sessionFile: value.sessionFile };
  if (
    value.type === 'ui-element' &&
    nonempty(value.id) &&
    nonempty(value.label) &&
    nonempty(value.path) &&
    typeof value.text === 'string'
  )
    return {
      type: 'ui-element',
      id: value.id,
      label: value.label,
      path: value.path,
      text: value.text,
      imageId: '',
    };
  return null;
}

function persistentDraft(value: unknown): ComposerDraft | undefined {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.segments)) return;
  const segments = value.segments
    .map(segment)
    .filter((item): item is MentionSegment => item !== null);
  const recipient = parseMentionCandidate(value.recipient);
  return {
    segments,
    images: [],
    slash: nonempty(value.slash) ? value.slash : null,
    ...(recipient?.kind === 'agent-type' ? { recipient } : {}),
  };
}

/** Synchronous write-through: reload/normal exit cannot race a debounce or IPC flush. */
export function createComposerDrafts(storage: () => DraftStorage) {
  const memory = new Map<string, ComposerDraft>();
  return {
    get(focusKey: string): ComposerDraft | undefined {
      const current = memory.get(focusKey);
      if (current) return current;
      try {
        const draft = persistentDraft(JSON.parse(storage().getItem(key(focusKey)) ?? 'null'));
        if (draft) memory.set(focusKey, draft);
        return draft;
      } catch {
        return undefined;
      }
    },
    set(focusKey: string, draft: ComposerDraft) {
      const empty =
        !draft.segments.some((item) => item.type !== 'text' || item.text.length > 0) &&
        !draft.images.length &&
        !draft.slash &&
        !draft.recipient;
      if (empty) memory.delete(focusKey);
      else memory.set(focusKey, draft);
      try {
        const saved = persistentDraft({
          version: 1,
          segments: draft.segments,
          slash: draft.slash,
          recipient: draft.recipient,
        });
        if (!saved || (!saved.segments.length && !saved.slash && !saved.recipient))
          storage().removeItem(key(focusKey));
        else
          storage().setItem(
            key(focusKey),
            JSON.stringify({
              version: 1,
              segments: saved.segments,
              slash: saved.slash,
              recipient: saved.recipient,
            })
          );
      } catch {
        /* Storage quota/disabled: input and in-memory drafts still work. */
      }
    },
    delete(focusKey: string) {
      memory.delete(focusKey);
      try {
        storage().removeItem(key(focusKey));
      } catch {
        /* Best effort. */
      }
    },
  };
}

export const composerDrafts = createComposerDrafts(() => localStorage);
