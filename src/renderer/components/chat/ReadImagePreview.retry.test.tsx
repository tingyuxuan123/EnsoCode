// @vitest-environment happy-dom
import { act, createElement } from 'react';
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
// ZoomableImage 的遮罩/剪贴板依赖宿主能力，这里只保留 ReadImagePreview 自己负责的 onError 链路
vi.mock('./ZoomableImage', () => ({
  ZoomableImage: ({ src, onError }: { src: string; onError?: () => void }) =>
    createElement('img', { 'data-testid': 'zoom', src, onError }),
}));

const good =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQdz14AAAADElEQVR42mP4zwAAAAMAAQDJ/pLvAAAAAElFTkSuQmCC';
/** 语法合法（PNG 头）但浏览器解不出像素：真实坏图就长这样 */
const broken = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

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

async function mount(host: {
  readLocalImage: (path: string) => Promise<LocalImageLoad>;
  invalidateLocalImage?: (path: string) => void;
}) {
  await act(async () => {
    root.render(
      createElement(
        ChatHostContext.Provider,
        { value: { sessionId: 's', canRewind: false, canRetry: false, ...host } },
        createElement(ReadImagePreview, { path: '/work/proj/a.png', fallback })
      )
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const img = () => container.querySelector('img');
const retryButton = () =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry') ??
  null;

describe('会话图片 failed 状态的清除与坏缓存失效', () => {
  it('解码失败后点重试会重新请求 host，并在拿到有效像素后正常渲染', async () => {
    const readLocalImage = vi
      .fn<(path: string) => Promise<LocalImageLoad>>()
      .mockResolvedValueOnce({ ok: true, dataUrl: broken });
    const invalidateLocalImage = vi.fn();
    await mount({ readLocalImage, invalidateLocalImage });

    expect(img()?.getAttribute('src')).toBe(broken);

    // 浏览器解不出像素：真实 <img> 触发 error
    await act(async () => {
      img()?.dispatchEvent(new Event('error'));
    });

    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();
    expect(invalidateLocalImage).toHaveBeenCalledWith('/work/proj/a.png');

    readLocalImage.mockResolvedValueOnce({ ok: true, dataUrl: good });
    await act(async () => {
      retryButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    // 重试必须真的再问一次 host（不是只重画错误），并渲染新像素
    expect(readLocalImage).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-slot="read-image-error"]')).toBeNull();
    expect(img()?.getAttribute('src')).toBe(good);
  });

  it('失败态下若新一次加载拿到有效图，旧的 failed 不会继续挡住图片', async () => {
    const readLocalImage = vi
      .fn<(path: string) => Promise<LocalImageLoad>>()
      .mockResolvedValueOnce({ ok: true, dataUrl: broken });
    await mount({ readLocalImage });

    await act(async () => {
      img()?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('[data-slot="read-image-error"]')).not.toBeNull();

    readLocalImage.mockResolvedValueOnce({ ok: true, dataUrl: good });
    await act(async () => {
      retryButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[data-slot="read-image-error"]')).toBeNull();
    expect(img()?.getAttribute('src')).toBe(good);
  });
});

describe('宿主回调身份变化不会引发重复请求', () => {
  it('每次渲染传新的 readLocalImage 时，图片只请求一次（断线时不会空转到超时）', async () => {
    const readLocalImage = vi.fn<(path: string) => Promise<LocalImageLoad>>();
    readLocalImage.mockImplementation(() => new Promise(() => {})); // 永不结算，模拟断线在途
    const invalidateLocalImage = vi.fn();

    const render = async () => {
      await act(async () => {
        root.render(
          createElement(
            ChatHostContext.Provider,
            {
              value: {
                sessionId: 's',
                canRewind: false,
                canRetry: false,
                // 每次都是新函数身份
                readLocalImage: (path: string) => readLocalImage(path),
                invalidateLocalImage: (path: string) => invalidateLocalImage(path),
              },
            },
            createElement(ReadImagePreview, { path: '/work/proj/a.png', fallback })
          )
        );
      });
      await act(async () => {
        await Promise.resolve();
      });
    };

    await render();
    expect(readLocalImage).toHaveBeenCalledTimes(1);
    await render();
    expect(readLocalImage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-slot="read-image-loading"]')).not.toBeNull();
  });
});
