// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHostContext } from './chatHost';
import { ReadImagePreview, ReadImagePreviewView } from './TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));
vi.mock('./ZoomableImage', () => ({
  ZoomableImage: ({
    src,
    onError,
    onLoad,
  }: {
    src: string;
    onError?: () => void;
    onLoad?: (event: { currentTarget: { naturalWidth: number } }) => void;
  }) =>
    createElement('img', {
      src,
      onError,
      onLoad: onLoad
        ? (event: { currentTarget: HTMLImageElement }) =>
            onLoad({ currentTarget: { naturalWidth: event.currentTarget.naturalWidth } })
        : undefined,
    }),
}));

const BROKEN = 'data:image/png;base64,iVBORw0KGgo=';
/** 真能解码的 1x1 PNG：happy-dom 也会把它当有效图片 */
const GOOD =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQdz14AAAADElEQVR42mP4zwAAAAMAAQDJ/pLvAAAAAElFTkSuQmCC';
const fallback = createElement('pre', null, '文本详情');

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

const view = (src: string | null, remote = true) =>
  createElement(ReadImagePreviewView, {
    state: src ? { status: 'ready', src } : { status: 'loading' },
    path: '/work/proj/a.png',
    fallback,
    remote,
    onRetry: () => {},
  });

describe('解码失败必须绑定到具体像素，而不是一个可被清掉的布尔', () => {
  it('解码失败后同一 src 再渲染仍是失败态（不会被新一轮渲染清成空白成功）', async () => {
    await act(async () => root.render(view(BROKEN)));
    await act(async () => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();

    // 父组件因别的原因重渲染（同一 src）：失败态必须还在
    await act(async () => root.render(view(BROKEN)));
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="read-image"]')).toBeNull();
  });

  it('换成新的 src（重试成功）自动解除失败，无需依赖清状态副作用', async () => {
    await act(async () => root.render(view(BROKEN)));
    await act(async () => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();

    await act(async () => root.render(view(GOOD)));
    expect(container.querySelector('[data-slot="read-image-error"]')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(GOOD);
  });

  it('图片「加载完成」但像素宽为 0 时按失败处理，不留空白成功态', async () => {
    await act(async () => root.render(view(GOOD)));
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    // happy-dom 不会真的解码：显式模拟 naturalWidth=0 的 complete 状态
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    await act(async () => {
      img.dispatchEvent(new Event('load'));
    });
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="read-image"]')).toBeNull();
  });
});

describe('远程挂载路径：坏图不会被当成成功', () => {
  it('host 返回语法合法但解不出的 data URL 时，挂载后就应显示失败与重试', async () => {
    const readLocalImage = vi.fn(async () => ({ ok: true as const, dataUrl: BROKEN }));
    await act(async () => {
      root.render(
        createElement(
          ChatHostContext.Provider,
          {
            value: {
              sessionId: 's',
              canRewind: false,
              canRetry: false,
              readLocalImage,
              localImageScope: 's|/work/proj',
            },
          },
          createElement(ReadImagePreview, { path: '/work/proj/a.png', fallback })
        )
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    // happy-dom 对坏 PNG 可能直接报 error（等价于浏览器），也可能交给测试显式触发
    const img = container.querySelector('img') as HTMLImageElement | null;
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
      await act(async () => {
        img.dispatchEvent(new Event('load'));
        img.dispatchEvent(new Event('error'));
      });
    }
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();
    expect(container.textContent).toContain('Retry');
  });
});
