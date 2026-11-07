import { type TitleBarAppearance, WINDOWS_SYMBOL_COLOR } from '@shared/windowControls';
import { type RefObject, useEffect } from 'react';
import { getNativeCaptionScrim, subscribeNativeCaptionScrim } from '@/lib/nativeCaptionScrim';

/** 按叠加顺序把各层铺到同一个像素上，返回不透明 RGB。 */
function composite(
  context: CanvasRenderingContext2D,
  layers: (string | null | undefined)[]
): string {
  context.clearRect(0, 0, 1, 1);
  for (const layer of layers) {
    if (!layer) continue;
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** 遮罩把底色压得看不出原主题时，符号颜色只能按最终底色挑对比色。 */
function readableSymbolColor(background: string): string {
  const channel = (offset: number) => Number.parseInt(background.slice(offset, offset + 2), 16);
  const luminance = (0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)) / 255;
  return luminance < 0.5 ? WINDOWS_SYMBOL_COLOR.onDark : WINDOWS_SYMBOL_COLOR.onLight;
}

/**
 * 用实际标题栏配色同步原生按钮。画布将 OKLCH 等 CSS 颜色转为 Electron 可接受的 RGB。
 *
 * Synchronize native controls with the rendered title bar. A canvas converts CSS
 * colors such as OKLCH into RGB values accepted by Electron.
 */
export function useNativeWindowControls(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (window.electronAPI.env.platform !== 'win32') return;
    const header = ref.current;
    if (!header) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    let frame = 0;
    let previous = '';
    const sync = () => {
      frame = 0;
      const style = getComputedStyle(header);
      // 标题栏默认透明，透出 --shell；直接丢弃透明像素的 alpha 会得到黑色。
      // Native controls cannot be transparent: composite over the solid shell token.
      const shell = getComputedStyle(document.documentElement).getPropertyValue('--shell').trim();
      // 全窗口压暗浮层画在 renderer 里，原生按钮却在它之上：只有把遮罩也算进底色，
      // 右上角才会跟着界面一起压暗。
      const scrim = getNativeCaptionScrim();
      const color = composite(context, [shell, style.backgroundColor, scrim]);
      const appearance: TitleBarAppearance = {
        color,
        symbolColor: scrim ? readableSymbolColor(color) : composite(context, [style.color]),
      };
      const key = JSON.stringify(appearance);
      if (key === previous) return;
      previous = key;
      void window.electronAPI.window.setTitleBarAppearance(appearance).then(
        (result) => {
          if (!result.ok) console.error('[window] title bar appearance:', result.error);
        },
        (error: unknown) => console.error('[window] title bar appearance:', error)
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-accent', 'data-light-palette'],
    });
    observer.observe(header, { attributes: true, attributeFilter: ['class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', schedule);
    const unsubscribeScrim = subscribeNativeCaptionScrim(schedule);
    schedule();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', schedule);
      unsubscribeScrim();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
