// @vitest-environment happy-dom
import type { UpdateStatus } from '@shared/types/updater';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateRailItem } from './UpdateRailItem';

const settings = vi.hoisted(() => ({ autoUpdate: false }));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: typeof settings) => unknown) => select(settings),
}));
// 图标轨按钮的悬浮提示与 Popover 的定位都用 Base UI；这里只测内容与动作。
vi.mock('./RailTip', () => ({ RailTip: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/popover', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Trigger = ({ children, ...rest }: { children?: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  );
  return { Popover: Wrap, PopoverPopup: Wrap, PopoverTrigger: Trigger };
});

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

describe('UpdateRailItem', () => {
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
    await act(async () => root.render(<UpdateRailItem />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('下载中用图标轨上的圆环给出百分比，不再占一整条横幅', async () => {
    await status({
      status: 'downloading',
      progress: { percent: 8, bytesPerSecond: 1, total: 100, transferred: 8 },
    });
    const trigger = document.querySelector<HTMLButtonElement>('button[data-slot="update-rail"]');
    expect(trigger?.getAttribute('aria-label')).toBe('Downloading update… 8%');
    const ring = document.querySelector('[data-slot="update-progress"]');
    // 圆环是装饰：百分比由按钮的 aria-label 表达，弧长按 8% 画。
    expect(ring?.getAttribute('aria-hidden')).toBe('true');
    expect(ring?.querySelector('circle:last-of-type')?.getAttribute('stroke-dasharray')).toMatch(
      /^8(\s|$)/
    );
    // 横幅里的整行文字只在展开面板里出现，图标轨本身不再撑开工作区。
    expect(document.querySelector('[data-slot="update-banner"]')).toBeNull();
  });

  it('检查中、无新版本等状态在图标轨上不占位', async () => {
    for (const quiet of [
      { status: 'checking' },
      { status: 'not-available' },
    ] satisfies UpdateStatus[]) {
      await status(quiet);
      expect(document.querySelector('button[data-slot="update-rail"]')).toBeNull();
    }
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
