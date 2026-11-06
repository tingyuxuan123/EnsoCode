// @vitest-environment happy-dom
import type { BotChat } from '@shared/types/bot';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BotWorkspaceDesigns } from './BotWorkspaceDesigns';

const h = vi.hoisted(() => ({
  workspace: vi.fn(),
  resolve: vi.fn(),
  scan: vi.fn(),
  cover: vi.fn(),
  reveal: vi.fn(),
  projects: [{ id: 'p', path: '/work' }],
}));
vi.mock('@/features/design/host/paths', () => ({ resolveDesignRoot: h.resolve }));
vi.mock('@/features/design/host/bot-canvas', () => ({ revealBotDesign: h.reveal }));
vi.mock('@/features/design/host/translation', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock('@/features/design/vetta/src/plugin-context', () => ({
  getPluginCtx: () => ({ fs: { listFilesRecursive: h.scan } }),
}));
vi.mock('@/features/design/vetta/src/canvas/raster-cache', () => ({ loadCover: h.cover }));
vi.mock('@/features/design/mounts/DesignPanel', () => ({
  BotDesignPanel: ({ target }: { target: { path: string } }) =>
    createElement('div', { 'data-canvas': target.path }, target.path),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: unknown) => unknown) => select({ projects: h.projects }),
}));

const chat: BotChat = {
  id: 'empty-chat',
  kind: 'group',
  title: '',
  members: [],
  bossBotId: null,
  workspace: { kind: 'project', projectId: 'p' },
  routing: { mode: 'boss', maxHops: 2, maxTurnsPerBot: 2 },
  sessions: {},
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};
const rootInfo = { ref: { kind: 'project', projectId: 'p' }, path: '/work' };
const files = (rel: string) => [
  { name: 'design.json', path: `/work/${rel}/design.json`, relPath: `${rel}/design.json` },
];
let root: Root;
let container: HTMLDivElement;
const render = (props: Parameters<typeof BotWorkspaceDesigns>[0] = { chat }) =>
  act(async () => root.render(createElement(BotWorkspaceDesigns, props)));
