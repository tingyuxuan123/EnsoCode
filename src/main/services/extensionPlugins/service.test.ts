import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPluginHost } from '../../../pluginHost/host';
import { ExtensionPluginService } from './service';

class Child extends EventEmitter {
  private handler: (m: unknown) => void = () => {};
  constructor() {
    super();
    runPluginHost({
      send: (m) => queueMicrotask(() => this.emit('message', m)),
      onMessage: (h) => {
        this.handler = h;
      },
    });
    queueMicrotask(() => this.emit('spawn'));
  }
  postMessage(m: unknown) {
    queueMicrotask(() => this.handler(m));
  }
  kill() {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}
const dirs: string[] = [];
const services: ExtensionPluginService[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'enso-plugin-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup(root = temp()) {
  const fork = vi.fn(() => new Child());
  const service = new ExtensionPluginService({
    root,
    hostVersion: '0.2.37',
    hostPath: '/host',
    env: {},
    fork,
    gate: {
      fetch: vi.fn(),
      notify: () => true,
      composer: async () => null,
      sessionMessages: async () => [],
      mcpTools: async () => [],
      mcpCall: async () => ({ content: '', isError: false }),
      invocationPolicy: async () => ({ allowWrite: true, allowMcpCall: true }),
      now: Date.now,
    },
  });
  services.push(service);
  return { service, root, fork };
}
function source(patch: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const dir = temp();
  const manifest = {
    schemaVersion: 1,
    id: 'enso.test',
    name: 'Test',
    version: '1',
    main: 'main.mjs',
    permissions: ['agent.tool'],
    contributes: {
      agentTools: [
        { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } },
      ],
    },
    ...patch,
  };
  for (const [path, content] of Object.entries({
    'enso-plugin.json': JSON.stringify(manifest),
    'main.mjs': `export function activate(e) { e.tools.register('read', () => 'ok'); }`,
    ...files,
  })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return { kind: 'dir' as const, path: dir };
}
/** 只在服务私有目录里定位暂存副本，用来构造真实的“安装后清单读不出来”故障 */
function findStagedFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findStagedFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}
async function install(s: ExtensionPluginService, patch = {}, files = {}, owner = 1) {
  const staged = await s.stage(source(patch, files), owner);
  if (!staged.ok) throw new Error(staged.error);
  expect((await s.commit(staged.preview.token, owner)).ok).toBe(true);
  return staged.preview;
}
const toolCall = (
  s: ExtensionPluginService,
  fingerprint = s.toolsForSpawn()[0]?.fingerprint ?? ''
) =>
  s.callTool({
    toolName: 'plugin_enso-test__read',
    fingerprint,
    args: {},
    sessionId: 's',
    projectRoot: null,
  });
