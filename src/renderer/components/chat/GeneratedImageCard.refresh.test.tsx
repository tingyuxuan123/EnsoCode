// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHostContext } from './chatHost';
import { GeneratedImageCard } from './GeneratedImageCard';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({}),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('@/components/ui/toast', () => ({ addToast: () => {} }));
vi.mock('@/plugins/draftBridge', () => ({ handleDraftRequest: () => ({ ok: false }) }));
vi.mock('./composerMentionBridge', () => ({ requestFocusComposer: () => {} }));
vi.mock('./imageClipboard', () => ({ copyImageToClipboard: async () => {} }));
vi.mock('./imageDownload', () => ({ downloadImage: async () => {} }));
vi.mock('./ZoomableImage', () => ({
  ZoomableImage: ({ src, onError }: { src: string; onError?: () => void }) =>
    createElement('img', { 'data-testid': 'zoom', src, onError }),
}));

const imageId = '12345678-1234-4123-8123-123456789abc';
const imagePath = `.xiaoman/images/${imageId}.png`;
const output = JSON.stringify({
  ok: true,
  image: { id: imageId, path: imagePath, mimeType: 'image/png' },
});
const px = (byte: number) =>
  `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, byte]).toString('base64')}`;

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => container.remove());

describe('生成图片卡片的成功态刷新（远程宿主）', () => {
  it('远程成功态有「刷新图片」按钮，点击会重新请求并换成新像素', async () => {
    const readLocalImage = vi
      .fn<(path: string) => Promise<{ ok: true; dataUrl: string }>>()
      .mockResolvedValueOnce({ ok: true, dataUrl: px(1) });
    const invalidateLocalImage = vi.fn();
    const root = createRoot(container);
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
              invalidateLocalImage,
              localImageScope: 's|/work/proj',
            },
          },
          createElement(GeneratedImageCard, { output, path: imagePath })
        )
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(px(1));

    const refresh = container.querySelector('[data-slot="generated-image-refresh"]');
    expect(refresh).not.toBeNull();

    readLocalImage.mockResolvedValueOnce({ ok: true, dataUrl: px(9) });
    await act(async () => {
      refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 卡片拿到的就是工作区相对路径（生成图固定落在 .xiaoman/images）
    expect(invalidateLocalImage).toHaveBeenCalledWith(imagePath);
    expect(readLocalImage).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(px(9));
    act(() => root.unmount());
  });
});
