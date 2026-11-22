import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/wiki/store', () => ({
  useWikiWorkspaceStore: { getState: () => ({ openNote: () => {} }) },
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? key.replace('{{count}}', String(vars.count)) : key,
  }),
}));

import { TurnMemoryCard } from './TurnMemoryCard';

describe('TurnMemoryCard', () => {
  it('folds extra notes and shows the real page paths', () => {
    const html = renderToStaticMarkup(
      createElement(TurnMemoryCard, {
        updates: [
          {
            spaceId: 'proj:p',
            relPath: 'wiki/decisions/a.md',
            title: '决策 A',
            status: 'created' as const,
          },
          { spaceId: 'proj:p', relPath: 'wiki/decisions/b.md', status: 'updated' as const },
          { spaceId: 'proj:p', relPath: 'wiki/decisions/c.md', status: 'updated' as const },
          { spaceId: 'proj:p', relPath: 'wiki/decisions/d.md', status: 'updated' as const },
        ],
      })
    );
    expect(html).toContain('4 wiki notes updated');
    expect(html).toContain('决策 A');
    expect(html).toContain('wiki/decisions/b.md');
    expect(html).toContain('1 more');
    expect(html).not.toContain('wiki/decisions/d.md');
  });
});
