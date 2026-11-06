import { afterEach, expect, it, vi } from 'vitest';

const { sessions, settings, reveal, mode, insert, attachment } = vi.hoisted(() => ({
  insert: vi.fn(),
  attachment: vi.fn(),
  mode: { bot: false },
  sessions: {
    activeId: 'b',
    conversations: {
      a: { id: 'a', projectId: 'pa', sessionFile: 'a.jsonl', createdAt: 1, lastActiveAt: 10 },
      b: {
        id: 'b',
        projectId: 'pb',
        sessionFile: 'b.jsonl',
        createdAt: 2,
        lastActiveAt: 20,
        parentId: undefined as string | undefined,
        worktree: undefined as { path: string } | undefined,
      },
    },
    selectConversation: vi.fn(),
  },
  settings: {
    projects: [
      { id: 'pa', path: '/a' },
      { id: 'pb', path: '/b' },
    ],
    language: 'en',
  },
  reveal: vi.fn(),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => sessions },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => settings },
}));
vi.mock('@/lib/sidePanelDock', () => ({
  addSidePanelDesign: reveal,
  setSidePanelDesignVisible: vi.fn(),
}));
vi.mock('@/stores/bots/mode', () => ({
  isBotModeActive: () => mode.bot,
  showLocalCodeView: vi.fn(),
}));
vi.mock('./composer', () => ({
  insertDesignComposerText: insert,
  setDesignPromptAttachment: attachment,
}));

import { CANVAS_TAB_ID } from '../vetta/src/tab-ids';
import { createDesignContext, emitDesignConversation } from './context';
import { captureDesign, startEngine } from './engine';
import { createMainDesignHost } from './main-host';
import { designPaths } from './paths';
import { useDesignRegistry } from './registry';

const mainContext = () => createDesignContext(createMainDesignHost());

afterEach(() => {
  mode.bot = false;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessions.conversations.b.worktree = undefined;
  sessions.conversations.b.parentId = undefined;
  settings.projects[1].path = '/b';
});
it('rejects Bot canvas prompts, insertions and attachments instead of falling back to hidden Code', async () => {
  mode.bot = true;
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: { id: 'b', cwd: '/b', sessionPath: null, model: null, isStreaming: false },
  });
  const ctx = mainContext();
  expect(() => ctx.conversation.insertText('do not send')).toThrow('No matching design composer');
  expect(() => ctx.ui.setPromptAttachment(null)).toThrow('No matching design composer');
  await expect(ctx.conversation.sendPrompt('do not send')).rejects.toThrow(
    'No active design conversation'
  );
  expect(insert).not.toHaveBeenCalled();
  expect(attachment).not.toHaveBeenCalled();
});
it('gallery session navigation candidates are newest first, rather than object insertion order', async () => {
  settings.projects[1].path = '/a';
  expect((await mainContext().official.sessions.list('/a')).map((item) => item.path)).toEqual([
    'b.jsonl',
    'a.jsonl',
  ]);
});
it('gallery navigation never treats a coworker as a root conversation', async () => {
  settings.projects[1].path = '/a';
  sessions.conversations.b.parentId = 'a';
  expect((await mainContext().official.sessions.list('/a')).map((item) => item.path)).toEqual([
    'a.jsonl',
  ]);
});
it('opens the viewed session using its authoritative cwd even when the stored cwd is an alias', () => {
  sessions.conversations.b.worktree = { path: '/tmp/b' };
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: {
      id: 'b',
      cwd: '/private/tmp/b',
      sessionPath: null,
      model: null,
      isStreaming: false,
    },
  });
  mainContext().ui.openActivityTab(CANVAS_TAB_ID, { cwd: '/private/tmp/b' });
  expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'b' }));
  expect(sessions.selectConversation).not.toHaveBeenCalled();
});
it('a late background open cannot steal the canvas before the viewing effect catches up', () => {
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: { id: 'a', cwd: '/a', sessionPath: null, model: null, isStreaming: false },
  });
  mainContext().ui.openActivityTab(CANVAS_TAB_ID, { cwd: '/a' });
  expect(sessions.selectConversation).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});
