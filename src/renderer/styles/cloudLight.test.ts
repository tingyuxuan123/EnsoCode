import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./cloudLight.css', import.meta.url), 'utf8');
const root = postcss.parse(css);
const scope = "html[data-light-palette='cloud-light']";

function declarations(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

const tokens = declarations(scope);

function resolve(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const token = tokens[name] ?? tokens[name.replace('--color-', '--')];
    if (!token) throw new Error(`Missing cloud token: ${name}`);
    return resolve(token);
  });
}

describe('Cloud Light neutral palette', () => {
  it('uses the Open Vetta mono light surface and text hierarchy', () => {
    // Local expectations: regression tests must not read the reference checkout.
    expect(tokens).toMatchObject({
      '--shell': '#f8f8f8',
      '--panel': '#faf9f9',
      '--background': '#faf9f9',
      '--card': '#f8f8f8',
      '--popover': '#ffffff',
      '--foreground': '#000000',
      '--secondary': '#f1f0f0',
      '--muted': '#fafafa',
      '--muted-foreground': '#525252',
      '--accent': '#e8e8e8',
      '--border': '#e4e4e4',
      '--input': '#e4e4e4',
    });
    expect(declarations(`${scope}:not(.bg-image-enabled)`)['--color-nav']).toBe('#f8f8f8');
  });

  it('keeps primary actions monochrome and user messages quiet rather than blue', () => {
    for (const token of ['--primary', '--brand', '--ring']) {
      expect(resolve(tokens[token]), token).toBe('#000000');
    }
    expect(resolve(tokens['--primary-foreground'])).toBe('#ffffff');
    const bubble = declarations(`${scope} [data-slot='chat-view'] .group\\/user > .bg-muted`);
    expect(resolve(bubble['background-color'])).toBe('#f1f0f0');
    expect(resolve(bubble.color)).toBe('#000000');
  });

  it('uses a white composer and a faint inactive send control', () => {
    const composer = declarations(`${scope} [data-slot='composer']`);
    expect(composer['background-color']).toBe('var(--color-popover)');
    const focused = declarations(`${scope} [data-slot='composer']:focus-within`);
    expect(focused['border-color']).toBe('var(--cloud-focus-border)');
    expect(tokens['--cloud-focus-border']).toBe('var(--selection-border)');
    const inactive = declarations(`${scope} [data-slot='composer'] button.bg-brand:disabled`);
    expect(resolve(inactive.color)).toBe('#b4b4b4');
    expect(inactive['background-color']).toBe('rgb(180 180 180 / 0.22)');
  });

  it('distinguishes the sidebar view switcher track and selected tab from navigation', () => {
    const sidebar = `${scope} [data-slot='project-sidebar']`;
    const track = declarations(`${sidebar} [data-slot='tabs-list']`);
    const indicator = declarations(`${sidebar} [data-slot='tab-indicator']`);

    // --muted / --background are nearly identical to navigation in this palette.
    // The neutral track follows wallpaper; persistent selection keeps its own alpha.
    expect(track['background-color']).toBe('var(--color-secondary)');
    expect(indicator['background-color']).toBe('var(--selection)');
    expect(resolve(track['background-color'])).toBe('#f1f0f0');
    expect(indicator['box-shadow']).toBe('inset 0 0 0 1px var(--selection-border)');

    for (const styles of [track, indicator]) {
      for (const property of ['height', 'width', 'padding', 'margin', 'border-radius']) {
        expect(styles[property], property).toBeUndefined();
      }
    }
  });

  it('scopes every override to the opt-in palette and preserves wallpaper navigation', () => {
    root.walkRules((rule) => {
      expect(rule.selector.startsWith(scope), rule.selector).toBe(true);
      if (rule.nodes.some((node) => node.type === 'decl' && node.prop === '--color-nav')) {
        expect(rule.selector).toContain(':not(.bg-image-enabled)');
      }
    });
    expect(css).not.toContain('--cloud-blue-');
  });
});
