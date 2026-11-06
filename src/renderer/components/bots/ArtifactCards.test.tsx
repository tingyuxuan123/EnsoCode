// @vitest-environment happy-dom
import type { BotArtifactTarget } from '@shared/types/botIpc';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactCards } from './ArtifactCards';

const h = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), open: vi.fn(), toast: vi.fn() }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/ui/toast', () => ({ addToast: h.toast }));
vi.mock('@/lib/sidePanelDock', () => ({ openSidePanelFile: vi.fn() }));
vi.mock('@/components/chat/CodeBlock', () => ({ CodeBlock: () => null }));
vi.mock('@/components/chat/MermaidRenderer', () => ({ MermaidRenderer: () => null }));
vi.mock('@/components/chat/ReadFileView', () => ({ ReadFileView: () => null }));
vi.mock('./BotDesignCard', () => ({ BotDesignCard: () => null }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ designEnabled: true, contextMenuOpen: [], projects: [] }),
}));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Wrap,
    DialogHeader: Wrap,
    DialogTitle: Wrap,
  };
});

let root: Root;
let container: HTMLDivElement;
let target: BotArtifactTarget;
let serial = 0;
const artifact = { rel: 'docs/首页.png', name: '首页.png', size: 2000, kind: 'image' };
const thumb = 'data:image/jpeg;base64,VEhVTUI=';
const full = 'data:image/png;base64,RlVMTA==';

beforeEach(() => {
  vi.clearAllMocks();
  target = { chatId: 'chat', entryId: `entry-${++serial}` };
  h.list.mockResolvedValue({
    ok: true,
    workspaceRoot: '/ws',
    artifacts: [artifact],
    media: [],
  });
  h.read.mockImplementation(async (request) => ({
    ok: true,
    kind: 'image',
    dataUrl: request.variant === 'thumb' ? thumb : full,
  }));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('electronAPI', {
    bots: { artifacts: { list: h.list, read: h.read, open: h.open } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(['docs/首页.png', 'file:///ws/docs/%E9%A6%96%E9%A1%B5.png', '/ws/docs/首页.png'])(
  '群回复正文链接 %s 打开权威产物的大图，不导航磁盘 URL',
  async (href) => {
    await act(async () =>
      root.render(<ArtifactCards target={target} text={`[首页稿](${href})`} />)
    );
    const link = container.querySelector('a');
    expect(link?.textContent).toBe('首页稿');
    expect(link?.getAttribute('href')).toBeNull();
    expect(link?.getAttribute('tabindex')).toBe('0');
    await act(async () => link?.click());
    expect(h.read).toHaveBeenCalledWith({ ...target, rel: artifact.rel });
    expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(full);
    expect(h.open).not.toHaveBeenCalled();
  }
);

it('图片附件直接显示有边界的缩略图，点击再读取原图', async () => {
  await act(async () => root.render(<ArtifactCards target={target} />));
  expect(h.read).toHaveBeenCalledWith({ ...target, rel: artifact.rel, variant: 'thumb' });
  const image = container.querySelector('[data-bot-artifact-image] img');
  expect(image?.getAttribute('src')).toBe(thumb);
  expect(image?.getAttribute('alt')).toBe(artifact.name);
  await act(async () => image?.closest('button')?.click());
  expect(h.read).toHaveBeenLastCalledWith({ ...target, rel: artifact.rel });
  expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(full);
});

it('离屏图片不读取文件，接近可见区域后只请求一次缩略图', async () => {
  let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  await act(async () => root.render(<ArtifactCards target={target} />));
  expect(h.read).not.toHaveBeenCalled();
  await act(async () => notify([{ isIntersecting: false }]));
  expect(h.read).not.toHaveBeenCalled();
  await act(async () => notify([{ isIntersecting: true }]));
  await act(async () => notify([{ isIntersecting: true }]));
  expect(disconnect).toHaveBeenCalled();
  expect(h.read).toHaveBeenCalledExactlyOnceWith({
    ...target,
    rel: artifact.rel,
    variant: 'thumb',
  });
  expect(container.querySelector('[data-bot-artifact-image] img')?.getAttribute('src')).toBe(thumb);
});

it('正文链接支持 Enter，不把越界、未交付文件或危险协议交给 IPC', async () => {
  await act(async () =>
    root.render(
      <ArtifactCards
        target={target}
        text="[首页](docs/首页.png) [越界](file:///elsewhere/docs/首页.png) [未交付](other.png) [危险](javascript:alert%281%29) [网页](https://example.com)"
      />
    )
  );
  h.read.mockClear();
  const links = container.querySelectorAll('a');
  await act(async () => {
    links[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(h.read).toHaveBeenCalledWith({ ...target, rel: artifact.rel });
  h.read.mockClear();
  await act(async () => {
    links[1].click();
    links[2].click();
    links[3].click();
  });
  expect(h.read).not.toHaveBeenCalled();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(links[4].getAttribute('href')).toBe('https://example.com');
  expect(links[4].getAttribute('target')).toBe('_blank');
});

it('缩略图读取失败仍显示文件名并允许点击读取大图', async () => {
  h.read.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  await act(async () => root.render(<ArtifactCards target={target} />));
  const card = container.querySelector('[data-bot-artifact-image]');
  expect(card?.textContent).toContain(artifact.name);
  expect(card?.querySelector('img')).toBeNull();
  await act(async () => card?.querySelector('button')?.click());
  expect(container.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(full);
});

it('切换条目后不使用上一条的产物或迟到的图片', async () => {
  let finish: (value: unknown) => void = () => {};
  h.read.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await act(async () =>
    root.render(<ArtifactCards target={target} text="[首页](docs/首页.png)" />)
  );
  expect(container.querySelector('[data-bot-artifact-image]')).not.toBeNull();
  expect(container.querySelector('a')?.textContent).toBe('首页');
  h.list.mockResolvedValueOnce({ ok: true, workspaceRoot: '/new', artifacts: [], media: [] });
  const next = { chatId: 'chat', entryId: `entry-${++serial}` };
  await act(async () => root.render(<ArtifactCards target={next} text="[首页](docs/首页.png)" />));
  await act(async () => finish({ ok: true, kind: 'image', dataUrl: thumb }));
  expect(container.querySelector('[data-bot-artifact-image]')).toBeNull();
  h.read.mockClear();
  await act(async () => container.querySelector('a')?.click());
  expect(h.read).not.toHaveBeenCalled();
});
