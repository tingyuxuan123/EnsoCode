import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeKilnWorkingIcon, type WorkingIconPhase } from './CodeKilnWorkingIcon';

const render = (phase?: WorkingIconPhase) =>
  renderToStaticMarkup(createElement(CodeKilnWorkingIcon, phase ? { phase } : undefined));

describe('CodeKilnWorkingIcon', () => {
  it('renders an accessible Enso orbital SVG within the 22px footer footprint', () => {
    const html = render();
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CodeKiln"');
    expect(html).toContain('codekiln-working-icon');
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html).toContain('<svg');
    expect(html).toContain('codekiln-working-track');
    expect(html).toContain('codekiln-working-orbit');
    expect(html).toContain('codekiln-working-arc-tail');
    expect(html).toContain('codekiln-working-arc-head');
    expect(html).toContain('codekiln-working-halo');
    expect(html).toContain('codekiln-working-core');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('brand-mark.png');
    expect(html).not.toContain('animate-ping');
    expect(html).not.toContain('codekiln-working-dots');
  });

  it('propagates the active phase attribute for phase-tuned cadence', () => {
    expect(render()).toContain('data-phase="working"');
    expect(render('thinking')).toContain('data-phase="thinking"');
    expect(render('tool')).toContain('data-phase="tool"');
    expect(render('writing')).toContain('data-phase="writing"');
    expect(render('loading')).toContain('data-phase="loading"');
  });

  it('animates the orbit, comet sweep, and core while respecting reduced motion', () => {
    const css = parse(readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8'));
    const rules = new Map<string, { normal: Map<string, string>; reduced: Map<string, string> }>();
    for (const selector of [
      '.codekiln-working-orbit',
      '.codekiln-working-arc-head',
      '.codekiln-working-halo',
      '.codekiln-working-core',
    ]) {
      const normal = new Map<string, string>();
      const reduced = new Map<string, string>();
      css.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        const parent = rule.parent;
        const target =
          parent?.type === 'atrule' && parent.params === '(prefers-reduced-motion: reduce)'
            ? reduced
            : normal;
        rule.walkDecls((decl) => {
          target.set(decl.prop, decl.value);
        });
      });
      rules.set(selector, { normal, reduced });
    }

    for (const [selector, { normal, reduced }] of rules) {
      expect(normal.get('animation'), selector).toContain('infinite');
      expect(reduced.get('animation'), selector).toBe('none');
    }
    expect(rules.get('.codekiln-working-orbit')?.reduced.get('transform')).toBe('rotate(-45deg)');
  });
});
