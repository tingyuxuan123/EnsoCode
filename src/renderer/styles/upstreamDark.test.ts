import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const desktop = postcss.parse(readFileSync(new URL('./globals.css', import.meta.url), 'utf8'));
const shared = postcss.parse(readFileSync(new URL('./shared.css', import.meta.url), 'utf8'));

function declarations(root: postcss.Root, selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

const dark = { ...declarations(shared, '.dark'), ...declarations(desktop, '.dark') };

function resolve(value: string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    if (!dark[name]) throw new Error(`Missing dark token: ${name}`);
    return resolve(dark[name]);
  });
}

// J3n5en/EnsoCode 4bc6eb9c: src/shared/theme/builtinThemes.ts (Enso dark)
// + derive.ts. Keep local expectations; tests must not depend on a checkout or network.
const surface = 'oklch(0.205 0.007 286)';
const text = 'oklch(0.94 0.004 286)';
const canvas = 'oklch(0.165 0.006 286)';
const mix = (color: string, percent: number, base: string) =>
  `color-mix(in oklch, ${color} ${percent}%, ${base})`;

describe('upstream Enso dark palette', () => {
  it('uses upstream surfaces, text, controls and border colours', () => {
    const expected = {
      '--background': surface,
      '--foreground': text,
      '--card': mix(text, 3, surface),
      '--card-foreground': text,
      '--popover': mix(text, 5, surface),
      '--popover-foreground': text,
      '--primary': text,
      '--primary-foreground': surface,
      '--secondary': mix(text, 6, surface),
      '--secondary-foreground': text,
      '--muted': mix(text, 7, surface),
      '--muted-foreground': 'oklch(0.74 0.008 286)',
      '--accent': mix(text, 6, 'transparent'),
      '--accent-foreground': text,
      '--border': 'oklch(1 0 0 / 0.07)',
      '--input': 'oklch(1 0 0 / 0.13)',
      '--ring': mix('oklch(0.7 0.16 285)', 50, 'transparent'),
      '--brand': 'oklch(0.7 0.16 285)',
      '--brand-foreground': canvas,
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(resolve(dark[token]), token).toBe(value);
    }
  });

  it('uses upstream status colours and floating shadow', () => {
    expect(dark).toMatchObject({
      '--destructive': 'oklch(0.396 0.141 25.72)',
      '--destructive-foreground': 'oklch(0.985 0 0)',
      '--success': 'oklch(0.527 0.154 150.07)',
      '--success-foreground': 'oklch(0.985 0 0)',
      '--warning': 'oklch(0.769 0.189 70.08)',
      '--warning-foreground': 'oklch(0.205 0.014 285.82)',
      '--info': 'oklch(0.623 0.214 259.81)',
      '--info-foreground': 'oklch(0.985 0 0)',
      '--elevation-float': '0 1px 2px oklch(0 0 0 / 0.3), 0 16px 40px -12px oklch(0 0 0 / 0.55)',
    });
  });

  it('maps fork shell/navigation to upstream canvas and content to upstream surface', () => {
    expect(resolve(dark['--shell'])).toBe(canvas);
    expect(resolve(dark['--panel'])).toBe(surface);
    expect(dark['--color-nav']).toBe('var(--color-shell)');
    expect(dark['--color-line']).toBe('var(--color-border)');
    expect(dark['--color-faint']).toBe('oklch(0.56 0.01 286)');
    // Use the remapped tokens so wallpaper mode still controls opacity.
    const wallpaper = declarations(desktop, 'html.bg-image-enabled');
    expect(wallpaper['--color-shell']).toContain('var(--bg-panel-alpha');
    expect(wallpaper['--color-border']).toContain('var(--bg-border-alpha');
  });

  it('keeps desktop dark overrides separate from light, PWA and custom accent presets', () => {
    expect(declarations(desktop, ':root')['--background']).toBe('rgb(245 248 250)');
    expect(declarations(shared, '.dark')['--brand']).toBe('rgb(114 165 202)');
    expect(declarations(shared, "html.dark[data-accent='teal']")['--brand']).toBe(
      'rgb(69 190 186)'
    );
    expect(declarations(desktop, '.dark')['color-scheme']).toBe('dark');
    for (const property of ['--radius', '--font-size-base', 'padding', 'margin', 'width']) {
      expect(declarations(desktop, '.dark')[property], property).toBeUndefined();
    }
  });

  it('multiplies wallpaper opacity by the upstream translucent border and hover alpha', () => {
    const wallpaper = declarations(desktop, 'html.bg-image-enabled');
    for (const [token, opacity] of [
      ['accent', 'panel'],
      ['border', 'border'],
      ['input', 'border'],
    ]) {
      const fallback = opacity === 'panel' ? '0.15' : '0.4';
      expect(wallpaper[`--color-${token}`]).toBe(
        `oklch(from var(--${token}) l c h / calc(alpha * var(--bg-${opacity}-alpha, ${fallback})))`
      );
    }
  });

  it('uses the shared selection contract instead of a sidebar-only colour patch', () => {
    const sidebar = "html.dark [data-slot='project-sidebar']";
    const track = declarations(desktop, `${sidebar} [data-slot='tabs-list']`);
    const indicator = declarations(desktop, `${sidebar} [data-slot='tab-indicator']`);
    const active = declarations(desktop, `${sidebar} [data-slot='tabs-trigger'][data-active]`);
    // All default tabs now use selection tokens; the Cloud Light exception is kept separately.
    expect(track).toEqual({});
    expect(indicator).toEqual({});
    expect(active).toEqual({});
    expect(declarations(shared, '.dark')['--selection']).toContain('var(--brand)');
  });
});
