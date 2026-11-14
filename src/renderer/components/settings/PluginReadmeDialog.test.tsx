// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginReadmeDialog } from './PluginReadmeDialog';

type ReadmeResult = { ok: true; text: string } | { ok: false; error: string };
type Plugin = { id: string; name: string; from: 'installed' | 'market' };

const fixture = vi.hoisted(() => ({
  readme: vi.fn(),
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
// 只为状态机断言正文出现，不加载真实 Markdown 渲染链
vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('div', null, text),
}));
// Base UI 的焦点管理不属于本用例关注点
vi.mock('@/components/ui/dialog', () => {
  const Slot = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? children : null,
    DialogContent: Slot,
    DialogHeader: Slot,
    DialogTitle: Slot,
    DialogPanel: Slot,
    DialogFooter: Slot,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;

async function render(plugin: Plugin | null) {
  await act(async () => root.render(<PluginReadmeDialog plugin={plugin} onClose={() => {}} />));
}

/** 等 lazy(Markdown) 与 IPC promise 的微任务都落地 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

const text = () => container.textContent ?? '';
const retry = () =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.readme.mockReset();
  (
    window as unknown as {
      electronAPI: { extensionPlugins: Record<string, unknown> };
    }
  ).electronAPI = { extensionPlugins: { readme: fixture.readme } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('市场说明返回正文时渲染说明，不停留在加载中', async () => {
  fixture.readme.mockResolvedValue({
    ok: true,
    text: '# Chat Board\n玩法说明',
  } satisfies ReadmeResult);
  await render({ id: 'enso.chat-board', name: 'Chat Board', from: 'market' });
  await settle();
  expect(fixture.readme).toHaveBeenCalledWith({ id: 'enso.chat-board', from: 'market' });
  expect(text()).toContain('# Chat Board');
  expect(text()).not.toContain('Loading...');
});

it('空说明显示暂无说明，不误判为加载中', async () => {
  fixture.readme.mockResolvedValue({ ok: true, text: '   \n' } satisfies ReadmeResult);
  await render({ id: 'enso.chat-board', name: 'Chat Board', from: 'market' });
  await settle();
  expect(text()).toContain('No documentation yet');
  expect(text()).not.toContain('Loading...');
});

it('失败显示错误并可重试，重试成功后才显示正文', async () => {
  fixture.readme
    .mockResolvedValueOnce({ ok: false, error: '没有使用说明' } satisfies ReadmeResult)
    .mockResolvedValueOnce({ ok: true, text: '# Guide' } satisfies ReadmeResult);
  await render({ id: 'enso.chat-board', name: 'Chat Board', from: 'market' });
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('没有使用说明');
  const button = retry();
  expect(button).toBeDefined();
  await act(async () => button?.click());
  await settle();
  expect(fixture.readme).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(text()).toContain('# Guide');
});

it('切换插件后先返回的旧请求不覆盖新插件说明', async () => {
  const first = deferred<ReadmeResult>();
  const second = deferred<ReadmeResult>();
  fixture.readme.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render({ id: 'enso.chat-board', name: 'Chat Board', from: 'market' });
  await render({ id: 'enso.notes', name: 'Notes', from: 'market' });
  await act(async () => second.resolve({ ok: true, text: '# Notes' }));
  await settle();
  await act(async () => first.resolve({ ok: true, text: '# Chat Board' }));
  await settle();
  expect(text()).toContain('# Notes');
  expect(text()).not.toContain('# Chat Board');
});

it('重试时先回到加载中，不残留上一次错误', async () => {
  const retried = deferred<ReadmeResult>();
  fixture.readme
    .mockResolvedValueOnce({ ok: false, error: '没有使用说明' } satisfies ReadmeResult)
    .mockReturnValueOnce(retried.promise);
  await render({ id: 'enso.chat-board', name: 'Chat Board', from: 'market' });
  await settle();
  await act(async () => retry()?.click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(text()).toContain('Loading...');
  await act(async () => retried.resolve({ ok: true, text: '# Retried' }));
  await settle();
  expect(text()).toContain('# Retried');
});

it('关闭弹窗后旧请求返回不污染再次打开的内容', async () => {
  const first = deferred<ReadmeResult>();
  fixture.readme
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ ok: true, text: '# Fresh' } satisfies ReadmeResult);
  const plugin = { id: 'enso.chat-board', name: 'Chat Board', from: 'market' as const };
  await render(plugin);
  await render(null);
  await render(plugin);
  await settle();
  await act(async () => first.resolve({ ok: true, text: '# Stale' }));
  await settle();
  expect(text()).toContain('# Fresh');
  expect(text()).not.toContain('# Stale');
});
