import { describe, expect, it } from 'vitest';
import { injectWikiLinksIntoMarkdown, parseWikiLinkHref } from './wikiLinks';

describe('wikiLinks helpers', () => {
  it('converts [[slug]] and [[slug|Alias]] outside code spans and fences', () => {
    const md = [
      '# Title',
      '',
      'See [[systems/auth|Auth System]] and [[domains/cache]].',
      '',
      'Inline `[[ignored/inline]]` stays literal.',
      '',
      '```md',
      '[[ignored/in-fence]]',
      '```',
      '',
      'After fence [[incidents/storm]].',
    ].join('\n');

    const out = injectWikiLinksIntoMarkdown(md);
    expect(out).toContain('[Auth System](wikilink://systems%2Fauth)');
    expect(out).toContain('[domains/cache](wikilink://domains%2Fcache)');
    expect(out).toContain('Inline `[[ignored/inline]]` stays literal.');
    expect(out).toContain('```md\n[[ignored/in-fence]]\n```');
    expect(out).toContain('[incidents/storm](wikilink://incidents%2Fstorm)');
  });

  it('decodes wikilink:// href targets safely and rejects unrelated URLs', () => {
    expect(parseWikiLinkHref('wikilink://systems%2Fauth')).toBe('systems/auth');
    expect(parseWikiLinkHref('https://example.com')).toBeNull();
    expect(parseWikiLinkHref('wikilink://')).toBeNull();
  });
});
