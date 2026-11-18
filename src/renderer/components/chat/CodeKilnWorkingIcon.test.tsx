import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeKilnWorkingIcon } from './CodeKilnWorkingIcon';

const render = () => renderToStaticMarkup(createElement(CodeKilnWorkingIcon));

describe('CodeKilnWorkingIcon', () => {
  it('renders an accessible 3×3 status grid without changing the 22px footer footprint', () => {
    const html = render();
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CodeKiln"');
    expect(html).toContain('codekiln-working-dots');
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html.match(/class="codekiln-working-dot"/g)).toHaveLength(9);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('animate-ping');
  });

  it('uses the dot loader rather than retaining old working artwork', () => {
    expect(render()).toContain('codekiln-working-dots');
    expect(render()).not.toContain('codekiln-working-icon');
    expect(render()).not.toContain('brand-mark.png');
    expect(render()).not.toContain('animate-eaves-');
  });

  it('uses a looping sequential pulse and disables it for reduced motion', () => {
    const html = render();
    const css = parse(readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8'));
    const normal = new Map<string, string>();
    const reduced = new Map<string, string>();
    css.walkRules('.codekiln-working-dot', (rule) => {
      const parent = rule.parent;
      const declarations =
        parent?.type === 'atrule' && parent.params === '(prefers-reduced-motion: reduce)'
          ? reduced
          : normal;
      rule.walkDecls((decl) => {
        declarations.set(decl.prop, decl.value);
      });
    });
    expect(normal.get('animation')).toContain('codekiln-working-dot');
    expect(normal.get('animation')).toContain('infinite');
    expect(reduced.get('animation')).toBe('none');

    expect(css.toString()).toContain(
      'animation-delay: calc(var(--working-dot-index) * var(--working-dot-step))'
    );
    expect(html).toContain('--working-dot-index:0');
    expect(html).toContain('--working-dot-index:8');
  });
});
