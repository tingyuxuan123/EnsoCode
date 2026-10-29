import { zhTranslations } from '@shared/i18n';
import { parseHTML } from 'linkedom';
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZoomableImage } from './ZoomableImage';

const harness = vi.hoisted(() => ({
  toast: vi.fn(),
  write: vi.fn(),
  fetch: vi.fn(),
  bitmap: vi.fn(),
  close: vi.fn(),
  draw: vi.fn(),
  convert: vi.fn(),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/toast', () => ({ addToast: harness.toast }));
vi.mock('@/hooks/useOverlayGuard', () => ({ useOverlayGuard: () => {} }));
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ContextMenuTrigger: ({ render }: { render: ReactElement }) => render,
  ContextMenuPopup: ({ children }: { children: ReactNode }) => <span role="menu">{children}</span>,
  ContextMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}
let root: Root;
let container: HTMLElement;
let noContext = false;
const converted = new Blob(['png'], { type: 'image/png' });
async function copy(src: string) {
  await act(async () => root.render(<ZoomableImage src={src} />));
  const item = container.querySelector('[role="menuitem"]');
  expect(item?.textContent).toBe('Copy image');
  await act(async () => item?.dispatchEvent(new window.Event('click', { bubbles: true })));
  await vi.waitFor(() => expect(harness.toast).toHaveBeenCalled());
}
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.document);
  vi.stubGlobal('navigator', { clipboard: { write: harness.write } });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('fetch', harness.fetch);
  vi.stubGlobal('createImageBitmap', harness.bitmap);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext = () => (noContext ? null : { drawImage: harness.draw });
      convertToBlob = harness.convert;
    }
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = dom.document.getElementById('root') as unknown as HTMLElement;
  root = createRoot(container);
  vi.resetAllMocks();
  noContext = false;
  harness.write.mockResolvedValue(undefined);
  harness.bitmap.mockResolvedValue({ width: 2, height: 1, close: harness.close });
  harness.convert.mockResolvedValue(converted);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe('图片复制与预览', () => {
  it('本功能菜单和错误提示都有中文翻译', () => {
    for (const key of [
      'Copy image',
      'Image copied',
      'Could not copy image',
      'Copy failed',
      'Copy Path',
    ]) {
      expect(zhTranslations[key]).toEqual(expect.any(String));
      expect(zhTranslations[key]).not.toBe(key);
    }
  });
  it('PNG base64 本地解码，不经过 fetch', async () => {
    await copy('data:image/png;base64,AQID');
    const items = harness.write.mock.calls[0][0] as FakeClipboardItem[];
    expect([...new Uint8Array(await items[0].items['image/png'].arrayBuffer())]).toEqual([1, 2, 3]);
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });
  it('local-image fetch 成功后转换非 PNG，完成后释放 bitmap', async () => {
    harness.fetch.mockResolvedValue(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    await copy('local-image:///tmp/image.jpg');
    expect(harness.fetch).toHaveBeenCalledWith('local-image:///tmp/image.jpg');
    expect(harness.write.mock.calls[0][0][0].items['image/png']).toBe(converted);
    expect(harness.close).toHaveBeenCalledOnce();
  });
  it('fetch 非 ok 不解码也不写剪贴板', async () => {
    harness.fetch.mockResolvedValue(new Response('not found', { status: 404 }));
    await copy('local-image:///tmp/missing.png');
    expect(harness.bitmap).not.toHaveBeenCalled();
    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });
  it('已获取的外部 SVG 无法解码时不写剪贴板、不注入活动内容', async () => {
    harness.fetch.mockResolvedValue(new Response(new Blob(['<svg/>'], { type: 'image/svg+xml' })));
    harness.bitmap.mockRejectedValueOnce(new Error('SVG cannot be decoded'));
    await copy('https://example.com/external.svg');
    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', description: 'SVG cannot be decoded' })
    );
    expect(container.querySelector('svg,iframe,object,embed')).toBeNull();
  });
  it.each(['context', 'draw', 'convert'])('转码失败仍释放 bitmap：%s', async (stage) => {
    noContext = stage === 'context';
    if (stage === 'draw')
      harness.draw.mockImplementationOnce(() => {
        throw new Error('draw failed');
      });
    if (stage === 'convert') harness.convert.mockRejectedValueOnce(new Error('convert failed'));
    await copy('data:image/jpeg;base64,AQID');
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', description: expect.any(String) })
    );
  });
  it.each(['data:image/png;base64,%%%', 'https://example.com/external.svg'])(
    '坏数据或外部 SVG 失败安全且仍可点击预览：%s',
    async (src) => {
      harness.fetch.mockRejectedValue(new Error('CSP blocked'));
      await copy(src);
      expect(harness.write).not.toHaveBeenCalled();
      expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
      await act(async () =>
        container
          .querySelector('button:not([role])')
          ?.dispatchEvent(new window.Event('click', { bubbles: true }))
      );
      expect(container.querySelectorAll('img')).toHaveLength(2);
      expect(container.querySelector('iframe,object,embed')).toBeNull();
    }
  );
  it('剪贴板拒绝不影响预览打开与 Esc 关闭', async () => {
    harness.write.mockRejectedValueOnce(new Error('denied'));
    await copy('data:image/png;base64,AQID');
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', description: 'denied' })
    );
    await act(async () =>
      container
        .querySelector('button:not([role])')
        ?.dispatchEvent(new window.Event('click', { bubbles: true }))
    );
    expect(container.querySelectorAll('img')).toHaveLength(2);
    await act(async () => {
      const event = new window.Event('keydown');
      Object.assign(event, { key: 'Escape' });
      window.dispatchEvent(event);
    });
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });
});
