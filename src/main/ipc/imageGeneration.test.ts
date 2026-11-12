import { DEFAULT_IMAGE_PROVIDER } from '@shared/imageProvider';
import { describe, expect, it, vi } from 'vitest';
import { createImageProviderHandlers } from './imageGeneration';

vi.mock('../windows/MainWindow', () => ({ isMainWebContents: () => false }));
vi.mock('../windows/SettingsWindow', () => ({ isSettingsWebContents: () => false }));
vi.mock('../windows/createAppWindow', () => ({ sendToAllWindows: vi.fn() }));

const frame = {};
const event = {
  sender: { id: 1, mainFrame: frame, getURL: () => 'http://localhost/settings.html' },
  senderFrame: frame,
};
const view = {
  configured: true,
  config: DEFAULT_IMAGE_PROVIDER,
  hasApiKey: true,
  secureStorageAvailable: true,
};
function fixture() {
  const store = {
    read: vi.fn(() => ({ ok: true as const, value: view })),
    update: vi.fn(() => ({ ok: true as const, value: view })),
    setApiKey: vi.fn(() => ({ ok: true as const, value: view })),
  };
  const deps = {
    trusted: vi.fn(() => true),
    store: vi.fn(() => store),
    models: vi.fn(async () => ({ ok: true as const, value: { models: ['gpt-image-2'] } })),
    changed: vi.fn(),
  };
  return { store, deps, handlers: createImageProviderHandlers(deps) };
}
describe('独立图片配置 IPC', () => {
  it('非可信窗口在读取、写入、发网络请求前被拒绝', async () => {
    const { handlers, deps } = fixture();
    deps.trusted.mockReturnValue(false);
    expect(handlers.read(event).ok).toBe(false);
    expect(handlers.update(event, { baseUrl: 'http://localhost' }).ok).toBe(false);
    expect(handlers.setApiKey(event, 'secret').ok).toBe(false);
    expect((await handlers.models(event)).ok).toBe(false);
    expect(deps.store).not.toHaveBeenCalled();
    expect(deps.models).not.toHaveBeenCalled();
  });
  it('模型查询不接受渲染层目标地址或凭证，成功写入广播脱敏刷新', async () => {
    const { handlers, deps, store } = fixture();
    expect(
      (await handlers.models(event, { baseUrl: 'https://evil.com', apiKey: 'secret' })).ok
    ).toBe(false);
    expect(deps.models).not.toHaveBeenCalled();
    expect(await handlers.models(event)).toEqual({ ok: true, value: { models: ['gpt-image-2'] } });
    expect(handlers.update(event, { quality: 'high' })).toEqual({ ok: true, value: view });
    expect(handlers.setApiKey(event, { baseUrl: view.config.baseUrl, key: 'secret' })).toEqual({
      ok: true,
      value: view,
    });
    expect(handlers.setApiKey(event, { baseUrl: 'https://evil.com/v1', key: 'secret' }).ok).toBe(
      false
    );
    expect(store.setApiKey).toHaveBeenCalledWith('secret');
    expect(deps.changed).toHaveBeenCalledTimes(2);
  });
});
