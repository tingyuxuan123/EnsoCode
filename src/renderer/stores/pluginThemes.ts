import type { ExtensionPluginSummary } from '@shared/extensionPlugins/types';
import { pluginAssetUrl } from '@shared/localImage';
import { resolveThemeAssets, resolveThemeBackground, themeAssetsCss } from '@shared/theme/assets';
import { rewriteThemeCssUrls, themeCssReferencesLocalImage } from '@shared/theme/themeCss';
import { parseThemeFile } from '@shared/theme/themeFile';
import { pluginThemeKey } from '@shared/theme/themeKey';
import { tokensCss } from '@shared/theme/tokensCss';
import type { ThemeDefinition, ThemePalette } from '@shared/theme/types';
import { create } from 'zustand';
import { decodeUtf8Base64 } from '@/plugins/viewBridge';
import { useSettingsStore } from './settings';

export const usePluginThemesStore = create<{
  themes: ThemeDefinition[] | null;
  errors: Record<string, string[]>;
}>(() => ({ themes: null, errors: {} }));
async function read(pluginId: string, rel: string) {
  const result = await window.electronAPI.extensionPlugins.asset(pluginId, rel);
  if (!result.ok) throw new Error(result.error);
  return decodeUtf8Base64(result.base64);
}
async function load(plugin: ExtensionPluginSummary) {
  const themes: ThemeDefinition[] = [];
  const errors: string[] = [];
  for (const contribution of plugin.themes ?? []) {
    try {
      const file = parseThemeFile(JSON.parse(await read(plugin.id, contribution.path)));
      if (!file.ok) throw new Error(file.error);
      const { ok: _ok, assets, background, ...palettes } = file;
      const toUrl = (rel: string) => pluginAssetUrl(plugin.id, rel, plugin.build);
      let css: string | undefined;
      if (contribution.css) {
        const raw = await read(plugin.id, contribution.css);
        if (themeCssReferencesLocalImage(raw))
          throw new Error('Plugin CSS cannot reference local-image:');
        css = rewriteThemeCssUrls(raw, contribution.css, toUrl);
      }
      themes.push({
        id: pluginThemeKey(plugin.id, contribution.id),
        name: contribution.name,
        source: { kind: 'plugin', pluginId: plugin.id, pluginName: plugin.name },
        ...palettes,
        ...(assets ? { assets: resolveThemeAssets(assets, contribution.path, toUrl) } : {}),
        ...(background
          ? { background: resolveThemeBackground(background, contribution.path, toUrl) }
          : {}),
        ...(css ? { css } : {}),
      });
    } catch (error) {
      errors.push(
        `${contribution.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { themes, errors };
}
const VARS: Record<keyof ThemePalette, string[]> = {
  canvas: ['--background', '--shell', '--panel'],
  surface: ['--card', '--popover'],
  sunken: ['--muted', '--input'],
  border: ['--border', '--line'],
  borderStrong: ['--line-strong'],
  text: ['--foreground', '--card-foreground', '--popover-foreground'],
  textMuted: ['--muted-foreground'],
  textSubtle: ['--text-subtle'],
  accent: ['--primary', '--brand', '--ring'],
};
export function pluginPaletteTokens(palette: ThemePalette): Record<string, string> {
  return Object.fromEntries(
    Object.entries(VARS).flatMap(([key, vars]) =>
      vars.map((name) => [name, palette[key as keyof ThemePalette]])
    )
  );
}
/** Dedicated style tag means disabling a plugin restores the existing fork palette without mutation. */
export function startPluginThemes(): () => void {
  const api = window.electronAPI?.extensionPlugins;
  if (!api) return () => {};
  let generation = 0;
  const style = document.createElement('style');
  style.dataset.pluginTheme = '';
  document.head.append(style);
  const apply = () => {
    const theme = usePluginThemesStore
      .getState()
      .themes?.find((item) => item.id === useSettingsStore.getState().pluginTheme);
    const important = (values: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, `${value} !important`])
      );
    style.textContent = theme
      ? tokensCss(
          ':root:root',
          important({ ...pluginPaletteTokens(theme.light), ...theme.tokens?.light })
        ) +
        tokensCss(
          ':root:root.dark',
          important({ ...pluginPaletteTokens(theme.dark), ...theme.tokens?.dark })
        ) +
        themeAssetsCss(theme.assets, theme.background) +
        (theme.css ?? '')
      : '';
  };
  const refresh = async () => {
    const mine = ++generation;
    try {
      const result = await api.list();
      const loaded = await Promise.all(
        result.plugins
          .filter((plugin) => !result.registryError && plugin.state === 'enabled')
          .map(async (plugin) => ({ id: plugin.id, ...(await load(plugin)) }))
      );
      if (mine !== generation) return;
      usePluginThemesStore.setState({
        themes: loaded.flatMap((item) => item.themes),
        errors: Object.fromEntries(
          loaded.filter((item) => item.errors.length).map((item) => [item.id, item.errors])
        ),
      });
    } catch {
      if (mine === generation) usePluginThemesStore.setState({ themes: [], errors: {} });
    }
    apply();
  };
  const unsubscribe = api.onChanged(() => void refresh());
  const unsubscribeSettings = useSettingsStore.subscribe((state, before) => {
    if (state.pluginTheme !== before.pluginTheme) apply();
  });
  void refresh();
  return () => {
    generation++;
    unsubscribe();
    unsubscribeSettings();
    style.remove();
  };
}
