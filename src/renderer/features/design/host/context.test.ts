import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ conversations: {} }) },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ projects: [], language: 'en' }) },
}));

import { createDesignContext } from './context';
import { captureDesign, startEngine } from './engine';
import { designPaths } from './paths';

afterEach(() => vi.unstubAllGlobals());
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
