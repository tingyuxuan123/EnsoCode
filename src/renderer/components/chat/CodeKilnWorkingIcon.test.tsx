import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeKilnWorkingIcon, type WorkingIconPhase } from './CodeKilnWorkingIcon';

const render = (phase?: WorkingIconPhase) =>
  renderToStaticMarkup(createElement(CodeKilnWorkingIcon, phase ? { phase } : undefined));

describe('CodeKilnWorkingIcon', () => {
  it('renders an accessible layered kinetic star-bloom SVG aligned to the 22px step column', () => {
    const html = render();
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CodeKiln"');
    expect(html).toContain('codekiln-working-icon');
    expect(html).toContain('size-[calc(22rem/14)] shrink-0');
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('codekiln-spark-rotor');
    expect(html).toContain('codekiln-spark-aura');
    expect(html).toContain('codekiln-spark-triad-primary');
    expect(html).toContain('codekiln-spark-triad-secondary');
    expect(html).toContain('codekiln-spark-rays');
    expect(html).toContain('codekiln-spark-core');
    expect(html).toContain('<radialGradient');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('brand-mark.png');
  });

  it('generates distinct radial gradient ids across concurrent instances', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(CodeKilnWorkingIcon, { phase: 'working' }),
        createElement(CodeKilnWorkingIcon, { phase: 'tool' })
      )
    );
    const ids = [...html.matchAll(/<radialGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('propagates the active phase attribute for phase-tuned cadence', () => {
    expect(render()).toContain('data-phase="working"');
    expect(render('thinking')).toContain('data-phase="thinking"');
    expect(render('tool')).toContain('data-phase="tool"');
    expect(render('writing')).toContain('data-phase="writing"');
    expect(render('loading')).toContain('data-phase="loading"');
  });

  it('animates rotor, aura, interleaved triads, rays, and core continuously while resting open under reduced motion', () => {
    const css = parse(readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8'));
    const selectors = [
      '.codekiln-spark-rotor',
      '.codekiln-spark-aura',
      '.codekiln-spark-triad-primary',
      '.codekiln-spark-triad-secondary',
      '.codekiln-spark-rays',
      '.codekiln-spark-core',
    ];
    const rules = new Map<string, { normal: Map<string, string>; reduced: Map<string, string> }>();
    for (const selector of selectors) {
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
      expect(normal.get('animation'), selector).not.toContain('steps(');
      expect(reduced.get('animation'), selector).toBe('none');
    }

    // Internal SVG layers anchor transforms around exact viewBox center (50% 50%).
    for (const layer of [
      '.codekiln-spark-aura',
      '.codekiln-spark-triad-primary',
      '.codekiln-spark-triad-secondary',
      '.codekiln-spark-rays',
      '.codekiln-spark-core',
    ]) {
      expect(rules.get(layer)?.normal.get('transform-box'), layer).toBe('view-box');
      expect(rules.get(layer)?.normal.get('transform-origin'), layer).toBe('50% 50%');
    }

    expect(rules.get('.codekiln-spark-rotor')?.reduced.get('transform')).toBe('rotate(0deg)');
    expect(rules.get('.codekiln-spark-triad-primary')?.reduced.get('opacity')).toBe('1');
    expect(rules.get('.codekiln-spark-triad-secondary')?.reduced.get('opacity')).toBe('0.78');
    expect(rules.get('.codekiln-spark-rays')?.reduced.get('opacity')).toBe('0');

    // Never mutate animation durations/delays across phase switches (causes live CSS phase jumps).
    const phaseOverrides: string[] = [];
    css.walkRules((rule) => {
      if (!rule.selector.includes('.codekiln-working-icon[data-phase=')) return;
      rule.walkDecls((decl) => {
        if (decl.prop === '--spark-breath' || decl.prop === '--spark-turn') {
          phaseOverrides.push(`${rule.selector}:${decl.prop}`);
        }
      });
    });
    expect(phaseOverrides).toEqual([]);
  });
});
