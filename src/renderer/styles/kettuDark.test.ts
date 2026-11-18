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

// Kettu 的深色令牌（src/renderer/src/styles/tokens.css 的 [data-theme='dark']）。本地写死期望值：
// 回归测试不读 Kettu 检出目录，也不联网。
const app = '#141416';
const sidebar = '#0e0e10';
const surface = '#212124';
const text = '#e6e6e7';

describe('Kettu dark palette', () => {
  it('uses the Kettu dark desk, sheets, text and hairlines', () => {
    const expected = {
      '--background': app,
      '--foreground': text,
      '--card': surface,
      '--card-foreground': text,
      '--popover': surface,
      '--popover-foreground': text,
      '--primary': text,
      '--primary-foreground': app,
      '--secondary': '#2a2a2d',
      '--secondary-foreground': text,
      '--muted': '#2a2a2d',
      '--muted-foreground': '#ababad',
      '--accent': 'rgb(255 255 255 / 6%)',
      '--accent-foreground': text,
      '--border': 'rgb(255 255 255 / 12%)',
      '--input': 'rgb(255 255 255 / 18%)',
      '--ring': 'color-mix(in oklch, #f2581b 50%, transparent)',
      '--brand': '#f2581b',
      '--brand-foreground': '#ffffff',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(resolve(dark[token]), token).toBe(value);
    }
  });

  it('uses the Kettu dark status colours and its raised-sheet shadow', () => {
    expect(dark).toMatchObject({
      '--destructive': '#ea8a7d',
      '--destructive-foreground': '#121213',
      '--success': '#6fbf8f',
      '--success-foreground': '#121213',
      '--warning': '#d9b463',
      '--warning-foreground': '#141416',
      '--info': '#aeb6c1',
      '--info-foreground': '#141416',
      '--elevation-float': '0 0 0 0.5px rgb(255 255 255 / 10%), 0 16px 36px -16px rgb(0 0 0 / 70%)',
    });
  });

  it('maps the shell to the Kettu sidebar and the panel to the page', () => {
    expect(resolve(dark['--shell'])).toBe(sidebar);
    expect(resolve(dark['--panel'])).toBe(app);
    expect(dark['--color-nav']).toBe('var(--color-shell)');
    expect(dark['--color-line']).toBe('var(--color-border)');
    expect(dark['--color-faint']).toBe('#6e6e72');
    // Use the remapped tokens so wallpaper mode still controls opacity.
    const wallpaper = declarations(desktop, 'html.bg-image-enabled');
    expect(wallpaper['--color-shell']).toContain('var(--bg-panel-alpha');
    expect(wallpaper['--color-border']).toContain('var(--bg-border-alpha');
  });

  it('keeps desktop dark overrides separate from light and custom accent presets', () => {
    expect(declarations(desktop, ':root')['--background']).toBe('rgb(245 248 250)');
    expect(declarations(shared, "html.dark[data-accent='teal']")['--brand']).toBe(
      'rgb(69 190 186)'
    );
    expect(declarations(shared, "html.dark[data-accent='fox']")['--brand']).toBe('#f2581b');
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
    // 选中块是中性的，不跟着强调色染。
    expect(declarations(shared, '.dark')['--selection']).toBe('rgb(255 255 255 / 8%)');
  });
});
