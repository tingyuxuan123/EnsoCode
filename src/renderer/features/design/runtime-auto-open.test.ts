import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ conversations: {} }) },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ projects: [], language: 'en' }) },
}));
vi.mock('./vetta/src/canvas/CanvasTab', () => ({ CanvasTab: () => null }));

import { createDesignContext, emitDesignConversation } from './host/context';
import { requestCanvasReveal } from './vetta/src/gallery/open-project';
import plugin from './vetta/src/index';
import { CANVAS_TAB_ID } from './vetta/src/tab-ids';

const open = vi.fn();
const visible = vi.fn();
const scan = vi.fn(async () => [
  { name: 'design.json', path: '/work/app.vetd/design.json', relPath: 'app.vetd/design.json' },
]);

async function enter(id: string): Promise<void> {
  emitDesignConversation({
    type: 'conversation-changed',
    conversation: { id, cwd: '/work', sessionPath: null, model: null, isStreaming: false },
  });
  await Promise.resolve();
  await vi.dynamicImportSettled();
}

beforeAll(async () => {
  vi.stubGlobal('electronAPI', {
    design: {
      storage: async () => ({ ok: true, data: null }),
      network: async () => ({ ok: false, error: 'offline', code: 'FAILED' }),
    },
  });
  const ctx = createDesignContext({
    ui: { openActivityTab: open, setActivityTabVisible: visible },
  });
  vi.spyOn(ctx.fs, 'listFilesRecursive').mockImplementation(scan);
  await plugin.activate(ctx);
});

afterAll(() => vi.unstubAllGlobals());

it('switching to a new chat in the same pure-design workspace exposes the entry without opening it', async () => {
  await enter('old-design-chat');
  open.mockClear();
  visible.mockClear();
  await enter('new-normal-chat');
  expect(scan).toHaveBeenCalledWith('/work');
  expect(visible).toHaveBeenCalledWith(CANVAS_TAB_ID, true);
  expect(open).not.toHaveBeenCalled();
});

it('an explicit gallery request still opens the canvas once, not again for the next chat', async () => {
  open.mockClear();
  requestCanvasReveal('/work');
  await enter('gallery-chat');
  expect(open).toHaveBeenCalledWith(CANVAS_TAB_ID, { width: 'max' });
  open.mockClear();
  await enter('another-normal-chat');
  expect(open).not.toHaveBeenCalled();
});
