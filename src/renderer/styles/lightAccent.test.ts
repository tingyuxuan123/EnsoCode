import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

function declarations(file: string, selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  postcss
    .parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
    .walkRules(selector, (rule) => {
      rule.walkDecls((decl) => {
        result[decl.prop] = decl.value;
      });
    });
  return result;
}

describe('light palette accent overrides', () => {
  it.each([
    ['ocean', 'rgb(64 138 191)'],
    ['indigo', 'rgb(79 70 229)'],
    ['violet', 'rgb(124 78 214)'],
    ['teal', 'rgb(13 138 136)'],
    ['amber', 'rgb(180 116 12)'],
    ['graphite', 'rgb(60 66 80)'],
  ])('%s explicitly outranks a light-palette default without affecting dark', (accent, color) => {
    expect(
      declarations('./shared.css', `html:not(.dark)[data-accent='${accent}']`)['--brand']
    ).toBe(color);
  });

  it.each(['mint-light', 'cloud-light'])(
    '%s persistent selection and focus use the chosen accent',
    (palette) => {
      const file = palette === 'mint-light' ? './mintLight.css' : './cloudLight.css';
      const scope = `html[data-light-palette='${palette}']`;
      expect(declarations(file, scope)['--ring']).toBe('var(--brand)');
      expect(
        declarations(file, `${scope} [data-slot='conversation-row'][data-active='true']`)[
          'background-color'
        ]
      ).toBe('var(--selection)');
      const card = declarations(
        file,
        `${scope} [data-slot='settings-window'] button[aria-pressed='true'].border-2`
      );
      expect(card['border-color']).toBe('var(--selection-border)');
      expect(card['background-color']).toBe('var(--selection)');
      expect(card.color).toBe('var(--selection-foreground)');
    }
  );
});
