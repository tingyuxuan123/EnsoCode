import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
      s.setEnabled('enso.test', true),
      s.approvePending('enso.test'),
      s.rejectPending('enso.test'),
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
    expect(s.setEnabled('enso.test', true).ok).toBe(false);
    expect((await s.stage(source(), 1)).ok).toBe(false);
    expect(s.list()).toMatchObject({ plugins: [], registryError: expect.any(String) });
    expect(readFileSync(join(root, 'registry.json'), 'utf8')).toBe(raw);
  });
  it('一次加载失败的多个等待调用只计一次崩溃', async () => {
    const { service: s, fork } = setup();
    await install(s, {}, { 'main.mjs': 'throw new Error("load failed")' });
    s.setEnabled('enso.test', true);
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
    s.setEnabled('enso.test', true);
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
  it('stages and commits without running any plugin code; new install stays disabled', async () => {
    const { service: s, fork } = setup();
    await install(s, {}, { 'main.mjs': 'throw new Error("must not execute before enable")' });
    expect(fork).not.toHaveBeenCalled();
    expect(s.list().plugins[0]).toMatchObject({ state: 'disabled' });
    expect(s.toolsForSpawn()).toEqual([]);
    await expect(toolCall(s)).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
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
    s.setEnabled('enso.test', true);
    const old = s.toolsForSpawn()[0].fingerprint;
    expect(await toolCall(s)).toEqual({ content: 'ok' });
    await install(s, { version: '2' });
    expect(s.toolsForSpawn()[0].fingerprint).not.toBe(old);
    await expect(toolCall(s, old)).rejects.toMatchObject({ code: 'STALE_PLUGIN' });
    expect(await toolCall(s)).toEqual({ content: 'ok' });
  });
  it('permission expansion retains running old version until approval, never activates pending', async () => {
    const { service: s, fork } = setup();
    await install(s);
    s.setEnabled('enso.test', true);
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
    expect(await toolCall(s)).toEqual({ content: 'ok' });
    s.approvePending('enso.test');
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
    s.setEnabled('enso.test', true);
    expect(s.assetPath('enso.test', 'ui.js')).not.toBeNull();
    expect(s.assetPath('enso.test', 'secret.txt')).toBeNull();
    expect(s.assetPath('enso.test', '../config/enso.test.json')).toBeNull();
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
    s.setEnabled('enso.test', true);
    expect(s.skillPathsForSpawn()).toHaveLength(1);
    expect(s.skillPathsForSpawn('plugin:enso.test:review')).toHaveLength(2);
    expect(s.presetForSpawn('plugin:enso.test:review')).toMatchObject({
      ok: true,
      instruction: { content: 'instruction' },
      systemPrompt: 'role',
    });
    s.setEnabled('enso.test', false);
    expect(s.presetForSpawn('plugin:enso.test:review')).toMatchObject({ ok: false });
  });
  it('crash threshold disables tool registry', async () => {
    const { service: s } = setup();
    await install(s);
    s.setEnabled('enso.test', true);
    for (let i = 0; i < 3; i++) s.recordCrash('enso.test');
    expect(s.list().plugins[0].state).toBe('crashed');
    expect(s.toolsForSpawn()).toEqual([]);
  });
});
