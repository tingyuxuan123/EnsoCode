import postcss, { type Node } from 'postcss';
import { describe, expect, it } from 'vitest';
import { isDesignStylesheet, scopeDesignCss } from './style-scope';

describe('design CSS boundary', () => {
  it('scopes theme, devices and nested utilities without changing keyframe selectors', () => {
    const css = scopeDesignCss(
      '@layer theme{:root,:host{--color-red:red}} @media(width>1px){.device{display:block}} .x:hover{color:red} @keyframes spin{to{rotate:1turn}}'
    );
    const root = postcss.parse(css);
    root.walkRules((rule) => {
      if (rule.selector === 'to') return;
      let parent: Node | undefined = rule.parent;
      while (parent && !(parent.type === 'atrule' && 'name' in parent && parent.name === 'scope'))
        parent = parent.parent;
      expect(parent, rule.selector).toBeTruthy();
    });
    expect(css).toContain(':scope');
    expect(css).not.toContain(':root');
    expect(css).toContain('data-vetta-plugin-root="vetta-ui-design"');
    expect(css).toContain('@keyframes spin{to{rotate:1turn}}');
  });
  it('never transforms host CSS or opaque JS resource imports', () => {
    const file = '/src/renderer/features/design/vetta/src/style.css';
    expect(isDesignStylesheet(file)).toBe(true);
    expect(isDesignStylesheet(`${file}?direct&t=1`)).toBe(true);
    for (const id of [`${file}?raw`, `${file}?url`, '/src/renderer/styles/globals.css'])
      expect(isDesignStylesheet(id)).toBe(false);
  });
  it('gives Iconify defaults lower priority without taking them out of scope', () => {
    const root = postcss.parse(
      scopeDesignCss(
        '@layer utilities{.icon-\\[solar--ruler-pen-linear\\]{width:1em}.w-4{width:1rem}}'
      )
    );
    root.walkRules((rule) => {
      if (rule.selector.startsWith('.icon-')) {
        expect(rule.parent).toMatchObject({ name: 'scope' });
        expect(rule.parent?.parent).toMatchObject({ name: 'layer', params: 'vetta-plugin-icons' });
      }
    });
  });
});
