import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeKilnWorkingIcon } from './CodeKilnWorkingIcon';

const render = () => renderToStaticMarkup(createElement(CodeKilnWorkingIcon));

describe('CodeKilnWorkingIcon', () => {
  it('renders the accessible CodeKiln logo without changing the 22px footer footprint', () => {
    const html = render();
    expect(html).toContain('<img');
    expect(html).toContain('brand-mark.png');
    expect(html).toContain('alt="CodeKiln"');
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html).not.toContain('<path');
    expect(html).not.toContain('animate-ping');
  });

  it('animates only the working logo rather than retaining old rain-curtain artwork', () => {
    expect(render()).toContain('codekiln-working-icon');
    expect(render()).not.toContain('animate-eaves-');
  });

  it('uses a looping animation and restores a fully visible static logo for reduced motion', () => {
    const css = parse(readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8'));
    const normal = new Map<string, string>();
    const reduced = new Map<string, string>();
    css.walkRules('.codekiln-working-icon', (rule) => {
      const parent = rule.parent;
      const declarations =
        parent?.type === 'atrule' && parent.params === '(prefers-reduced-motion: reduce)'
          ? reduced
          : normal;
      rule.walkDecls((decl) => {
        declarations.set(decl.prop, decl.value);
      });
    });
    expect(normal.get('animation')).toContain('codekiln-working-breathe');
    expect(normal.get('animation')).toContain('infinite');
    expect(reduced.get('animation')).toBe('none');
    expect(reduced.get('transform')).toBe('none');
    expect(reduced.get('opacity')).toBe('1');
  });
});
