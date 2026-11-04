// @vitest-environment happy-dom
import type { BotArtifactTarget, BotDesignArtifact } from '@shared/types/botIpc';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BotDesignCard } from './BotDesignCard';

const h = vi.hoisted(() => ({ loadCover: vi.fn(), reveal: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ addToast: vi.fn() }));
vi.mock('@/features/design/host/bot-canvas', () => ({
  isViewedBotDesignChat: () => true,
  revealBotDesign: h.reveal,
}));
vi.mock('@/features/design/host/translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/features/design/vetta/src/canvas/raster-cache', () => ({
  loadCover: h.loadCover,
  onCoverSaved: () => () => {},
}));

it('loads a cover and opens the current artifact using a canonical Windows drive root', async () => {
  const design: BotDesignArtifact = { rel: '目录/设计.vetd', name: '设计', sessionId: 'owner' };
  const target: BotArtifactTarget = { chatId: 'chat', entryId: 'entry' };
  const resolveRoot = vi.fn(async (ref: unknown) => ({ ok: true, root: { ref, path: 'C:/' } }));
  const list = vi.fn(async () => ({ ok: true, designs: [{ ...design, projectId: 'project' }] }));
  h.loadCover.mockResolvedValue('data:image/png;base64,AA==');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { design: { resolveRoot }, bots: { artifacts: { list } } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(BotDesignCard, { target, design })));
    expect(h.loadCover).toHaveBeenCalledWith('C:/目录/设计.vetd');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
    await act(async () => container.querySelector('button')?.click());
    expect(list).toHaveBeenCalledWith(target);
    expect(resolveRoot.mock.calls).toEqual([
      [{ kind: 'session', sessionId: 'owner' }],
      [{ kind: 'project', projectId: 'project' }],
    ]);
    expect(h.reveal).toHaveBeenCalledWith({
      chatId: 'chat',
      sessionId: 'owner',
      projectId: 'project',
      cwd: 'C:/',
      path: 'C:/目录/设计.vetd',
    });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
