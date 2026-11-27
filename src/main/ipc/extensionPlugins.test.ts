import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionPluginHandlers,
  isTrustedPluginSender,
  parseConfigPatch,
  parseViewStatePatch,
} from './extensionPlugins';

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
  it('exports only the bound package through a native save choice and returns checksum, not an arbitrary path', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'authoring-export-ipc-'));
    const file = join(temp, 'package.zip'),
      destination = join(temp, 'chosen.zip');
    await writeFile(file, 'checked package bytes');
    const cleanup = vi.fn(async () => {}),
      save = vi.fn(async () => destination),
      exported = vi.fn(async () => ({
        file,
        name: 'a.b-1.0.0.zip',
        id: 'a.b',
        version: '1.0.0',
        sha256: 'a'.repeat(64),
        size: 21,
        cleanup,
      }));
    try {
      const h = createExtensionPluginHandlers({
        trusted: () => true,
        authoringTrusted: () => true,
        authoring: { create: vi.fn(), validate: vi.fn(), stage: vi.fn(), export: exported },
        save,
        service: () => ({}) as never,
        draft: () => ({}) as never,
        projectRoot: () => null,
        pick: vi.fn(),
      });
      const sender = event();
      const result = await h.exportAuthoringDraft(sender, 's', 'a.b');
      expect(result).toEqual({ ok: true, name: 'a.b-1.0.0.zip', sha256: 'a'.repeat(64), size: 21 });
      expect(save).toHaveBeenCalledWith(sender, 'a.b-1.0.0.zip');
      expect(cleanup).toHaveBeenCalledOnce();
      expect(await h.exportAuthoringDraft(event(), 's', 'a.b', '/other/path')).toMatchObject({
        ok: false,
      });
      expect(exported).toHaveBeenCalledOnce();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
  it('authoring lifecycle rejects arbitrary paths, extra proof fields, absent execution consent and non-main frames', async () => {
    const context = vi.fn(),
      open = vi.fn(),
      test = vi.fn(),
      evidence = vi.fn(),
      finishTrial = vi.fn();
    const h = createExtensionPluginHandlers({
      trusted: (e) => isTrustedPluginSender(e, trust),
      authoringTrusted: (e) => e.sender.id === 7,
      authoring: {
        create: vi.fn(),
        validate: vi.fn(),
        stage: vi.fn(),
        context,
        open,
        editInstalled: vi.fn(),
        test,
        evidence,
        finishTrial,
      },
      service: () => ({}) as never,
      draft: () => ({}) as never,
      projectRoot: () => null,
      pick: vi.fn(),
    });
    for (const bad of [event(8, trust.settingsUrl), event(7, trust.mainUrl, true)]) {
      expect(await h.authoringContext(bad, 's')).toMatchObject({ ok: false });
      expect(await h.testAuthoringDraft(bad, 's', 'a.b', true)).toMatchObject({ ok: false });
    }
    expect(await h.openAuthoringDraft(event(), 's', '/etc/passwd')).toMatchObject({ ok: false });
    expect(await h.testAuthoringDraft(event(), 's', 'a.b', false)).toMatchObject({ ok: false });
    expect(await h.finishAuthoringTrial(event(), 's', 'a.b', true, '/data')).toMatchObject({
      ok: false,
    });
    expect(
      await h.createAuthoringDraft(event(), 's', {
        template: 'workspace',
        request: 'notes',
        cwd: '/private',
      })
    ).toMatchObject({ ok: false });
    expect(
      await h.authoringEvidence(event(), 's', 'a.b', {
        layer: 'business',
        sourceHash: 'a'.repeat(64),
        note: 'verified',
        path: '/secret',
      })
    ).toMatchObject({ ok: false });
    expect(context).not.toHaveBeenCalled();
    expect(test).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(evidence).not.toHaveBeenCalled();
    expect(finishTrial).not.toHaveBeenCalled();
  });
  it('only the main window can create a plugin draft, and can only send a session id', async () => {
    const draft = { id: 'local.example', directory: 'plugin-example' };
    const create = vi.fn(async () => ({ ok: true as const, draft }));
    const deps = {
      trusted: (e: ReturnType<typeof event>) => isTrustedPluginSender(e, trust),
      authoringTrusted: (e: ReturnType<typeof event>) => e.sender.id === 7,
      authoring: { create, validate: vi.fn(), stage: vi.fn() },
      service: () => ({}) as never,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({}) as never,
    };
    const h = createExtensionPluginHandlers(deps);
    const createDraft = h.createAuthoringDraft;
    expect(await createDraft(event(8, trust.settingsUrl), 'local-session')).toMatchObject({
      ok: false,
    });
    expect(await createDraft(event(7, trust.mainUrl, true), 'local-session')).toMatchObject({
      ok: false,
    });
    expect(await createDraft(event(), '/tmp/another-folder')).toMatchObject({ ok: false });
    expect(await createDraft(event(), 'local-session', '/tmp/another-folder')).toMatchObject({
      ok: false,
    });
    expect(create).not.toHaveBeenCalled();
    expect(await createDraft(event(), 'local-session')).toEqual({ ok: true, draft });
    expect(create).toHaveBeenCalledExactlyOnceWith(7, 'local-session', undefined);
  });
  it('UI宿主调用只携带Main捕获的代际，拒绝renderer伪造证明', async () => {
    const callUi = vi.fn(async () => null);
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ callUi }) as never,
      pick: vi.fn(),
      projectRoot: () => '/project',
      sessionGeneration: () => 'authoritative-generation',
      draft: () => ({ respond: vi.fn() }) as never,
    });
    const input = { pluginId: 'a.b', method: 'command.run', sessionId: 's', payload: { id: 'go' } };
    await h.call(event(), input);
    expect(callUi).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 'authoritative-generation' })
    );
    expect(await h.call(event(), { ...input, generation: 'forged' })).toMatchObject({ ok: false });
  });
  it('detached project views use only Main-resolved workspace roots, never session or path overrides', async () => {
    const callUi = vi.fn(async () => null);
    const resolve = vi.fn((context) =>
      context?.projectId === 'b'
        ? { projectRoot: '/projects/b' }
        : context === null
          ? { projectRoot: null }
          : null
    );
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ callUi }) as never,
      pick: vi.fn(),
      projectRoot: () => '/projects/a',
      workspaceProjects: () => ({ current: null, projects: [] }),
      resolveWorkspaceProject: resolve,
      draft: () => ({}) as never,
    });
    const input = {
      pluginId: 'a.b',
      method: 'renderer.call',
      sessionId: null,
      payload: { method: 'read', args: {} },
      workspace: { projectId: 'b' },
    };
    expect(await h.call(event(), input)).toMatchObject({ ok: true });
    expect(callUi).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: null,
        projectRoot: '/projects/b',
        generation: undefined,
      })
    );
    expect(await h.call(event(), { ...input, workspace: null })).toMatchObject({ ok: true });
    expect(callUi).toHaveBeenLastCalledWith(expect.objectContaining({ projectRoot: null }));
    const count = callUi.mock.calls.length;
    for (const bad of [
      { ...input, sessionId: 'another-session' },
      { ...input, method: 'command.run' },
      { ...input, workspace: { projectId: 'b', path: '/secret' } },
      { ...input, workspace: { projectId: 'missing' } },
    ])
      expect(await h.call(event(), bad)).toMatchObject({ ok: false });
    expect(callUi).toHaveBeenCalledTimes(count);
  });
  it('类型配置与侧栏状态按 unknown 收窄，拒绝污染键和超大 UTF-8', () => {
    expect(parseConfigPatch({ name: 'demo', count: 2, enabled: false, token: null })).toEqual({
      name: 'demo',
      count: 2,
      enabled: false,
      token: null,
    });
    for (const raw of [{ number: Number.NaN }, { nested: {} }, JSON.parse('{"__proto__":"bad"}')])
      expect(parseConfigPatch(raw)).toBeNull();
    expect(parseViewStatePatch({ draft: 'text', deleted: null })).toEqual({
      draft: 'text',
      deleted: null,
    });
    expect(parseViewStatePatch({ x: '中'.repeat(400_000) })).toBeNull();
    expect(parseViewStatePatch(JSON.parse('{"__proto__":"bad"}'))).toBeNull();
  });
  it('市场安装与来源重装继续绑定发起窗口，不接受 renderer 指定路径', async () => {
    const stage = vi.fn(async () => ({ ok: true }));
    const restage = vi.fn(async () => ({ ok: true }));
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ stage, restage }) as never,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    await h.marketStage(event(), 'a.b', '2.0.0');
    expect(stage).toHaveBeenCalledWith(
      { kind: 'market', id: 'a.b', version: '2.0.0' },
      7,
      undefined
    );
    await h.restage(event(), 'a.b');
    expect(restage).toHaveBeenCalledWith('a.b', 7, undefined);
    expect(await h.restage(event(), '/etc/passwd')).toMatchObject({ ok: false });
  });
  it('stagePath 只接受主窗口拖入的真实插件目录或 ZIP，并由 Main 判定来源类型', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-drop-'));
    try {
      const folder = join(dir, 'plugin');
      const zip = join(dir, 'plugin.zip');
      const text = join(dir, 'notes.txt');
      await mkdir(folder);
      await writeFile(zip, 'zip');
      await writeFile(text, 'notes');
      const stage = vi.fn(async () => ({ ok: true }));
      const h = createExtensionPluginHandlers({
        trusted: () => true,
        service: () => ({ stage }) as never,
        pick: vi.fn(),
        projectRoot: () => null,
        draft: () => ({ respond: vi.fn() }) as never,
      });
      await h.stagePath(event(), folder);
      expect(stage).toHaveBeenLastCalledWith({ kind: 'dir', path: folder }, 7, undefined);
      await h.stagePath(event(), zip);
      expect(stage).toHaveBeenLastCalledWith({ kind: 'zip', path: zip }, 7, undefined);
      expect(await h.stagePath(event(), text)).toMatchObject({ ok: false });
      expect(await h.stagePath(event(), 'plugin.zip')).toMatchObject({ ok: false });
      expect(stage).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
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
  it('readme 跨 IPC 统一用 text 承载正文，不把 Main 内部字段名漏给渲染层', async () => {
    const readme = vi.fn(
      async (): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> => ({
        ok: true,
        markdown: '# Chat Board\n',
      })
    );
    const h = createExtensionPluginHandlers({
      trusted: () => true,
      service: () => ({ readme }) as never,
      pick: vi.fn(),
      projectRoot: () => null,
      draft: () => ({ respond: vi.fn() }) as never,
    });
    expect(await h.readme(event(), { id: 'enso.chatboard', from: 'market' })).toEqual({
      ok: true,
      text: '# Chat Board\n',
    });
    readme.mockResolvedValueOnce({ ok: false, error: '没有使用说明' });
    expect(await h.readme(event(), { id: 'enso.chatboard', from: 'installed' })).toEqual({
      ok: false,
      error: '没有使用说明',
    });
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
