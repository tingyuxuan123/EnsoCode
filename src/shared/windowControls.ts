export const WINDOW_TITLE_BAR_HEIGHT = 44;
export const WINDOWS_CAPTION_BUTTONS_WIDTH = 138;
/** 只透明化按钮底板，让工作区绘制的背景和遮罩从下方透出。 */
export const WINDOWS_CAPTION_BACKGROUND = '#00000000';

/**
 * Windows 原生窗口按钮的符号色：创建窗口与运行时同步共用一份，避免两边漂移。
 * 键的含义是「标题栏底色暗/亮时符号取什么色」，不是系统主题。
 */
export const WINDOWS_SYMBOL_COLOR = { onDark: '#ffffff', onLight: '#111111' } as const;

export interface TitleBarAppearance {
  /** 窗口的不透明兜底色，不是原生按钮的底板颜色。 */
  color: string;
  symbolColor: string;
}

/**
 * 窗口兜底色和按钮符号色只接受不透明 RGB；透明按钮底板由主进程固定设置。
 *
 * Keep the renderer-provided window fallback and caption glyph colors opaque.
 * The main process owns the transparent caption background and native geometry.
 */
export function parseTitleBarAppearance(raw: unknown): TitleBarAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!('color' in raw) || !('symbolColor' in raw)) return null;
  const { color, symbolColor } = raw;
  const isColor = (value: unknown): value is string =>
    typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  return isColor(color) && isColor(symbolColor) ? { color, symbolColor } : null;
}
