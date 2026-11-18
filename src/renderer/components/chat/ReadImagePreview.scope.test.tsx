// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalImageLoad } from './chatHost';
import { ChatHostContext } from './chatHost';
import { ReadImagePreview } from './TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));
vi.mock('./ZoomableImage', () => ({
  ZoomableImage: ({ src, onError }: { src: string; onError?: () => void }) =>
    createElement('img', { 'data-testid': 'zoom', src, onError }),
}));

const px = (byte: number) =>
  `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, byte, byte]).toString('base64')}`;
const OLD = px(1);
const FRESH = px(2);
const NEXT_SCOPE = px(3);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(children: ReactNode) {
  return act(async () => {
    root.render(children);
  });
}

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const img = () => container.querySelector('img');
const buttons = () => [...container.querySelectorAll('button')];
const byText = (text: string) => buttons().find((button) => button.textContent?.includes(text));

const host = (input: {
  readLocalImage: (path: string, toolCallId?: string) => Promise<LocalImageLoad>;
  invalidateLocalImage?: (path: string, toolCallId?: string) => void;
  localImageScope?: string;
}) => ({
  sessionId: 's',
  canRewind: false,
  canRetry: false,
  ...input,
});

const screen = (value: ReturnType<typeof host>) =>
  createElement(
    ChatHostContext.Provider,
    { value },
    createElement(ReadImagePreview, {
      path: '/work/proj/a.png',
      fallback: createElement('pre', null, '文本详情'),
    })
  );

describe('成功态下的刷新入口（远程宿主）', () => {
  it('图片显示成功后仍有「刷新图片」按钮；点它会真的再问一次 host 并换成新像素', async () => {
    const readLocalImage = vi
      .fn<(path: string) => Promise<LocalImageLoad>>()
      .mockResolvedValueOnce({ ok: true, dataUrl: OLD });
    const invalidateLocalImage = vi.fn();
    await render(
      screen(host({ readLocalImage, invalidateLocalImage, localImageScope: 's|/work/proj' }))
    );
    await settle();
    expect(img()?.getAttribute('src')).toBe(OLD);

    // 同名文件被覆盖：用户必须有一个能点到的刷新入口，而不是只有失败时才有
    const refresh = byText('Refresh image');
    expect(refresh).not.toBeNull();

    readLocalImage.mockResolvedValueOnce({ ok: true, dataUrl: FRESH });
    await act(async () => {
      refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(invalidateLocalImage).toHaveBeenCalledWith('/work/proj/a.png');
    expect(readLocalImage).toHaveBeenCalledTimes(2);
    expect(img()?.getAttribute('src')).toBe(FRESH);
    expect(byText('Refresh image')).not.toBeNull();
  });

  it('刷新失败时保留清晰失败态与可重试入口，不留在旧像素上装作成功', async () => {
    const readLocalImage = vi
      .fn<(path: string) => Promise<LocalImageLoad>>()
      .mockResolvedValueOnce({ ok: true, dataUrl: OLD })
      .mockResolvedValueOnce({ ok: false, error: 'changed' });
    await render(screen(host({ readLocalImage, localImageScope: 's|/work/proj' })));
    await settle();

    await act(async () => {
      byText('Refresh image')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();

    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();
    expect(container.textContent).toContain('Image was changed or moved');
    expect(byText('Retry')).not.toBeNull();
    expect(img()).toBeNull();
  });
});

describe('scope 变化触发真实重新加载', () => {
  it('同挂载、同相对路径、cwd 从 A 换到 B 时自动重新取图；A 的迟到应答不能上屏', async () => {
    let resolveA: (load: LocalImageLoad) => void = () => {};
    const readLocalImage = vi.fn<(path: string) => Promise<LocalImageLoad>>(() => {
      if (readLocalImage.mock.calls.length === 1)
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      return Promise.resolve({ ok: true, dataUrl: NEXT_SCOPE });
    });
    const invalidateLocalImage = vi.fn();

    await render(
      screen(host({ readLocalImage, invalidateLocalImage, localImageScope: 's|/work/A' }))
    );
    await settle();
    expect(readLocalImage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-slot="read-image-loading"]')).not.toBeNull();

    // 会话执行目录变了：相对路径没变，但资源代次必须变
    await render(
      screen(host({ readLocalImage, invalidateLocalImage, localImageScope: 's|/work/B' }))
    );
    await settle();
    expect(readLocalImage).toHaveBeenCalledTimes(2);
    expect(img()?.getAttribute('src')).toBe(NEXT_SCOPE);

    // 旧 scope 的 promise 迟到：不能把旧像素重新画上来
    await act(async () => {
      resolveA({ ok: true, dataUrl: OLD });
    });
    await settle();
    expect(img()?.getAttribute('src')).toBe(NEXT_SCOPE);
  });

  it('read 工具调用 id 随远程读图请求传给宿主', async () => {
    const readLocalImage = vi
      .fn<(path: string, toolCallId?: string) => Promise<LocalImageLoad>>()
      .mockResolvedValue({ ok: true, dataUrl: OLD });
    await render(
      createElement(
        ChatHostContext.Provider,
        {
          value: host({
            readLocalImage,
            localImageScope: 's|/work/proj/tmp-capture',
          }),
        },
        createElement(ReadImagePreview, {
          path: '/tmp/whole-1920.png',
          toolCallId: 'read-1',
          fallback: createElement('pre', null, '文本详情'),
        })
      )
    );
    await settle();
    expect(readLocalImage).toHaveBeenCalledWith('/tmp/whole-1920.png', 'read-1');
  });
});
