// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDraftTarget } from '@/plugins/draftBridge';
import { registerComposerFocus } from './composerMentionBridge';
import { GeneratedImageCard } from './GeneratedImageCard';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const actions = vi.hoisted(() => ({
  copy: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
  toast: vi.fn(),
}));
vi.mock('./imageClipboard', () => ({ copyImageToClipboard: actions.copy }));
vi.mock('./imageDownload', () => ({ downloadImage: actions.download }));
vi.mock('@/components/ui/toast', () => ({ addToast: actions.toast }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
const id = '12345678-1234-4123-8123-123456789abc';
const path = `.xiaoman/images/${id}.png`;
const output = JSON.stringify({ ok: true, image: { id, path, mimeType: 'image/png' } });

describe('生成图片的加载与揭示', () => {
  it('真实图片加载完成才开始淡入，不在工具结果到达时提前播放', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<GeneratedImageCard output={output} path={`/workspace/${path}`} />)
      );
      expect(container.querySelector('figure')?.getAttribute('aria-busy')).toBe('true');
      const img = container.querySelector('img')!;
      expect(img.classList.contains('imagegen-fade-in')).toBe(false);
      await act(async () => {
        img.dispatchEvent(new Event('load'));
      });
      expect(container.querySelector('figure')?.getAttribute('aria-busy')).toBe('false');
      expect(img.classList.contains('imagegen-fade-in')).toBe(true);
      expect(container.querySelector('button')?.className).toContain('cursor-zoom-in');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('图片文件丢失后结束加载，退回缺图提示而非无限动画', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<GeneratedImageCard output={output} path={`/workspace/${path}`} />)
      );
      await act(async () => {
        container.querySelector('img')!.dispatchEvent(new Event('error'));
      });
      expect(container.querySelector('figure')?.getAttribute('aria-busy')).toBe('false');
      expect(container.textContent).toContain('Image file unavailable');
      expect(container.querySelector('img')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});

async function mountCard(sessionId?: string) {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <GeneratedImageCard output={output} path={`/workspace/${path}`} sessionId={sessionId} />
    )
  );
  const load = () =>
    act(async () => {
      container.querySelector('img')!.dispatchEvent(new Event('load'));
    });
  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  return { container, load, button, dispose: () => act(async () => root.unmount()) };
}
describe('同款图片悬浮工具栏', () => {
  it('只在图片就绪后提供编辑、复制、下载三个操作，不再显示底部路径栏', async () => {
    const card = await mountCard('session');
    try {
      expect(card.container.querySelector('[data-slot=image-actions]')).toBeNull();
      await card.load();
      const toolbar = card.container.querySelector('[data-slot=image-actions]')!;
      expect(
        [...toolbar.querySelectorAll('button')].map((n) => n.getAttribute('aria-label'))
      ).toEqual(['Edit image', 'Copy image', 'Download image']);
      expect(card.container.querySelector('figcaption')?.className).toContain('sr-only');
      expect(toolbar.closest('button')).toBeNull();
    } finally {
      await card.dispose();
    }
  });
  it('编辑只插入已有图片引用并聚焦草稿，不会提交请求或打开全屏预览', async () => {
    const insert = vi.fn();
    const focus = vi.fn();
    const unregister = registerDraftTarget({
      key: 'session',
      segments: () => [],
      insertText: insert,
      setText: vi.fn(),
      busy: () => false,
    });
    const unfocus = registerComposerFocus(focus);
    const card = await mountCard('session');
    try {
      await card.load();
      await act(async () => card.button('Edit image').click());
      expect(insert).toHaveBeenCalledWith(expect.stringContaining(`sourceImageId: ${id}`));
      expect(focus).toHaveBeenCalledOnce();
      expect(card.container.querySelector('.cursor-zoom-out')).toBeNull();
    } finally {
      unregister();
      unfocus();
      await card.dispose();
    }
  });
  it('复制的是图片，成功就地显示对勾后恢复，不弹成功提示', async () => {
    vi.useFakeTimers();
    const card = await mountCard('session');
    try {
      await card.load();
      await act(async () => card.button('Copy image').click());
      expect(actions.copy).toHaveBeenCalledWith(`local-image://posix/workspace/${path}`);
      expect(card.button('Image copied').querySelector('[data-image-copied]')).not.toBeNull();
      expect(actions.toast).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(card.button('Copy image')).not.toBeNull();
    } finally {
      await card.dispose();
    }
  });
  it('下载原图保留UUID和扩展名，失败会提示且恢复按钮', async () => {
    const card = await mountCard('session');
    try {
      await card.load();
      actions.download.mockRejectedValueOnce(new Error('offline'));
      await act(async () => card.button('Download image').click());
      expect(actions.download).toHaveBeenCalledWith(
        `local-image://posix/workspace/${path}`,
        `${id}.png`
      );
      expect(actions.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      expect(card.button('Download image').disabled).toBe(false);
      expect(card.container.querySelector('.cursor-zoom-out')).toBeNull();
    } finally {
      await card.dispose();
    }
  });
  it('复制失败不误报成功，并允许用户再次尝试', async () => {
    const card = await mountCard('session');
    try {
      await card.load();
      actions.copy.mockRejectedValueOnce(new Error('clipboard denied'));
      await act(async () => card.button('Copy image').click());
      expect(card.button('Copy image').disabled).toBe(false);
      expect(card.container.querySelector('[data-image-copied]')).toBeNull();
      expect(actions.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Could not copy image' })
      );
    } finally {
      await card.dispose();
    }
  });
  it('操作在途时禁用按钮，不重复读取或下载图片', async () => {
    const card = await mountCard('session');
    let finish!: () => void;
    actions.copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    try {
      await card.load();
      await act(async () => card.button('Copy image').click());
      expect(card.button('Copy image').disabled).toBe(true);
      expect(card.button('Download image').disabled).toBe(true);
      await act(async () => {
        card.button('Copy image').click();
        card.button('Download image').click();
      });
      expect(actions.copy).toHaveBeenCalledOnce();
      expect(actions.download).not.toHaveBeenCalled();
      await act(async () => finish());
      expect(card.button('Download image').disabled).toBe(false);
    } finally {
      if (finish) finish();
      await card.dispose();
    }
  });
  it('没有会话时保留复制和下载，仅禁用编辑；缺图时移除全部操作', async () => {
    const card = await mountCard();
    try {
      await card.load();
      expect(card.button('Edit image').disabled).toBe(true);
      expect(card.button('Copy image').disabled).toBe(false);
      expect(card.button('Download image').disabled).toBe(false);
      await act(async () => {
        card.container.querySelector('img')!.dispatchEvent(new Event('error'));
      });
      expect(card.container.querySelector('[data-slot=image-actions]')).toBeNull();
    } finally {
      await card.dispose();
    }
  });
});