const root = { kind: 'session' as const, sessionId: 'adapter-test' };
it('sends only root references and relative paths; rejects outside paths before IPC', async () => {
  designPaths.remember({ ref: root, path: '/adapter' });
  const fs = vi.fn(async (_request: unknown) => ({ ok: true, content: 'text', encoding: 'utf8' }));
  vi.stubGlobal('electronAPI', { design: { fs } });
  const ctx = createDesignContext();
  expect(await ctx.fs.readFile('/adapter/a.vetd/frames/a.tsx')).toEqual({
    content: 'text',
    encoding: 'utf8',
  });
  expect(fs.mock.calls).toEqual([[{ op: 'readFile', root, rel: 'a.vetd/frames/a.tsx' }]]);
  await expect(ctx.fs.readFile('/adapter-other/passwords')).rejects.toThrow();
  expect(fs).toHaveBeenCalledTimes(1);
});
it('reconstructs SDK scan-relative paths from Main root-relative files', async () => {
  designPaths.remember({ ref: root, path: '/adapter' });
  vi.stubGlobal('electronAPI', {
    design: {
      fs: async () => ({ ok: true, files: [{ name: 'a.tsx', rel: 'a.vetd/frames/a.tsx' }] }),
    },
  });
  expect(await createDesignContext().fs.listFilesRecursive('/adapter/a.vetd')).toEqual([
    { name: 'a.tsx', path: '/adapter/a.vetd/frames/a.tsx', relPath: 'frames/a.tsx' },
  ]);
});
it('watch notifications carry the watched directory, not the watch id', async () => {
  designPaths.remember({ ref: root, path: '/adapter' });
  let onEvent: ((event: { watchId: string }) => void) | undefined;
  const unwatch = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('electronAPI', {
    design: {
      onWatchEvent: (listener: typeof onEvent) => {
        onEvent = listener;
        return () => {};
      },
      watch: async () => ({ ok: true, watchId: 'w' }),
      unwatch,
    },
  });
  const changed = vi.fn();
  const disposable = createDesignContext().fs.watchDirectory('/adapter/a.vetd', changed);
  await Promise.resolve();
  await Promise.resolve();
  onEvent?.({ watchId: 'other' });
  onEvent?.({ watchId: 'w' });
  expect(changed.mock.calls).toEqual([['/adapter/a.vetd']]);
  disposable.dispose();
  onEvent?.({ watchId: 'w' });
  expect(unwatch).toHaveBeenCalledWith('w');
  expect(changed).toHaveBeenCalledTimes(1);
});
it('maps capture URLs by registered engine port and rejects all other origins', async () => {
  designPaths.remember({ ref: root, path: '/adapter' });
  const capture = vi.fn(async (_request: unknown) => ({
    ok: true,
    dataUrl: 'data:image/png;base64,AA==',
    scaleFactor: 1,
  }));
  vi.stubGlobal('electronAPI', {
    design: {
      engine: async () => ({
        ok: true,
        engineId: 'e',
        port: 5123,
        origin: 'http://127.0.0.1:5123',
      }),
      onEngineExit: () => () => {},
      capture,
    },
  });
  await startEngine('/adapter/a.vetd');
  await captureDesign({ url: 'http://127.0.0.1:5123/a?x=1#h', width: 100, height: 200 });
  expect(capture.mock.calls).toEqual([
    [{ op: 'offscreen', engineId: 'e', path: '/a?x=1#h', width: 100, height: 200 }],
  ]);
  for (const url of ['https://127.0.0.1:5123', 'http://evil:5123', 'http://127.0.0.1:5124'])
    await expect(captureDesign({ url, width: 1, height: 1 })).rejects.toThrow();
  expect(capture).toHaveBeenCalledTimes(1);
});
it('maps an interaction preview URL to an engine id and route without widening external URLs', async () => {
  designPaths.remember({ ref: root, path: '/adapter' });
  const shell = vi.fn(async (_request: unknown) => ({ ok: true }));
  vi.stubGlobal('electronAPI', {
    design: {
      engine: async () => ({ ok: true, engineId: 'interaction', port: 5312 }),
      onEngineExit: () => () => {},
      shell,
    },
  });
  const handle = await startEngine('/adapter/interaction.vetd');
  const { ui } = createDesignContext();
  await ui.openExternal('http://127.0.0.1:5312/settings-ssh?tab=a#top');
  expect(shell).toHaveBeenLastCalledWith({
    op: 'openEngineRoute',
    engineId: 'interaction',
    path: '/settings-ssh?tab=a#top',
  });
  await ui.openExternal('https://example.com/');
  expect(shell).toHaveBeenLastCalledWith({ op: 'openExternal', url: 'https://example.com/' });
  for (const url of ['http://127.0.0.1:5313/', 'http://other.test/', 'http://user@127.0.0.1:5312/'])
    await expect(ui.openExternal(url)).rejects.toThrow();
  await handle.stop();
  await expect(ui.openExternal('http://127.0.0.1:5312/')).rejects.toThrow();
  expect(shell).toHaveBeenCalledTimes(2);
});
it('a design-window host only forwards prompts; main-window-only APIs fail without touching sessions', async () => {
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: { id: 'b', cwd: '/b', sessionPath: null, model: null, isStreaming: false },
  });
  const sendPrompt = vi.fn(async () => ({ status: 'sent' as const }));
  const ctx = createDesignContext({ conversation: { sendPrompt } });
  const canvas = { sessionId: 'b', cwd: '/b', skipIfStreaming: true };
  await expect(ctx.conversation.sendPrompt('handle notes', canvas)).resolves.toEqual({
    status: 'sent',
  });
  expect(sendPrompt).toHaveBeenCalledWith('handle notes', canvas);
  expect(() => ctx.conversation.insertText('x')).toThrow(/not supported/);
  expect(() => ctx.conversation.createSession('/b')).toThrow(/not supported/);
  expect(() => ctx.ui.setPromptAttachment(null)).toThrow(/not supported/);
  expect(() => ctx.official.sessions.list('/b')).toThrow(/not supported/);
  ctx.ui.openActivityTab(CANVAS_TAB_ID, { cwd: '/b' });
  ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true, { cwd: '/b' });
  ctx.ui.setActivityPanelWidth('max');
  expect(useDesignRegistry.getState().ui[`activity:/b:${CANVAS_TAB_ID}`]).toMatchObject({
    open: true,
  });
  expect(useDesignRegistry.getState().ui[`visible:/b:${CANVAS_TAB_ID}`]).toBe(true);
  expect(sessions.selectConversation).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});
