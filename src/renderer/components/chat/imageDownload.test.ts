// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadImage } from './imageDownload';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('原图下载', () => {
  it('下载原始字节和原文件名，点击后才释放临时URL且不遗留链接', async () => {
    vi.useFakeTimers();
    const blob = new Blob(['original webp bytes'], { type: 'image/webp' });
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', fetch);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let target: { url: string; name: string; attached: boolean } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      target = { url: this.href, name: this.download, attached: this.isConnected };
    });
    await downloadImage('local-image://posix/workspace/picture.webp', 'picture.webp');
    expect(fetch).toHaveBeenCalledWith('local-image://posix/workspace/picture.webp');
    expect(create).toHaveBeenCalledWith(blob);
    expect(target).toEqual({ url: 'blob:download', name: 'picture.webp', attached: true });
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledWith('blob:download');
  });
  it('读取失败不下载错误响应或留下临时URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    const create = vi.spyOn(URL, 'createObjectURL');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    await expect(downloadImage('local-image://posix/missing.png', 'missing.png')).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
