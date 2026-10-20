import { isColorParsable, isDarkColor } from './ghosttyTheme';

/**
 * 终端底色和应用界面是否同一档明暗。应用主题是 dark/light/system 时，界面底色来自
 * 应用配色（--panel），终端底色来自终端配色，两者色相/明度不同会在右侧面板里露出一块
 * 色差明显的矩形。此时用应用面板色铺底，终端配色只负责 16 色与前景/光标/选区。
 *
 * 明暗不一致（浅色界面配深色终端配色）时保持终端配色底色：文字与 16 色都来自终端配色，
 * 换成浅色底会直接掉对比度。`theme === 'sync-terminal'` 时应用配色本来就等于终端配色，
 * 传入的面板色与终端底色相同，结果一致。
 */
export function matchTerminalBackground(terminalBg: string, panelBg?: string | null): string {
  if (!panelBg || !isColorParsable(panelBg) || !isColorParsable(terminalBg)) return terminalBg;
  if (isDarkColor(terminalBg) !== isDarkColor(panelBg)) return terminalBg;
  return panelBg;
}

/** 读取应用当前的面板底色;CSS 变量缺失或不可解析时返回 undefined,退回终端配色底色 */
export function readAppPanelColor(): string | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim();
  return value || undefined;
}