const click = (label: string) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label
    );
    expect(button, label).toBeDefined();
    button?.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.workspace.mockResolvedValue({ ok: true, root: rootInfo });
  h.resolve.mockResolvedValue(rootInfo);
  h.scan.mockResolvedValue(files('docs/design/Nested.vetd'));
  h.cover.mockResolvedValue(null);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { bots: { designWorkspace: h.workspace } });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('discovers nested designs without messages or member sessions, then refreshes', async () => {
  await render();
  expect(h.workspace).toHaveBeenCalledWith({ chatId: chat.id });
  expect(h.resolve).toHaveBeenCalledWith(rootInfo.ref);
  expect(h.scan).toHaveBeenCalledWith('/work');
  expect(container.textContent).toContain('Nested');
  expect(container.textContent).toContain('docs/design/Nested.vetd');
  expect(h.reveal).not.toHaveBeenCalled();
  h.scan.mockResolvedValue(files('Other.vetd'));
  await click('workspace.refresh');
  expect(container.textContent).toContain('Other');
  expect(container.textContent).not.toContain('Nested');
  expect(h.workspace).toHaveBeenCalledTimes(2);
});
it('shows empty and failed states rather than creating a session', async () => {
  h.scan.mockResolvedValue([]);
  await render();
  expect(container.textContent).toContain('workspace.empty');
  h.workspace.mockResolvedValue({ ok: false, error: 'workspace_missing' });
  await click('workspace.refresh');
  expect(container.textContent).toContain('workspace.failed');
  expect(container.textContent).not.toContain('workspace.empty');
});
it('lists source-only nested bundles alongside normal empty-manifest drafts without creating files', async () => {
  h.scan.mockResolvedValue([
    ...files('design.vetd'),
    {
      name: 'theme.css',
      path: '/work/docs/design/real.vetd/theme.css',
      relPath: 'docs/design/real.vetd/theme.css',
    },
    {
      name: 'home.tsx',
      path: '/work/docs/design/real.vetd/frames/home.tsx',
      relPath: 'docs/design/real.vetd/frames/home.tsx',
    },
  ]);
  await render();
  expect(container.textContent).toContain('docs/design/real.vetd');
  expect(container.textContent).toContain('design.vetd');
  await click('real');
  expect(h.reveal).toHaveBeenCalledWith({
    chatId: chat.id,
    projectId: 'p',
    cwd: '/work',
    path: '/work/docs/design/real.vetd',
  });
});
it('shows scan failures and can retry', async () => {
  h.scan.mockRejectedValueOnce(new Error('disk gone'));
  await render();
  expect(container.textContent).toContain('workspace.failed');
  await click('workspace.refresh');
  expect(container.textContent).toContain('Nested');
});
it('does not offer a standalone legacy/share file as an openable workspace bundle', async () => {
  h.scan.mockResolvedValue([
    { name: 'share.vetd', path: '/work/share.vetd', relPath: 'share.vetd' },
    ...files('Valid.vetd'),
  ]);
  await render();
  expect(container.textContent).toContain('Valid.vetd');
  expect(container.textContent).not.toContain('share.vetd');
});
it('revalidates the authoritative workspace on click before opening a sessionless canvas', async () => {
  h.cover.mockResolvedValue('data:image/png;base64,cover');
  await render();
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cover');
  await click('Nested');
  expect(h.workspace).toHaveBeenCalledTimes(2);
  expect(h.resolve).toHaveBeenCalledTimes(2);
  expect(h.reveal).toHaveBeenCalledWith({
    chatId: chat.id,
    projectId: 'p',
    cwd: '/work',
    path: '/work/docs/design/Nested.vetd',
  });
});
it('does not open a listed path if the authoritative workspace changed before the click', async () => {
  await render();
  h.workspace.mockResolvedValue({
    ok: true,
    root: { ref: { kind: 'project', projectId: 'new' }, path: '/new' },
  });
  await click('Nested');
  expect(h.reveal).not.toHaveBeenCalled();
  expect(container.textContent).toContain('workspace.failed');
});
it('discards late discovery and late clicks when the chat or workspace changes', async () => {
  let finish: (value: unknown) => void = () => {};
  h.scan.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      })
  );
  await render();
  await render({ chat: { ...chat, id: 'other' } });
  await act(async () => finish(files('Stale.vetd')));
  expect(container.textContent).not.toContain('Stale');
  h.workspace.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      })
  );
  await click('Nested');
  h.scan.mockResolvedValue([]);
  await render({ chat: { ...chat, id: 'other', workspace: { kind: 'project', projectId: 'q' } } });
  expect(container.textContent).not.toContain('Nested');
  await act(async () => finish({ ok: true, root: rootInfo }));
  expect(h.reveal).not.toHaveBeenCalled();
});
it('preserves existing delivered previews even when workspace discovery fails, with return to list', async () => {
  h.workspace.mockResolvedValue({ ok: false, error: 'unavailable' });
  await render({
    chat,
    target: { chatId: chat.id, sessionId: 'delivery', cwd: '/old', path: '/old/Delivered.vetd' },
  });
  expect(container.querySelector('[data-canvas]')?.textContent).toContain('Delivered.vetd');
  await click('workspace.back');
  expect(container.querySelector('[data-canvas]')).toBeNull();
  expect(container.textContent).toContain('workspace.failed');
});
it('unmounts the old canvas on a workspace change even with the same chatId and target', async () => {
  const target = { chatId: chat.id, cwd: '/work', path: '/work/old.vetd', projectId: 'p' };
  await render({ chat, target });
  expect(container.querySelector('[data-canvas]')).not.toBeNull();
  await render({ chat: { ...chat, workspace: { kind: 'project', projectId: 'new' } }, target });
  expect(container.querySelector('[data-canvas]')).toBeNull();
});
it('unmounts the old canvas and discards a pending scan when the project path changes', async () => {
  const target = { chatId: chat.id, cwd: '/work', path: '/work/old.vetd', projectId: 'p' };
  await render({ chat, target });
  h.projects[0].path = '/moved';
  try {
    await render({ chat, target });
    expect(container.querySelector('[data-canvas]')).toBeNull();
  } finally {
    h.projects[0].path = '/work';
  }
});
