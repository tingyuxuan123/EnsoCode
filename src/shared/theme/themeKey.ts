import type { ThemeKey } from './types';
export function pluginThemeKey(pluginId: string, themeId: string): ThemeKey {
  return `${pluginId}/${themeId}`;
}
export function parseThemeKey(value: unknown): ThemeKey | null {
  if (typeof value !== 'string') return null;
  const [pluginId, themeId, ...rest] = value.split('/');
  return !rest.length &&
    /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(pluginId) &&
    /^[a-z][a-z0-9-]{0,31}$/.test(themeId ?? '')
    ? pluginThemeKey(pluginId, themeId)
    : null;
}
