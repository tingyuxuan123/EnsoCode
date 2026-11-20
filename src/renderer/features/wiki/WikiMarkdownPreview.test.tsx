import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WikiMarkdownPreview } from './WikiMarkdownPreview';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '') : key,
  }),
}));

describe('WikiMarkdownPreview', () => {
  it('renders [[wikilinks]] as clickable buttons and distinguishes broken targets', () => {
    const broken = new Set(['notes/missing']);
    const html = renderToStaticMarkup(
      createElement(WikiMarkdownPreview, {
        markdown: 'Link to [[systems/auth|Auth]] and [[notes/missing]].',
        brokenTargets: broken,
        onOpenWikiLink: () => {},
      })
    );
    expect(html).toContain('data-wikilink="systems/auth"');
    expect(html).toContain('Auth');
    expect(html).toContain('data-wikilink="notes/missing"');
    expect(html).toContain('text-destructive');
  });
});
