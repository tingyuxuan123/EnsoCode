import { describe, expect, it, vi } from 'vitest';
import { createExtensionPluginHandlers, isTrustedPluginSender } from './extensionPlugins';

vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: vi.fn(),
  sendToAllWindows: vi.fn(),
}));
vi.mock('../windows/MainWindow', () => ({ getMainWindow: () => null }));
vi.mock('../windows/SettingsWindow', () => ({ getSettingsWindow: () => null }));

function event(id = 7, entry = 'file:///app/renderer/index.html', subframe = false) {
  const mainFrame = { url: entry };
  return {
    sender: { id, isDestroyed: () => false, mainFrame },
    senderFrame: subframe ? { url: entry } : mainFrame,
  };
}
const trust = {
  mainId: 7,
  settingsId: 8,
  mainUrl: 'file:///app/renderer/index.html',
  settingsUrl: 'file:///app/renderer/settings.html',
};
describe('privileged native plugin IPC', () => {
  it('list 透传登记表只读状态与插件数组', async () => {
    const result = { plugins: [], registryError: '只读；备份：registry.corrupt' };
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ list: () => result }) as never,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    expect(await h.list(event())).toEqual(result);
  });
  it('URL 暂存传递 owner 的 AbortSignal，窗口销毁即取消', async () => {
    const controller = new AbortController();
    const stage = vi.fn(async (_source, _owner, signal: AbortSignal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      );
      return { ok: false, error: 'cancelled' };
    });
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ stage }) as never,
      signal: () => controller.signal,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    const request = h.stageUrl(event(), 'https://public.example/plugin.zip');
    controller.abort();
    expect(await request).toMatchObject({ ok: false });
    expect(stage).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://public.example/plugin.zip' },
      7,
      controller.signal
    );
  });
  it('手势按 unknown 收窄，缺省 false 且不信任 payload 内伪造字段', async () => {
    const callUi = vi.fn(async () => null);
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ callUi }) as never,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    const input = {
      pluginId: 'a.b',
      method: 'renderer.call',
      sessionId: 's',
      payload: { gesture: true },
    };
    await h.call(event(), input);
    expect(callUi).toHaveBeenLastCalledWith(expect.objectContaining({ gesture: false }));
    await h.call(event(), { ...input, gesture: true });
    expect(callUi).toHaveBeenLastCalledWith(expect.objectContaining({ gesture: true }));
    expect(await h.call(event(), { ...input, gesture: 'true' })).toMatchObject({ ok: false });
  });
  it('trusts only exact MainWindow/settings main frame, never remote, iframe or navigated document', () => {
    expect(isTrustedPluginSender(event(), trust)).toBe(true);
    expect(isTrustedPluginSender(event(8, trust.settingsUrl), trust)).toBe(true);
    for (const e of [
      event(9),
      event(7, trust.mainUrl, true),
      event(7, 'https://evil.example/'),
      event(7, 'file:///app/renderer/plugin-view.html'),
      event(8, trust.mainUrl),
    ])
      expect(isTrustedPluginSender(e, trust)).toBe(false);
  });
  it('denies every privileged handler before service, picker or filesystem use', async () => {
    const service = vi.fn();
    const pick = vi.fn();
    const h = createExtensionPluginHandlers({
      trusted: (e) => isTrustedPluginSender(e, trust),
      service,
      pick,
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    for (const handler of Object.values(h))
      expect(await handler(event(99), { pluginId: 'a.b' })).toMatchObject({ ok: false });
    expect(service).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
  });
  it('binds stage URL, commit and discard to initiating sender and rejects arbitrary filesystem source', async () => {
    const stage = vi.fn(async () => ({ ok: true, preview: { token: 't' } }));
    const commit = vi.fn(async () => ({ ok: true }));
    const discard = vi.fn(() => true);
    const service = () => ({ stage, commit, discard }) as never;
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    await h.stageUrl(event(), 'https://example.com/plugin.zip');
    await h.commit(event(), 't');
    await h.discard(event(), 't');
    expect(stage).toHaveBeenCalledWith(
      { kind: 'url', url: 'https://example.com/plugin.zip' },
      7,
      undefined
    );
    expect(commit).toHaveBeenCalledWith('t', 7);
    expect(discard).toHaveBeenCalledWith('t', 7);
    expect(await h.pickAndStage(event(), { kind: 'dir', path: '/etc' })).toMatchObject({
      ok: false,
    });
  });
});
