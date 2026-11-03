import type { TimelineItem } from '@/stores/sessions/timeline';
import type { CardDescriptor, PluginCardRendererContribution } from '../vetta/sdk/ui';

export function readDesignCards(value: unknown): CardDescriptor[] {
  if (!Array.isArray(value)) return [];
  const cards = value.filter((item): item is CardDescriptor =>
    Boolean(
      item &&
        typeof item === 'object' &&
        typeof item.type === 'string' &&
        item.type.length > 0 &&
        typeof item.key === 'string' &&
        item.key.length > 0 &&
        typeof item.title === 'string'
    )
  );
  const latest = new Map<string, CardDescriptor>();
  for (const card of cards) if (card.key) latest.set(card.key, card);
  return [...latest.values()];
}

/** Claim cards from the latest anchor backwards, including provisional tool cards. */
export function applyPendingDesignCards(
  items: TimelineItem[],
  renderers: readonly PluginCardRendererContribution[]
): TimelineItem[] {
  const pending = new Map<string, CardDescriptor[]>();
  for (const item of items) {
    if (item.kind !== 'tool' || item.state !== 'running' || !item.designArgs) continue;
    const args = item.designArgs;
    const cards = renderers.flatMap(
      (renderer) => renderer.pendingFor?.({ toolName: item.name, args }) ?? []
    );
    if (cards.length) pending.set(item.key, cards);
  }
  if (pending.size === 0) return items;
  const claimed = new Set<string>();
  const next = items.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i];
    if (item.kind !== 'tool') continue;
    const provisional = pending.get(item.key);
    const cards = provisional ?? item.designCards;
    if (!cards?.length) continue;
    const visible = cards.filter((card) => {
      if (!card.key) return true;
      if (claimed.has(card.key)) return false;
      claimed.add(card.key);
      return true;
    });
    if (provisional || visible.length !== cards.length) next[i] = { ...item, designCards: visible };
  }
  return next;
}