describe('desktop plugin service', () => {
  it('损坏登记表拒绝全部写操作，不覆盖原件', async () => {
    const root = temp();
    writeFileSync(join(root, 'registry.json'), '{bad');
    const { service: s } = setup(root);
    expect(s.list()).toMatchObject({ plugins: [], registryError: expect.stringContaining('只读') });
    for (const result of [
      await s.stage(source(), 1),
      await s.commit('token', 1),
      await s.setEnabled('enso.test', true),
      await s.approvePending('enso.test'),
      await s.rejectPending('enso.test'),
      await s.uninstall('enso.test'),
      s.setConfig('enso.test', {}),
    ])
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('只读') });
    expect(readFileSync(join(root, 'registry.json'), 'utf8')).toBe('{bad');
  });
  it('含一条坏记录也只读，启用或安装不能丢失原始记录', async () => {
    const root = temp();
    const raw = JSON.stringify({ version: 1, plugins: [{ id: 'bad' }] });
    writeFileSync(join(root, 'registry.json'), raw);
    const { service: s } = setup(root);
    expect((await s.setEnabled('enso.test', true)).ok).toBe(false);
    expect((await s.stage(source(), 1)).ok).toBe(false);
    expect(s.list()).toMatchObject({ plugins: [], registryError: expect.any(String) });
    expect(readFileSync(join(root, 'registry.json'), 'utf8')).toBe(raw);
  });
  it('一次加载失败的多个等待调用只计一次崩溃', async () => {
    const { service: s, fork } = setup();
    await install(s, {}, { 'main.mjs': 'throw new Error("load failed")' });
    await s.setEnabled('enso.test', true);
    await Promise.allSettled([toolCall(s), toolCall(s), toolCall(s)]);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(s.list().plugins[0].state).toBe('enabled');
    await Promise.allSettled([toolCall(s), toolCall(s)]);
    expect(s.list().plugins[0].state).toBe('enabled');
    await Promise.allSettled([toolCall(s), toolCall(s)]);
    expect(fork).toHaveBeenCalledTimes(3);
    expect(s.list().plugins[0].state).toBe('crashed');
  });
  it('草稿权限必须显式声明真实手势，自动 renderer 调用不得获得', async () => {
    const { service: s } = setup();
    await install(
      s,
      { permissions: ['agent.tool', 'ui.slot', 'composer.draft'] },
      {
        'main.mjs': `export function activate(e) { e.renderer.handle('draft', () => e.composer.readDraft()); }`,
      }
    );
    await s.setEnabled('enso.test', true);
    const input = {
      pluginId: 'enso.test',
      method: 'renderer.call' as const,
      payload: { method: 'draft' },
      sessionId: 's',
      projectRoot: null,
    };
    await expect(s.callUi(input)).rejects.toMatchObject({ code: 'GESTURE_REQUIRED' });
    await expect(s.callUi({ ...input, gesture: false })).rejects.toMatchObject({
      code: 'GESTURE_REQUIRED',
    });
    await expect(s.callUi({ ...input, gesture: true })).resolves.toBeNull();
  });
  it('首次确认安装默认启用，安装阶段不执行插件代码', async () => {
    const { service: s, fork, root } = setup();
    const staged = await s.stage(source(), 7);
    if (!staged.ok) throw new Error(staged.error);
    expect(await s.commit(staged.preview.token, 7)).toEqual({ ok: true, enabled: true });
    // 启用只登记状态，插件代码要到第一次真实调用才执行
    expect(fork).not.toHaveBeenCalled();
    expect(s.list().plugins[0]).toMatchObject({ state: 'enabled' });
    expect(s.toolsForSpawn().map((tool) => tool.name)).toEqual(['plugin_enso-test__read']);
    expect(await toolCall(s)).toEqual({ content: 'ok', artifacts: [] });
    const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
    expect(registry.plugins[0].state).toBe('enabled');
  });
  it('首次安装的常驻插件随提交进入后台启动', async () => {
    const { service: s, fork } = setup();
    s.startBackground();
    const staged = await s.stage(
      source({ resident: true, permissions: ['agent.tool', 'process.background'] }),
      7
    );
    if (!staged.ok) throw new Error(staged.error);
    expect(await s.commit(staged.preview.token, 7)).toEqual({ ok: true, enabled: true });
    await vi.waitFor(() => expect(fork).toHaveBeenCalledTimes(1));
    expect(s.list().plugins[0]).toMatchObject({ state: 'enabled', resident: true });
  });
  it('取消预览、错误窗口和一次性 token 都不会启用插件', async () => {
    const { service: s } = setup();
    const cancelled = await s.stage(source(), 7);
    if (!cancelled.ok) throw new Error(cancelled.error);
    expect(s.discard(cancelled.preview.token, 7)).toBe(true);
    expect(await s.commit(cancelled.preview.token, 7)).toMatchObject({ ok: false });
    const foreign = await s.stage(source(), 7);
    if (!foreign.ok) throw new Error(foreign.error);
    expect(await s.commit(foreign.preview.token, 8)).toMatchObject({ ok: false });
    expect(s.list().plugins).toEqual([]);
    expect(s.toolsForSpawn()).toEqual([]);
    const once = await s.stage(source(), 7);
    if (!once.ok) throw new Error(once.error);
    expect(await s.commit(once.preview.token, 7)).toEqual({ ok: true, enabled: true });
    const snapshot = s.list().plugins[0];
    expect(await s.commit(once.preview.token, 7)).toMatchObject({ ok: false });
    expect(s.list().plugins[0]).toEqual(snapshot);
  });
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '首次安装后清单读不出来时如实返回部分成功，登记表保持停用且不重装',
    async () => {
      const { service: s, fork, root } = setup();
      const staged = await s.stage(source(), 7);
      if (!staged.ok) throw new Error(staged.error);
      // 暂存副本的清单不可读：commitStaged 只 rename，安装目录里同样读不出来
      const manifest = findStagedFile(root, 'enso-plugin.json');
      if (!manifest) throw new Error('staging copy not found');
      chmodSync(manifest, 0o000);
      expect(await s.commit(staged.preview.token, 7)).toEqual({
        ok: true,
        enabled: false,
        warning: expect.stringContaining('清单'),
      });
      expect(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).plugins[0].state).toBe(
        'disabled'
      );
      // 清单不可读时不假报启用：列表不含该插件，也不提供工具或拉起进程
      expect(s.list().plugins).toEqual([]);
      expect(s.toolsForSpawn()).toEqual([]);
      expect(fork).not.toHaveBeenCalled();
      // 一次性 token 不会因此重装一次
      expect(await s.commit(staged.preview.token, 7)).toMatchObject({ ok: false });
      expect(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).plugins).toHaveLength(1);
    }
  );
  it('已安装插件的重装与更新保持原启用意图，扩权仍待批准', async () => {
    const { service: s } = setup();
    const first = await s.stage(source(), 1);
    if (!first.ok) throw new Error(first.error);
    expect(await s.commit(first.preview.token, 1)).toEqual({ ok: true, enabled: true });
    expect(await s.setEnabled('enso.test', false)).toEqual({ ok: true });
    // 同权限重装：原来停用就继续停用
    const again = await s.stage(source({ version: '2' }), 1);
    if (!again.ok) throw new Error(again.error);
    expect(await s.commit(again.preview.token, 1)).toEqual({ ok: true });
    expect(s.list().plugins[0]).toMatchObject({ version: '2', state: 'disabled' });
    expect(s.toolsForSpawn()).toEqual([]);
    // 已启用时同权限重装：保持启用
    expect(await s.setEnabled('enso.test', true)).toEqual({ ok: true });
    const third = await s.stage(source({ version: '3' }), 1);
    if (!third.ok) throw new Error(third.error);
    expect(await s.commit(third.preview.token, 1)).toEqual({ ok: true });
    expect(s.list().plugins[0]).toMatchObject({ version: '3', state: 'enabled' });
    // 授权扩大仍然进入待批准，不因默认启用绕过
    const grown = await s.stage(
      source({ version: '4', permissions: ['agent.tool', 'agent.inject'] }),
      1
    );
    if (!grown.ok) throw new Error(grown.error);
    expect(await s.commit(grown.preview.token, 1)).toEqual({ ok: true });
    expect(s.list().plugins[0]).toMatchObject({
      version: '3',
      state: 'enabled',
      pendingVersion: '4',
      pendingPermissions: expect.arrayContaining(['agent.inject']),
    });
    expect(await s.approvePending('enso.test')).toEqual({ ok: true });
    expect(s.list().plugins[0]).toMatchObject({ version: '4', state: 'enabled' });
  });
  it('浏览器域名白名单进入预览与授权范围，加域名要重新批准', async () => {
    const { service: s } = setup();
    const staged = await s.stage(
      source({
        permissions: ['agent.tool', 'browser.control'],
        browser: { domains: ['example.com'] },
      }),
      1
    );
    if (!staged.ok) throw new Error(staged.error);
    expect(staged.preview).toMatchObject({
      permissions: expect.arrayContaining(['browser.control']),
      browserDomains: ['example.com'],
      expands: true,
    });
    expect(await s.commit(staged.preview.token, 1)).toEqual({ ok: true, enabled: true });
    expect(s.list().plugins[0]).toMatchObject({ version: '1', state: 'enabled' });

    const wider = await s.stage(
      source({
        version: '2',
        permissions: ['agent.tool', 'browser.control'],
        browser: { domains: ['example.com', 'docs.example.org'] },
      }),
      1
    );
    if (!wider.ok) throw new Error(wider.error);
    expect(wider.preview).toMatchObject({
      browserDomains: ['example.com', 'docs.example.org'],
      expands: true,
    });
    expect(await s.commit(wider.preview.token, 1)).toEqual({ ok: true });
    expect(s.list().plugins[0]).toMatchObject({
      version: '1',
      state: 'enabled',
      pendingVersion: '2',
    });
  });
  it('binds one-use installation tokens to exact initiating window', async () => {
    const { service: s } = setup();
    const staged = await s.stage(source(), 7);
    if (!staged.ok) throw new Error(staged.error);
    expect((await s.commit(staged.preview.token, 8)).ok).toBe(false);
    expect(s.discard(staged.preview.token, 8)).toBe(false);
    expect((await s.commit(staged.preview.token, 7)).ok).toBe(true);
    expect((await s.commit(staged.preview.token, 7)).ok).toBe(false);
  });
  it('enabled tools roundtrip and version fingerprint rejects stale worker references', async () => {
    const { service: s } = setup();
    await install(s);
    await s.setEnabled('enso.test', true);
    const old = s.toolsForSpawn()[0].fingerprint;
    expect(await toolCall(s)).toEqual({ content: 'ok', artifacts: [] });
    await install(s, { version: '2' });
    expect(s.toolsForSpawn()[0].fingerprint).not.toBe(old);
    await expect(toolCall(s, old)).rejects.toMatchObject({ code: 'STALE_PLUGIN' });
    expect(await toolCall(s)).toEqual({ content: 'ok', artifacts: [] });
  });
  it('permission expansion retains running old version until approval, never activates pending', async () => {
    const { service: s, fork } = setup();
    await install(s);
    await s.setEnabled('enso.test', true);
    await toolCall(s);
    const count = fork.mock.calls.length;
    await install(s, {
      version: '2',
      permissions: ['agent.tool', 'fs.write'],
      fs: { write: ['.'] },
    });
    expect(fork).toHaveBeenCalledTimes(count);
    expect(s.list().plugins[0]).toMatchObject({
      version: '1',
      pendingVersion: '2',
      state: 'enabled',
    });
    expect(await toolCall(s)).toEqual({ content: 'ok', artifacts: [] });
    await s.approvePending('enso.test');
    expect(s.list().plugins[0].version).toBe('2');
  });
  it('secret config stays private, non-secret is editable and uninstall clears owned data', async () => {
    const { service: s, root } = setup();
    await install(s, {
      contributes: {
        configuration: [
          { key: 'token', title: 'Token', secret: true },
          { key: 'url', title: 'URL' },
        ],
      },
    });
    expect(s.setConfig('enso.test', { token: 'fake-secret', url: 'https://example.com' }).ok).toBe(
      true
    );
    const view = s.configView('enso.test');
    expect(JSON.stringify(view)).not.toContain('fake-secret');
    expect(view).toMatchObject({
      fields: [
        { key: 'token', set: true },
        { key: 'url', value: 'https://example.com' },
      ],
    });
    const configPath = join(root, 'config/enso.test.json');
    const permissionMask = process.platform === 'win32' ? 0o600 : 0o777;
    expect(statSync(configPath).mode & permissionMask).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      token: 'fake-secret',
      url: 'https://example.com',
    });
    expect(s.setConfig('enso.test', { unknown: 'x' }).ok).toBe(false);
    await s.uninstall('enso.test');
    expect(existsSync(join(root, 'config/enso.test.json'))).toBe(false);
    expect(existsSync(join(root, 'packages/enso.test'))).toBe(false);
  });
  it('only declared renderer and views assets can be read', async () => {
    const { service: s } = setup();
    await install(
      s,
      { renderer: 'ui.js', permissions: ['agent.tool', 'ui.slot'] },
      { 'ui.js': 'export function onLoad() {}', 'secret.txt': 'private' }
    );
    await s.setEnabled('enso.test', true);
    expect(s.assetPath('enso.test', 'ui.js')).not.toBeNull();
    expect(s.assetPath('enso.test', 'secret.txt')).toBeNull();
    expect(s.assetPath('enso.test', '../config/enso.test.json')).toBeNull();
  });
  it('serves declared themes and only theme-directory image/font media, never sibling package content', async () => {
    const { service: s } = setup();
    await install(
      s,
      {
        contributes: {
          themes: [
            {
              id: 'night',
              name: 'Night',
              path: 'themes/night/theme.json',
              css: 'themes/night/style.css',
            },
          ],
        },
      },
      {
        'themes/night/theme.json': '{}',
        'themes/night/style.css': 'body{}',
        'themes/night/media/paper.png': 'image',
        'themes/night/media/font.woff2': 'font',
        'themes/night/secret.txt': 'secret',
        'outside/logo.png': 'outside',
      }
    );
    // 首次安装默认启用，主题资源随启用即可读
    expect(s.assetPath('enso.test', 'themes/night/theme.json')).not.toBeNull();
    expect(s.assetPath('enso.test', 'themes/night/style.css')).not.toBeNull();
    expect(s.assetMediaPath('enso.test', 'themes/night/media/paper.png')).not.toBeNull();
    expect(s.assetMediaPath('enso.test', 'themes/night/media/font.woff2')).not.toBeNull();
    expect(s.assetMediaPath('enso.test', 'outside/logo.png')).toBeNull();
    expect(s.assetMediaPath('enso.test', 'themes/night/secret.txt')).toBeNull();
    expect(s.assetMediaPath('enso.test', 'themes/night/../../outside/logo.png')).toBeNull();
    await s.setEnabled('enso.test', false);
    expect(s.assetPath('enso.test', 'themes/night/theme.json')).toBeNull();
    expect(s.assetMediaPath('enso.test', 'themes/night/media/paper.png')).toBeNull();
  });
  it('preset resources scoped correctly and unavailable selected presets fail closed', async () => {
    const { service: s } = setup();
    await install(
      s,
      {
        contributes: {
          skills: ['skills/a', 'skills/b'],
          presets: [
            {
              id: 'review',
              name: 'Review',
              skills: ['skills/b'],
              instruction: 'prompts/i.md',
              systemPrompt: 'prompts/r.md',
            },
          ],
        },
      },
      {
        'skills/a/SKILL.md': 'a',
        'skills/b/SKILL.md': 'b',
        'prompts/i.md': 'instruction',
        'prompts/r.md': 'role',
      }
    );
    await s.setEnabled('enso.test', true);
    expect(s.skillPathsForSpawn()).toHaveLength(1);
    expect(s.skillPathsForSpawn('plugin:enso.test:review')).toHaveLength(2);
    expect(s.presetForSpawn('plugin:enso.test:review')).toMatchObject({
      ok: true,
      instruction: { content: 'instruction' },
      systemPrompt: 'role',
    });
    await s.setEnabled('enso.test', false);
    expect(s.presetForSpawn('plugin:enso.test:review')).toMatchObject({ ok: false });
  });
  it('crash threshold disables tool registry', async () => {
    const { service: s } = setup();
    await install(s);
    await s.setEnabled('enso.test', true);
    for (let i = 0; i < 3; i++) s.recordCrash('enso.test');
    expect(s.list().plugins[0].state).toBe('crashed');
    expect(s.toolsForSpawn()).toEqual([]);
  });
});
