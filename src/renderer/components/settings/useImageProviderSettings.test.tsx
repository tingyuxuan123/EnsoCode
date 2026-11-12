// @vitest-environment happy-dom

import { DEFAULT_IMAGE_PROVIDER, type ImageProviderView } from '@shared/imageProvider';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useImageProviderSettings } from './useImageProviderSettings';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

async function fixture() {
  let view: ImageProviderView = {
    configured: false,
    config: { ...DEFAULT_IMAGE_PROVIDER },
    hasApiKey: false,
    secureStorageAvailable: true,
  };
  let changed = () => {};
  const api = {
    read: vi.fn(async () => ({ ok: true as const, value: view })),
    update: vi.fn(async (patch: object) => {
      view = { ...view, configured: true, config: { ...view.config, ...patch } };
      return { ok: true as const, value: view };
    }),
    setApiKey: vi.fn(async () => ({ ok: true as const, value: view })),
    listModels: vi.fn(async () => ({ ok: true as const, value: { models: [] as string[] } })),
    onChanged: (callback: () => void) => {
      changed = callback;
      return () => {};
    },
  };
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { imageProvider: api },
  });
  let state!: ReturnType<typeof useImageProviderSettings>;
  function Probe() {
    state = useImageProviderSettings();
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  return {
    api,
    get state() {
      return state;
    },
    external(next: ImageProviderView) {
      view = next;
      changed();
    },
    dispose: () => act(async () => root.unmount()),
  };
}
describe('图片设置动作', () => {
  it('首次保存默认地址也持久化独立配置，不继续向旧provider回退', async () => {
    const test = await fixture();
    try {
      await act(async () => {
        await test.state.saveConnection(DEFAULT_IMAGE_PROVIDER.baseUrl);
      });
      expect(test.api.update).toHaveBeenCalledWith({ baseUrl: DEFAULT_IMAGE_PROVIDER.baseUrl });
      expect(test.state.view?.configured).toBe(true);
    } finally {
      await test.dispose();
    }
  });
  it('操作期间的跨窗更新在结束后重读，不丢掉新的端点状态', async () => {
    const test = await fixture();
    try {
      let finish!: (value: { ok: true; value: { models: string[] } }) => void;
      test.api.listModels.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      await act(async () => {
        const pending = test.state.listModels();
        test.external({
          ...test.state.view!,
          configured: true,
          config: { ...DEFAULT_IMAGE_PROVIDER, baseUrl: 'https://new.example/v1' },
        });
        finish({ ok: true, value: { models: [] } });
        await pending;
      });
      expect(test.state.view?.config.baseUrl).toBe('https://new.example/v1');
    } finally {
      await test.dispose();
    }
  });
});
