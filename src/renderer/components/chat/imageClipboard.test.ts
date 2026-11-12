// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImageToClipboard } from './imageClipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});
function clipboard() {
  const write = vi.fn(async (_items: unknown[]) => {});
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(readonly data: Record<string, Blob>) {}
    }
  );
  return write;
}
describe('图片剪贴板内容', () => {
  it('PNG复制图片字节，不写文件路径或文本', async () => {
    const write = clipboard();
    const blob = new Blob(['png'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, blob: async () => blob }))
    );
    await copyImageToClipboard('local-image://posix/picture.png');
    const items = write.mock.calls[0][0] as { data: Record<string, Blob> }[];
    expect(items[0].data).toEqual({ 'image/png': blob });
  });
  it('WebP先转为PNG再复制，并释放解码位图', async () => {
    const write = clipboard();
    const converted = new Blob(['converted'], { type: 'image/png' });
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['webp'], { type: 'image/webp' }),
      }))
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 20, height: 10, close }))
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage };
        }
        async convertToBlob() {
          return converted;
        }
      }
    );
    await copyImageToClipboard('local-image://posix/picture.webp');
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect((write.mock.calls[0][0] as { data: Record<string, Blob> }[])[0].data).toEqual({
      'image/png': converted,
    });
  });
  it('读取失败不破坏当前剪贴板', async () => {
    const write = clipboard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await expect(copyImageToClipboard('local-image://posix/missing.png')).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
