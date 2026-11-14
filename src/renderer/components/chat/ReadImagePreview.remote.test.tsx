import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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

const fallback = createElement('pre', null, '图片详情文本');

const renderWithHost = (readLocalImage?: (path: string) => Promise<unknown>) =>
  renderToStaticMarkup(
    createElement(
      ChatHostContext.Provider,
      {
        value: {
          sessionId: 's',
          canRewind: false,
          canRetry: false,
          ...(readLocalImage
            ? { readLocalImage: readLocalImage as (path: string) => Promise<never> }
            : {}),
        },
      },
      createElement(ReadImagePreview, { path: '/work/proj/shots/a.png', fallback })
    )
  );

describe('会话图片在远程宿主（手机 PWA）', () => {
  it('有远程读取能力时先显示「正在读取图片」，不再渲染浏览器不认的 local-image://', () => {
    const html = renderWithHost(async () => ({ ok: true, dataUrl: 'data:image/png;base64,AA==' }));
    expect(html).toContain('data-slot="read-image-loading"');
    expect(html).not.toContain('local-image://');
  });

  it('本机没有远程能力时保持原行为：优先走 local-image:// 原图', () => {
    const html = renderWithHost();
    expect(html).toContain('data-slot="read-image"');
    expect(html).toContain('src="local-image://posix/work/proj/shots/a.png"');
  });

  it('读到图后按 data URL 渲染，可点开看大图', () => {
    const html = renderToStaticMarkup(
      createElement(ReadImagePreviewView, {
        state: { status: 'ready', src: 'data:image/png;base64,AA==' },
        path: '/work/proj/shots/a.png',
        fallback,
        remote: true,
        onRetry: () => {},
      })
    );
    expect(html).toContain('data-slot="read-image"');
    expect(html).toContain('src="data:image/png;base64,AA=="');
    expect(html).toContain('cursor-zoom-in');
  });

  it('失败有可见文案、重试入口，并保留文本详情（不空白、不静默隐藏）', () => {
    const html = renderToStaticMarkup(
      createElement(ReadImagePreviewView, {
        state: { status: 'error', error: 'too-large' },
        path: '/work/proj/shots/a.png',
        fallback,
        remote: true,
        onRetry: () => {},
      })
    );
    expect(html).toContain('data-slot="read-image-error"');
    expect(html).toContain('Image is too large to preview on the phone');
    expect(html).toContain('Retry');
    expect(html).toContain('图片详情文本');
    expect(html).not.toContain('data-slot="read-image"');
  });
});
