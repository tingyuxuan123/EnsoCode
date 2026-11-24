import type { InlineExtension, SessionEntry } from '@earendil-works/pi-coding-agent';

const LEGACY_REVIEW_MARKER = 'codekiln.project-memory-review';

export function isLegacyMemoryReviewMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    message.role === 'custom' &&
    'customType' in message &&
    message.customType === LEGACY_REVIEW_MARKER
  );
}

/** The old closeout was internal history, from its persisted marker until the next user turn. */
export function legacyMemoryReviewEntries(branch: readonly SessionEntry[]): Set<SessionEntry> {
  const hidden = new Set<SessionEntry>();
  let inside = false;
  for (const entry of branch) {
    if (entry.type === 'custom_message' && entry.customType === LEGACY_REVIEW_MARKER) {
      inside = true;
      hidden.add(entry);
    } else if (inside && entry.type === 'message' && entry.message?.role === 'user') {
      inside = false;
    } else if (inside && (entry.type === 'message' || entry.type === 'custom_message')) {
      hidden.add(entry);
    }
  }
  return hidden;
}

/** Keep persisted instructions inactive without changing the journal or the SDK lifecycle. */
export const legacyMemoryReviewContext: InlineExtension = {
  name: 'legacy-review-history',
  hidden: true,
  factory(pi) {
    pi.on('context', ({ messages }) => {
      if (messages.some(isLegacyMemoryReviewMessage)) {
        return { messages: messages.filter((message) => !isLegacyMemoryReviewMessage(message)) };
      }
    });
  },
};
