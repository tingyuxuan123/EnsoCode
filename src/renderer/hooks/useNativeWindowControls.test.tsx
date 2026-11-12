// @vitest-environment happy-dom

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  acquireNativeCaptionScrim,
  releaseNativeCaptionScrim,
  resetNativeCaptionScrim,
} from '@/lib/nativeCaptionScrim';
import { useNativeWindowControls } from './useNativeWindowControls';

const SCRIM = 'rgba(0, 0, 0, 0.75)';

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-light-palette');
  resetNativeCaptionScrim();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Header({ backgroundColor }: { backgroundColor: string }) {
  const ref = useRef<HTMLElement>(null);
  useNativeWindowControls(ref);
  return <header ref={ref} style={{ backgroundColor, color: 'rgb(23, 33, 26)' }} />;
}

function mountHeader(backgroundColor: string) {
  const setTitleBarAppearance = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { env: { platform: 'win32' }, window: { setTitleBarAppearance } });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));

  // happy-dom has no canvas renderer. Model only the opaque and transparent fills used here.
  let pixel: number[] = [];
  const parse = (value: string) => {
    const inner = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1];
    if (!inner) return null;
    const parts = inner
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
    return [parts[0], parts[1], parts[2], parts[3] ?? 1] as const;
  };
  const context = {
    fillStyle: '',
    clearRect() {
      pixel = [0, 0, 0, 0];
    },
    fillRect() {
      const color = parse(this.fillStyle);
      if (!color) return;
      const [r, g, b, alpha] = color;
      if (alpha <= 0) return;
      const [dr, dg, db, da = 0] = pixel;
      const dstAlpha = da / 255;
      const outAlpha = alpha + dstAlpha * (1 - alpha);
      if (outAlpha <= 0) return;
      const blend = (src: number, dst: number) =>
        Math.round((src * alpha + dst * dstAlpha * (1 - alpha)) / outAlpha);
      pixel = [blend(r, dr), blend(g, dg), blend(b, db), Math.round(outAlpha * 255)];
    },
    getImageData: () => ({ data: pixel }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );

  const style = document.createElement('style');
  style.textContent = `
    :root { --shell: rgb(234, 241, 245); }
    :root[data-light-palette='mint-light'] { --shell: rgb(243, 246, 244); }
  `;
  const container = document.createElement('div');
  document.body.append(style, container);
  const mounted = createRoot(container);
  root = mounted;
  act(() => mounted.render(<Header backgroundColor={backgroundColor} />));
  return { frames, setTitleBarAppearance };
}

it('透明标题栏使用主题外壳色，且只切换浅色方案时也会同步', async () => {
  const { frames, setTitleBarAppearance } = mountHeader('rgba(0, 0, 0, 0)');
  frames.shift()?.(0);
  expect(setTitleBarAppearance).toHaveBeenLastCalledWith({
    color: '#eaf1f5',
    symbolColor: '#17211a',
  });

  document.documentElement.dataset.lightPalette = 'mint-light';
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  frames.shift()?.(1);
  expect(setTitleBarAppearance).toHaveBeenLastCalledWith({
    color: '#f3f6f4',
    symbolColor: '#17211a',
  });
});

it('标题栏有不透明底色时仍使用自身的底色', () => {
  const { frames, setTitleBarAppearance } = mountHeader('rgb(32, 38, 44)');
  frames.shift()?.(0);
  expect(setTitleBarAppearance).toHaveBeenCalledExactlyOnceWith({
    color: '#20262c',
    symbolColor: '#17211a',
  });
});

it('全窗口压暗浮层只调整符号对比色，不把遮罩重复画到窗口底色', async () => {
  const { frames, setTitleBarAppearance } = mountHeader('rgba(0, 0, 0, 0)');
  frames.shift()?.(0);
  expect(setTitleBarAppearance).toHaveBeenLastCalledWith({
    color: '#eaf1f5',
    symbolColor: '#17211a',
  });

  acquireNativeCaptionScrim(SCRIM);
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  frames.shift()?.(1);
  // 按钮底板透明，遮罩由 renderer 统一绘制；窗口底色不能跟着压暗，否则会重复叠色。
  expect(setTitleBarAppearance).toHaveBeenLastCalledWith({
    color: '#eaf1f5',
    symbolColor: '#ffffff',
  });

  releaseNativeCaptionScrim(SCRIM);
  await vi.waitFor(() => expect(frames).toHaveLength(1));
  frames.shift()?.(2);
  expect(setTitleBarAppearance).toHaveBeenLastCalledWith({
    color: '#eaf1f5',
    symbolColor: '#17211a',
  });
});
