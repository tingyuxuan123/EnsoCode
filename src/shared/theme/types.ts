export type ThemeMode = 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark'];
export type ThemeKey = `${string}/${string}`;
export interface ThemePalette {
  canvas: string;
  surface: string;
  sunken: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
}
export type ThemeTokens = Record<string, string>;
export type ThemeAssetSlot =
  | 'canvas-pattern'
  | 'sidebar-footer'
  | 'empty-main'
  | 'welcome'
  | 'composer-peek'
  | 'thinking'
  | 'code-corner'
  | 'todo-corner'
  | 'status-icon'
  | 'panel-corner';
export type ThemeAssetState = 'running' | 'waiting' | 'error';
export interface ThemeAsset {
  src: string;
  still?: string;
  dark?: string;
  states?: Partial<Record<ThemeAssetState, string>>;
}
export type ThemeAssets = Partial<Record<ThemeAssetSlot, ThemeAsset>>;
export type ThemeBackgroundSize = 'cover' | 'contain' | 'repeat' | 'center';
export interface ThemeBackground {
  image: ThemeAsset;
  size?: ThemeBackgroundSize;
  blur?: number;
  brightness?: number;
  saturation?: number;
  mask?: number;
  opacity?: number;
  composerOpacity?: number;
  codeOpacity?: number;
}
export interface ThemeDefinition {
  id: ThemeKey;
  name: string;
  source: { kind: 'plugin'; pluginId: string; pluginName: string };
  light: ThemePalette;
  dark: ThemePalette;
  tokens?: Partial<Record<ThemeMode, ThemeTokens>>;
  assets?: ThemeAssets;
  background?: ThemeBackground;
  css?: string;
}
