// @vitest-environment happy-dom
import type { ThemePalette } from '@shared/theme/types';
import postcss from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./settings', async () => {
  const { create } = await import('zustand');
  return { useSettingsStore: create(() => ({ pluginTheme: 'local.theme/warm' })) };
});

import { pluginPaletteTokens, startPluginThemes, usePluginThemesStore } from './pluginThemes';
import { useSettingsStore } from './settings';

const light: ThemePalette = {
  canvas: '#fff0c9',
  surface: '#fffcf3',
  sunken: '#fff4d9',
  border: '#f2dda4',
  borderStrong: '#ddb45c',
  text: '#4a2c10',
  textMuted: '#7a5126',
  textSubtle: '#9a7445',
  accent: '#b85a00',
};
const dark: ThemePalette = {
  canvas: '#1f160b',
  surface: '#2a1e10',
  sunken: '#231909',
  border: '#44331d',
  borderStrong: '#6a512e',
  text: '#fff1d6',
  textMuted: '#e9cf9f',
  textSubtle: '#b8996a',
  accent: '#ffc42e',
};

describe('pluginPaletteTokens', () => {
  it.each([light, dark])(
    'maps control surfaces and their text from the plugin palette',
    (palette) => {
      const tokens = pluginPaletteTokens(palette);
      expect(tokens).toMatchObject({
        '--background': palette.canvas,
        '--card': palette.surface,
        '--muted': palette.sunken,
        '--secondary': palette.sunken,
        '--accent': palette.sunken,
        '--secondary-foreground': palette.text,
        '--accent-foreground': palette.text,
        '--brand': palette.accent,
      });
      // Navigation must use the wallpaper-adjusted token, not an opaque palette color.
      expect(tokens['--color-nav']).toBe('var(--color-shell)');
      for (const name of ['--success', '--destructive', '--selection', '--color-secondary']) {
        expect(tokens).not.toHaveProperty(name);
      }
    }
  );
});

describe('plugin theme application', () => {
  let changed: (() => void) | undefined;
  let enabled = true;
  let registryError: string | undefined;
  let stop: (() => void) | undefined;
  const offChanged = vi.fn();

  function declarations(selector: string): Record<string, { value: string; important: boolean }> {
    const values: Record<string, { value: string; important: boolean }> = {};
    const css = document.querySelector('style[data-plugin-theme]')?.textContent ?? '';
    postcss.parse(css).walkRules(selector, (rule) => {
      rule.walkDecls((decl) => {
        values[decl.prop] = { value: decl.value, important: Boolean(decl.important) };
      });
    });
    return values;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    enabled = true;
    registryError = undefined;
    changed = undefined;
    usePluginThemesStore.setState({ themes: null, errors: {} });
    useSettingsStore.setState({ pluginTheme: 'local.theme/warm' });
    vi.stubGlobal('electronAPI', {
      extensionPlugins: {
        list: async () => ({
          plugins: [
            {
              id: 'local.theme',
              name: 'Warm theme',
              state: enabled ? 'enabled' : 'disabled',
              themes: [{ id: 'warm', name: 'Warm', path: 'theme.json' }],
            },
          ],
          ...(registryError ? { registryError } : {}),
        }),
        asset: async () => ({
          ok: true,
          base64: btoa(
            JSON.stringify({
              light,
              dark,
              tokens: { light: { '--secondary': '#ffe3aa' }, dark: { '--accent': '#332611' } },
            })
          ),
        }),
        onChanged: (listener: () => void) => {
          changed = listener;
          return offChanged;
        },
      },
    });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
    document.head.replaceChildren();
  });

  it('applies light/dark defaults above built-ins while preserving explicit plugin tokens', async () => {
    stop = startPluginThemes();
    await vi.waitFor(() => expect(usePluginThemesStore.getState().themes).toHaveLength(1));
    expect(declarations(':root:root')).toMatchObject({
      '--secondary': { value: '#ffe3aa', important: true },
      '--accent': { value: light.sunken, important: true },
      '--accent-foreground': { value: light.text, important: true },
      '--color-nav': { value: 'var(--color-shell)', important: true },
    });
    expect(declarations(':root:root.dark')).toMatchObject({
      '--secondary': { value: dark.sunken, important: true },
      '--accent': { value: '#332611', important: true },
      '--secondary-foreground': { value: dark.text, important: true },
      '--color-nav': { value: 'var(--color-shell)', important: true },
    });
  });

  it('removes plugin defaults when deselected, disabled or disposed without mutating the base theme', async () => {
    const before = document.documentElement.style.cssText;
    stop = startPluginThemes();
    await vi.waitFor(() => expect(usePluginThemesStore.getState().themes).toHaveLength(1));
    const style = document.querySelector('style[data-plugin-theme]');
    expect(style?.textContent).toContain('--background');
    useSettingsStore.setState({ pluginTheme: '' });
    expect(style?.textContent).toBe('');
    useSettingsStore.setState({ pluginTheme: 'local.theme/warm' });
    expect(style?.textContent).toContain('--background');
    enabled = false;
    changed?.();
    await vi.waitFor(() => expect(style?.textContent).toBe(''));
    expect(document.documentElement.style.cssText).toBe(before);
    stop();
    stop = undefined;
    expect(document.querySelector('style[data-plugin-theme]')).toBeNull();
    expect(offChanged).toHaveBeenCalledOnce();
  });

  // 插件市场/注册表读不出来时不能把半份数据当主题用：整体回退内置配色，恢复后重新生效。
  it('falls back to the built-in palette when plugins are unavailable, then recovers', async () => {
    stop = startPluginThemes();
    const style = document.querySelector('style[data-plugin-theme]');
    await vi.waitFor(() => expect(style?.textContent).toContain('--background'));
    registryError = 'registry unreadable';
    changed?.();
    await vi.waitFor(() => expect(usePluginThemesStore.getState().themes).toEqual([]));
    expect(style?.textContent).toBe('');
    registryError = undefined;
    changed?.();
    await vi.waitFor(() => expect(style?.textContent).toContain('--background'));
  });
});
