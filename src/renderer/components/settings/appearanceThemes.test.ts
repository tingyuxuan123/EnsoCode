import { readFileSync } from 'node:fs';
import { LIGHT_PALETTES, type LightPalette } from '@shared/lightPalette';
import type { ThemeDefinition } from '@shared/theme/types';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEME_NAMES,
  BUILTIN_THEME_PREVIEW,
  buildThemeEntries,
  themeEntryId,
  themeSelectionPatch,
} from './appearanceThemes';

function pluginTheme(id: string, name: string, pluginName = 'Demo plugin'): ThemeDefinition {
  return {
    id: id as ThemeDefinition['id'],
    name,
    source: { kind: 'plugin', pluginId: id.split('/')[0], pluginName },
    light: {
      canvas: '#faf9f9',
      surface: '#ffffff',
      sunken: '#f1f0f0',
      border: '#e4e4e4',
      borderStrong: '#d4d4d4',
      text: '#000000',
      textMuted: '#525252',
      textSubtle: '#737373',
      accent: '#7c4ed6',
    },
    dark: {
      canvas: '#111113',
      surface: '#1a1a1d',
      sunken: '#232326',
      border: '#2c2c30',
      borderStrong: '#3a3a40',
      text: '#f5f5f5',
      textMuted: '#a1a1aa',
      textSubtle: '#71717a',
      accent: '#a78bfa',
    },
  };
}

describe('buildThemeEntries', () => {
  it('lists every built-in palette first, in palette order', () => {
    const entries = buildThemeEntries({ pluginThemes: [], pluginTheme: '', mode: 'light' });
    expect(entries.map((entry) => (entry.kind === 'builtin' ? entry.palette : entry.kind))).toEqual(
      [...LIGHT_PALETTES]
    );
    for (const entry of entries) {
      if (entry.kind !== 'builtin') throw new Error(`unexpected entry: ${entry.kind}`);
      expect(entry.nameKey).toBe(BUILTIN_THEME_NAMES[entry.palette]);
      expect(entry.preview).toEqual(BUILTIN_THEME_PREVIEW[entry.palette]);
    }
  });

  it('appends plugin themes after the built-ins with the preview of the current mode', () => {
    const theme = pluginTheme('local.demo/mint', 'Demo Mint');
    const light = buildThemeEntries({ pluginThemes: [theme], pluginTheme: '', mode: 'light' });
    const dark = buildThemeEntries({ pluginThemes: [theme], pluginTheme: '', mode: 'dark' });

    expect(light).toHaveLength(LIGHT_PALETTES.length + 1);
    expect(light.at(-1)).toEqual({
      kind: 'plugin',
      id: 'local.demo/mint',
      name: 'Demo Mint',
      pluginName: 'Demo plugin',
      preview: {
        canvas: '#faf9f9',
        surface: '#ffffff',
        sunken: '#f1f0f0',
        border: '#e4e4e4',
        accent: '#7c4ed6',
      },
    });
    expect(dark.at(-1)?.preview).toMatchObject({ canvas: '#111113', accent: '#a78bfa' });
  });

  it('keeps a placeholder for a selected plugin theme that is no longer installed', () => {
    const entries = buildThemeEntries({
      pluginThemes: [pluginTheme('local.demo/mint', 'Demo Mint')],
      pluginTheme: 'local.gone/x',
      mode: 'light',
    });
    expect(entries.at(-1)).toEqual({
      kind: 'plugin-unavailable',
      id: 'local.gone/x',
      preview: null,
    });
  });

  it('does not invent a placeholder while plugin themes are still loading', () => {
    const entries = buildThemeEntries({
      pluginThemes: null,
      pluginTheme: 'local.gone/x',
      mode: 'light',
    });
    expect(entries.every((entry) => entry.kind === 'builtin')).toBe(true);
  });
});

describe('themeEntryId', () => {
  it('marks the explicitly selected plugin theme', () => {
    expect(themeEntryId('local.demo/mint', 'cloud-light')).toBe('local.demo/mint');
  });

  it('falls back to the saved built-in palette', () => {
    expect(themeEntryId('', 'mint-light')).toBe('builtin:mint-light');
  });
});

describe('themeSelectionPatch', () => {
  const [builtinEntry, , ...rest] = buildThemeEntries({
    pluginThemes: [pluginTheme('local.demo/mint', 'Demo Mint')],
    pluginTheme: '',
    mode: 'light',
  });
  const pluginEntry = rest.at(-1);

  it('switching to a built-in theme clears the plugin override', () => {
    expect(themeSelectionPatch(builtinEntry)).toEqual({ pluginTheme: '', lightPalette: 'ocean' });
  });

  it('selecting a plugin theme leaves the saved built-in palette alone', () => {
    if (!pluginEntry) throw new Error('missing plugin entry');
    const patch = themeSelectionPatch(pluginEntry);
    expect(patch).toEqual({ pluginTheme: 'local.demo/mint' });
    expect('lightPalette' in patch).toBe(false);
  });

  it('the unavailable placeholder never rewrites settings', () => {
    expect(
      themeSelectionPatch({ kind: 'plugin-unavailable', id: 'local.gone/x', preview: null })
    ).toEqual({});
  });
});

/** 卡片预览色必须跟浅色方案的 CSS 保持一份来源，避免改色后卡片继续显示旧配色。 */
describe('built-in preview palettes', () => {
  const cases: Array<{ palette: LightPalette; file: string; selector: string }> = [
    { palette: 'ocean', file: './../../styles/globals.css', selector: ':root' },
    {
      palette: 'mint-light',
      file: './../../styles/mintLight.css',
      selector: "html[data-light-palette='mint-light']",
    },
    {
      palette: 'cloud-light',
      file: './../../styles/cloudLight.css',
      selector: "html[data-light-palette='cloud-light']",
    },
  ];
  /** 预览槽位 → 浅色方案里的 CSS 变量 */
  const TOKENS = {
    canvas: '--shell',
    surface: '--background',
    sunken: '--muted',
    border: '--border',
    accent: '--primary',
  } as const;

  function declarations(file: string, selector: string): Record<string, string> {
    const result: Record<string, string> = {};
    postcss
      .parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
      .walkRules(selector, (rule) => {
        rule.walkDecls((declaration) => {
          result[declaration.prop] = declaration.value;
        });
      });
    return result;
  }

  function normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  it.each(cases)('$palette cards match the CSS palette', ({ palette, file, selector }) => {
    const vars = declarations(file, selector);
    const resolve = (value: string): string =>
      value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
        const token = vars[name];
        if (!token) throw new Error(`${palette}: missing ${name}`);
        return resolve(token);
      });

    for (const [slot, token] of Object.entries(TOKENS)) {
      const css = vars[token];
      expect(css, `${palette}/${token}`).toBeDefined();
      expect(normalize(BUILTIN_THEME_PREVIEW[palette][slot as keyof typeof TOKENS]), slot).toBe(
        normalize(resolve(css))
      );
    }
  });
});
