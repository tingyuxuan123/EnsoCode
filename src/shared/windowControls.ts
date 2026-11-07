export const WINDOW_TITLE_BAR_HEIGHT = 44;
export const WINDOWS_CAPTION_BUTTONS_WIDTH = 138;

/**
 * Windows 原生窗口按钮的符号色：创建窗口与运行时同步共用一份，避免两边漂移。
 * 键的含义是「标题栏底色暗/亮时符号取什么色」，不是系统主题。
 */
export const WINDOWS_SYMBOL_COLOR = { onDark: '#ffffff', onLight: '#111111' } as const;

export interface TitleBarAppearance {
  color: string;
  symbolColor: string;
}

/**
 * 原生标题栏只接受不透明 RGB 颜色；渲染层不能借外观同步修改高度或其他窗口属性。
 *
 * Native title bars accept opaque RGB colors only; appearance updates cannot change
 * the height or any other window properties supplied by the renderer.
 */
export function parseTitleBarAppearance(raw: unknown): TitleBarAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!('color' in raw) || !('symbolColor' in raw)) return null;
  const { color, symbolColor } = raw;
  const isColor = (value: unknown): value is string =>
    typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  return isColor(color) && isColor(symbolColor) ? { color, symbolColor } : null;
}
