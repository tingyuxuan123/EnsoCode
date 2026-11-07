import { restoreSkillCommands } from '@shared/skillCommands';
import type { AttachedImage } from '@shared/types/agent';
import type { MentionSegment } from './mentionComposer';
import { splitSlashCommand } from './SlashChip';

interface Draft {
  segments: MentionSegment[];
  images: AttachedImage[];
  slash: string | null;
}

export function applyInjectedDraft(
  current: Draft,
  injected: { text?: string; images?: AttachedImage[] },
  append = false
): Draft {
  const hasText = current.segments.some(
    (segment) => segment.type !== 'text' || segment.text.length > 0
  );
  if (append && (hasText || current.slash)) {
    return {
      slash: current.slash,
      segments: [
        ...current.segments,
        ...(injected.text
          ? [{ type: 'text' as const, text: `${hasText ? '\n\n' : ''}${injected.text}` }]
          : []),
      ],
      images: [...current.images, ...(injected.images ?? [])],
    };
  }
  const parsed = splitSlashCommand(restoreSkillCommands(injected.text ?? ''));
  return {
    slash: parsed.slash,
    segments: parsed.rest ? [{ type: 'text', text: parsed.rest }] : [],
    images: [...(append ? current.images : []), ...(injected.images ?? [])],
  };
}
