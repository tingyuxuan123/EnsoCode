import { LIGHT_PALETTES, type LightPalette } from '@shared/lightPalette';
import type { ThemeDefinition, ThemeMode } from '@shared/theme/types';

/**
 * 主题预览卡片只画侧栏 / 内容 / 输入框三层，所以只取调色板里的五个槽位；
 * 插件主题直接复用 `ThemePalette`，内置浅色方案用下面的固定值。
 */
export interface ThemePreviewPalette {
  canvas: string;
  surface: string;
  sunken: string;
  border: string;
  accent: string;
}

/**
 * 内置浅色方案的卡片预览色，与 `styles/globals.css`(:root)、`cloudLight.css`、
 * `mintLight.css` 同源；改配色时两处一起改，回归见 appearanceThemes.test.ts。
 */
export const BUILTIN_THEME_PREVIEW: Record<LightPalette, ThemePreviewPalette> = {
  ocean: {
    canvas: 'rgb(234 241 245)',
    surface: 'rgb(245 248 250)',
    sunken: 'rgb(228 236 241)',
    border: 'rgb(205 219 228)',
    accent: 'rgb(64 138 191)',
  },
  'mint-light': {
    canvas: '#f3f6f4',
    surface: '#ffffff',
    sunken: '#f1f4f2',
    border: '#dee5e0',
    accent: '#106c3e',
  },
  'cloud-light': {
    canvas: '#f8f8f8',
    surface: '#faf9f9',
    sunken: '#fafafa',
    border: '#e4e4e4',
    accent: '#000000',
  },
};

/** 内置主题的显示名就是 i18n key */
export const BUILTIN_THEME_NAMES: Record<LightPalette, string> = {
  ocean: 'Ocean Light',
  'mint-light': 'Mint Light',
  'cloud-light': 'Cloud Light',
};

export interface BuiltinThemeEntry {
  kind: 'builtin';
  id: string;
  palette: LightPalette;
  nameKey: string;
  preview: ThemePreviewPalette;
}

export interface PluginThemeEntry {
  kind: 'plugin';
  id: string;
  name: string;
  pluginName: string;
  preview: ThemePreviewPalette;
}

/** 已选插件主题被停用 / 卸载时的占位卡，避免选中项凭空消失。 */
export interface UnavailablePluginThemeEntry {
  kind: 'plugin-unavailable';
  id: string;
  preview: null;
}

export type ThemeEntry = BuiltinThemeEntry | PluginThemeEntry | UnavailablePluginThemeEntry;

export function builtinThemeEntryId(palette: LightPalette): string {
  return `builtin:${palette}`;
}

/** 当前选中的卡片：显式插件主题优先，否则是保存的浅色方案（docs/plugins.md 的覆盖规则）。 */
export function themeEntryId(pluginTheme: string, lightPalette: LightPalette): string {
  return pluginTheme || builtinThemeEntryId(lightPalette);
}

export function buildThemeEntries(input: {
  /** null 表示插件主题还在加载，此时不能把已选 id 当成失效 */
  pluginThemes: readonly ThemeDefinition[] | null;
  pluginTheme: string;
  mode: ThemeMode;
}): ThemeEntry[] {
  const builtins: BuiltinThemeEntry[] = LIGHT_PALETTES.map((palette) => ({
    kind: 'builtin',
    id: builtinThemeEntryId(palette),
    palette,
    nameKey: BUILTIN_THEME_NAMES[palette],
    preview: BUILTIN_THEME_PREVIEW[palette],
  }));
  const plugins: PluginThemeEntry[] = (input.pluginThemes ?? []).map((theme) => {
    const palette = input.mode === 'dark' ? theme.dark : theme.light;
    return {
      kind: 'plugin',
      id: theme.id,
      name: theme.name,
      pluginName: theme.source.pluginName,
      preview: {
        canvas: palette.canvas,
        surface: palette.surface,
        sunken: palette.sunken,
        border: palette.border,
        accent: palette.accent,
      },
    };
  });
  const missing =
    input.pluginThemes !== null &&
    input.pluginTheme !== '' &&
    !plugins.some((entry) => entry.id === input.pluginTheme)
      ? [
          {
            kind: 'plugin-unavailable' as const,
            id: input.pluginTheme,
            preview: null,
          },
        ]
      : [];
  return [...builtins, ...plugins, ...missing];
}

export interface ThemeSelectionPatch {
  pluginTheme?: string;
  lightPalette?: LightPalette;
}

/**
 * 选卡片要写的设置：内置主题必须清空插件主题并记下方案；插件主题只设插件 id，
 * 不改写薄荷白 / 云白等既有浅色方案。
 */
export function themeSelectionPatch(entry: ThemeEntry): ThemeSelectionPatch {
  switch (entry.kind) {
    case 'builtin':
      return { pluginTheme: '', lightPalette: entry.palette };
    case 'plugin':
      return { pluginTheme: entry.id };
    default:
      return {};
  }
}
