import { parseThemeAssets, parseThemeBackground } from './assets';
import { isSafeTokenValue, sanitizeTokens } from './tokensCss';
import {
  THEME_MODES,
  type ThemeAssets,
  type ThemeBackground,
  type ThemeMode,
  type ThemePalette,
  type ThemeTokens,
} from './types';
export type ThemeFileResult =
  | {
      ok: true;
      light: ThemePalette;
      dark: ThemePalette;
      tokens?: Partial<Record<ThemeMode, ThemeTokens>>;
      assets?: ThemeAssets;
      background?: ThemeBackground;
    }
  | { ok: false; error: string };
const keys = [
  'canvas',
  'surface',
  'sunken',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'textSubtle',
  'accent',
] as const;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
function palette(raw: unknown): ThemePalette | null {
  if (!record(raw)) return null;
  const out = {} as ThemePalette;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== 'string' || !value.trim() || !isSafeTokenValue(value)) return null;
    out[key] = value.trim();
  }
  return out;
}
export function parseThemeFile(raw: unknown): ThemeFileResult {
  if (!record(raw)) return { ok: false, error: '主题文件必须是 JSON 对象' };
  const light = palette(raw.light);
  const dark = palette(raw.dark);
  if (!light || !dark) return { ok: false, error: '缺少合法的浅色/深色调色板' };
  const tokens: Partial<Record<ThemeMode, ThemeTokens>> = {};
  if (raw.tokens !== undefined) {
    if (!record(raw.tokens)) return { ok: false, error: 'tokens 必须是对象' };
    for (const mode of THEME_MODES) {
      const value = raw.tokens[mode];
      if (value === undefined) continue;
      if (!record(value)) return { ok: false, error: `tokens.${mode} 必须是对象` };
      tokens[mode] = sanitizeTokens(value);
    }
  }
  const assets = parseThemeAssets(raw.assets);
  const background = parseThemeBackground(raw.background);
  return {
    ok: true,
    light,
    dark,
    ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(assets ? { assets } : {}),
    ...(background ? { background } : {}),
  };
}
