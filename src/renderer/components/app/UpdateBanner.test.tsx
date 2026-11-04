// @vitest-environment happy-dom
import type { UpdateStatus } from '@shared/types/updater';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';

const settings = vi.hoisted(() => ({ autoUpdate: false }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: typeof settings) => unknown) => select(settings),
}));

const info = {
  version: '0.2.13',
  releaseNotes: [
    '## Verified changes',
    '- A real fix',
    '- [Project](https://example.com/changes)',
    '- [Unsafe file](file:///tmp/example)',
    '- [Unsafe JS](javascript:alert%281%29)',
    '- [Relative](//example.com/local)',
    '- ![Network image](https://example.com/track.png)',
    '',
    '<iframe src="https://example.com"></iframe><script>alert(1)</script>',
  ].join('\n'),
};

describe('UpdateBanner', () => {
  const downloadUpdate = vi.fn(async () => {});
  const quitAndInstall = vi.fn(async () => {});
  let listener: (next: UpdateStatus) => void;
  let root: Root;

  const status = (next: UpdateStatus) => act(async () => listener(next));
  const button = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent === text);

  beforeEach(async () => {
    settings.autoUpdate = false;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('electronAPI', {
      updater: {
        onStatus: (callback: typeof listener) => {
          listener = callback;
          return () => {};
        },
        downloadUpdate,
        quitAndInstall,
      },
    });
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<UpdateBanner />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('可用状态提供日志和手动下载；下载完成仍可看日志并重启', async () => {
    await status({ status: 'available', info });
    expect(button('Release notes')).toBeDefined();
    expect(button('Restart to update')).toBeUndefined();
    await act(async () => button('Download')?.click());
    expect(downloadUpdate).toHaveBeenCalledOnce();

    await status({ status: 'downloaded', info });
    expect(button('Download')).toBeUndefined();
    await act(async () => button('Release notes')?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('A real fix');
    await act(async () => button('Restart to update')?.click());
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });

  it('自动下载开启时不显示手动下载；日志只渲染安全外链，无活动 HTML、图片或本地链接', async () => {
    settings.autoUpdate = true;
    await status({ status: 'available', info });
    expect(button('Download')).toBeUndefined();
    await act(async () => button('Release notes')?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Verified changes');
    expect(dialog?.querySelector('img, iframe, script')).toBeNull();
    const links = Array.from(dialog?.querySelectorAll('a') ?? []);
    expect(links.map((link) => [link.getAttribute('href'), link.target, link.rel])).toEqual([
      ['https://example.com/changes', '_blank', 'noopener noreferrer'],
    ]);
    await status({ status: 'downloading' });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Verified changes');
  });

  it('手动下载失败恢复可见错误，不留下无响应的下载按钮', async () => {
    downloadUpdate.mockRejectedValueOnce(new Error('Download failed'));
    await status({ status: 'available', info });
    await act(async () => button('Download')?.click());
    expect(document.body.textContent).toContain('Download failed');
    expect(button('Download')).toBeUndefined();
  });

  it('正式 feed 的纯 HTML 日志保留可读正文，只留下非互动安全标签', async () => {
    await status({
      status: 'available',
      info: {
        version: '0.2.14',
        releaseNotes:
          '<h2 id="location" onclick="alert(1)">Official changes</h2><p style="background:url(https://evil.example/track)">A <strong>readable fix</strong> &amp; details.</p><ul><li>Fixed a crash</li></ul><a href="https://example.com/notes" ping="https://evil.example/ping">Details</a><img src="https://evil.example/image"><iframe src="https://evil.example/frame"></iframe><script>malicious()</script><style>@import url(https://evil.example/style);</style><form action="https://evil.example/post"><input name="token"><button>Submit</button></form><video poster="https://evil.example/poster"><source src="https://evil.example/video"></video><svg><image href="https://evil.example/svg"></image></svg>',
      },
    });
    await act(async () => button('Release notes')?.click());
    const body = document.querySelector('[role="dialog"] [data-slot="dialog-panel"]');
    expect(body?.querySelector('h2')?.textContent).toBe('Official changes');
    expect(body?.querySelector('strong')?.textContent).toBe('readable fix');
    expect(body?.textContent).toContain('Fixed a crash');
    expect(
      body?.querySelector('img, iframe, script, style, form, input, video, source, svg')
    ).toBeNull();
    expect(
      body?.querySelector('[src], [poster], [ping], [onclick], [style], #location')
    ).toBeNull();
    expect(body?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/notes');
    expect(body?.textContent).not.toContain('malicious');
  });

  it('Markdown 和 HTML 都拒绝带内嵌凭证的 URL，不生成可点击链接', async () => {
    await status({
      status: 'available',
      info: {
        version: '0.2.14',
        releaseNotes:
          '[Credentialed](https://user:secret@example.com/path)\n\n<a href="http://token@example.com/">Token</a><a href="file:///tmp/secret">Local</a>',
      },
    });
    await act(async () => button('Release notes')?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Credentialed');
    expect(dialog?.textContent).toContain('Token');
    expect(dialog?.querySelector('a')).toBeNull();
  });

  it('安装失败显示具体错误，覆盖已下载状态并移除重启动作和日志', async () => {
    await status({ status: 'downloaded', info });
    await act(async () => button('Release notes')?.click());
    await status({ status: 'error', error: 'Code signature verification failed' });
    expect(document.body.textContent).toContain('Code signature verification failed');
    expect(button('Restart to update')).toBeUndefined();
    expect(button('Release notes')).toBeUndefined();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
