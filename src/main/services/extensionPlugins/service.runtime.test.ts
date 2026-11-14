import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPluginHost } from '../../../pluginHost/host';
import type { PluginMarket } from './market';
import { ExtensionPluginService, type ExtensionPluginServiceOptions } from './service';

class Child extends EventEmitter {
  private handler: (message: unknown) => void = () => {};
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
  postMessage(message: unknown) {
    queueMicrotask(() => this.handler(message));
  }
  kill() {
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}
const dirs: string[] = [];
const services: ExtensionPluginService[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-runtime-'));
  dirs.push(dir);
  return dir;
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(extra: Partial<ExtensionPluginServiceOptions> = {}) {
  const fork = vi.fn(() => new Child());
  const root = temp();
  const service = new ExtensionPluginService({
    root,
    hostVersion: '0.2.75',
    hostPath: '/host',
    env: {},
    fork,
    gate: {
      fetch: vi.fn(),
      notify: () => true,
      composer: async () => null,
      mcpTools: async () => [],
      mcpCall: async () => ({ content: '', isError: false }),
      now: Date.now,
    },
    ...extra,
  });
  services.push(service);
  return { service, root, fork };
}
function source(patch: Record<string, unknown>, code: string) {
  const path = temp();
  writeFileSync(
    join(path, 'enso-plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'enso.runtime',
      name: 'Runtime',
      version: '1',
      main: 'main.mjs',
      permissions: [],
      contributes: {},
      ...patch,
    })
  );
  writeFileSync(join(path, 'main.mjs'), code);
  return { kind: 'dir' as const, path };
}
async function install(
  service: ExtensionPluginService,
  patch: Record<string, unknown>,
  code: string
) {
  const src = source(patch, code);
  const staged = await service.stage(src, 7);
  if (!staged.ok) throw new Error(staged.error);
  expect(await service.commit(staged.preview.token, 7)).toEqual({ ok: true, enabled: true });
  expect(await service.setEnabled(staged.preview.id, true)).toEqual({ ok: true });
  return src;
}
const tool = (service: ExtensionPluginService, onProgress?: (text: string) => void) =>
  service.callTool({
    toolName: 'plugin_enso-runtime__read',
    fingerprint: service.toolsForSpawn()[0]?.fingerprint ?? '',
    args: {},
    sessionId: 's',
    projectRoot: null,
    onProgress,
  });
describe('complete plugin runtime', () => {
  it('界面方法支持1MB内参数和返回值，拒绝超限', async () => {
    const { service } = setup();
    await install(
      service,
      { permissions: ['ui.view'] },
      `export function activate(e) { e.renderer.handle('echo', args => args.text); }`
    );
    const input = {
      pluginId: 'enso.runtime',
      method: 'renderer.call' as const,
      payload: { method: 'echo', args: { text: 'x'.repeat(128 * 1024) } },
      sessionId: null,
      projectRoot: null,
    };
    expect(await service.callUi(input)).toHaveLength(128 * 1024);
    await expect(
      service.callUi({
        ...input,
        payload: { method: 'echo', args: { text: 'x'.repeat(1024 * 1024) } },
      })
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
  it('failClosed拦截熔断期间仍拒绝，不得把检查器失效变成放行', async () => {
    const { service } = setup();
    await install(
      service,
      {
        permissions: ['agent.intercept'],
        contributes: { events: [{ event: 'tool_call', mode: 'intercept', failClosed: true }] },
      },
      `export function activate(e) { e.events.on('tool_call', () => { throw new Error('unavailable'); }); }`
    );
    for (let i = 0; i < 4; i++) {
      const result = await service.intercept({
        event: 'tool_call',
        sessionId: 's',
        projectRoot: null,
        payload: { toolCallId: 't', toolName: 'bash', input: {} },
      });
      expect(result).toMatchObject({ block: true });
    }
  });
  it('UI命令把原始会话代际传到文件/MCP授权门', async () => {
    const policy = vi.fn(async () => ({ allowWrite: false, allowMcpCall: false }));
    const { service } = setup({
      gate: {
        fetch: vi.fn(),
        notify: () => true,
        composer: async () => null,
        mcpTools: async () => [],
        mcpCall: async () => ({ content: '', isError: false }),
        now: Date.now,
        invocationPolicy: policy,
      },
    });
    await install(
      service,
      {
        permissions: ['fs.write'],
        fs: { write: ['.'] },
        contributes: { commands: [{ id: 'write', title: 'Write' }] },
      },
      `export function activate(e) { e.commands.register('write', () => e.fs.writeText('x.txt', 'x')); }`
    );
    await expect(
      service.callUi({
        pluginId: 'enso.runtime',
        method: 'command.run',
        payload: { id: 'write' },
        sessionId: 's',
        projectRoot: temp(),
        generation: 'original',
      })
    ).rejects.toThrow();
    expect(policy).toHaveBeenCalledWith(expect.objectContaining({ sessionGeneration: 'original' }));
  });
  it('侧栏外链资源只能读取声明页面目录内允许的静态类型', async () => {
    const { service } = setup();
    const src = source(
      {
        permissions: ['ui.view'],
        contributes: { views: [{ id: 'view', title: 'View', entry: 'ui/view.html' }] },
      },
      'export function activate() {}'
    );
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(src.path, 'ui'));
    for (const name of ['view.html', 'app.js', 'style.css', 'logo.svg', 'secret.txt'])
      writeFileSync(join(src.path, 'ui', name), name);
    const staged = await service.stage(src, 7);
    if (!staged.ok) throw new Error(staged.error);
    await service.commit(staged.preview.token, 7);
    await service.setEnabled('enso.runtime', true);
    for (const name of ['app.js', 'style.css', 'logo.svg'])
      expect(service.assetPath('enso.runtime', `ui/${name}`)).not.toBeNull();
    expect(service.assetPath('enso.runtime', 'ui/secret.txt')).toBeNull();
    expect(service.assetPath('enso.runtime', 'main.mjs')).toBeNull();
  });
  it('counts plugin cold-start time against the intercept budget and cancels late work', async () => {
    const children: EventEmitter[] = [];
    const { service } = setup({
      fork: () => {
        const c = Object.assign(new EventEmitter(), {
          postMessage() {},
          kill() {
            queueMicrotask(() => c.emit('exit'));
            return true;
          },
        });
        children.push(c);
        return c;
      },
    });
    await install(
      service,
      {
        permissions: ['agent.intercept'],
        contributes: { events: [{ event: 'tool_call', mode: 'intercept', failClosed: true }] },
      },
      'export function activate() {}'
    );
    vi.useFakeTimers();
    const result = service.intercept({
      event: 'tool_call',
      sessionId: 's',
      projectRoot: null,
      payload: { toolCallId: 't', toolName: 'bash', input: {} },
      deadlineMs: 30,
    });
    await vi.advanceTimersByTimeAsync(31);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(await result).toMatchObject({ block: true });
    expect(children).toHaveLength(1);
  });
  it('does not replace an updating process until its real exit and rejects old generation host calls', async () => {
    const children: (EventEmitter & { postMessage(message: unknown): void; kill(): boolean })[] =
      [];
    const hostCalls = vi.fn();
    const { service } = setup({
      fork: () => {
        const child = Object.assign(new EventEmitter(), {
          postMessage(message: unknown) {
            const m = message as { t: string; id: string };
            if (m.t === 'init')
              queueMicrotask(() =>
                child.emit('message', {
                  t: 'ready',
                  registered: { tools: ['read'], commands: [], triggers: [], rendererMethods: [] },
                })
              );
            if (m.t === 'call')
              queueMicrotask(() =>
                child.emit('message', { t: 'res', id: m.id, ok: true, value: { content: 'ok' } })
              );
            if (m.t === 'res') hostCalls(message);
          },
          kill() {
            return true;
          },
        });
        children.push(child);
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    });
    const patch = {
      permissions: ['agent.tool'],
      contributes: {
        agentTools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
      },
    };
    await install(service, patch, 'export function activate() {}');
    await tool(service);
    const preview = await service.stage(
      source({ ...patch, version: '2' }, 'export function activate() {}'),
      7
    );
    if (!preview.ok) throw new Error(preview.error);
    let updated = false;
    const pending = service.commit(preview.preview.token, 7).then(() => {
      updated = true;
    });
    await flush();
    expect(updated).toBe(false);
    expect(children).toHaveLength(1);
    children[0].emit('message', { t: 'call', id: 'old', api: 'host.capabilities', args: {} });
    await flush();
    expect(hostCalls).not.toHaveBeenCalled();
    children[0].emit('exit', 0);
    await pending;
    await tool(service);
    expect(children).toHaveLength(2);
    const dispose = service.dispose();
    children[1].emit('exit', 0);
    await dispose;
  });
  it('connects injection permission, host status updates, exports and remote gestures', async () => {
    const inject = vi.fn(() => ({ ok: true as const }));
    const { service } = setup({ sessionBridge: () => ({ inject, abort: () => ({ ok: true }) }) });
    await install(
      service,
      {
        permissions: ['agent.tool', 'agent.inject', 'ui.slot'],
        contributes: {
          agentTools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
          statusItems: [{ id: 'counter', text: 'initial' }],
        },
      },
      `export function activate(e) { e.tools.register('read', async () => { await e.session.inject({ sessionId: 'other', text: 'hello' }); await e.ui.status.update('counter', { text: 'done' }); return 'ok'; }); }`
    );
    await expect(tool(service)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(service.setCrossSessionInject('enso.runtime', true)).toEqual({ ok: true });
    expect((await tool(service)).content).toBe('ok');
    expect(inject).toHaveBeenCalledWith(
      'other',
      expect.objectContaining({ pluginId: 'enso.runtime', text: 'hello' })
    );
    expect(service.list().plugins[0].statusItems).toEqual([
      expect.objectContaining({ id: 'counter', text: 'done' }),
    ]);
  });
  it('returns full preset overrides without losing fork path validation', async () => {
    const { service } = setup();
    const src = source(
      {
        contributes: {
          presets: [
            {
              id: 'role',
              name: 'Role',
              systemPromptTail: 'tail.md',
              boostPrompt: 'boost.md',
              refusalRetry: true,
              refusalRetryPrompt: 'retry.md',
              model: { providerId: 'p', modelId: 'm' },
              thinkingLevel: 'high',
              approvalMode: 'auto-edits',
              disabledTools: ['bash'],
            },
          ],
        },
      },
      'export function activate() {}'
    );
    for (const name of ['tail', 'boost', 'retry'])
      writeFileSync(join(src.path, `${name}.md`), name);
    const staged = await service.stage(src, 7);
    if (!staged.ok) throw new Error(staged.error);
    await service.commit(staged.preview.token, 7);
    await service.setEnabled('enso.runtime', true);
    expect(service.presetForSpawn('plugin:enso.runtime:role')).toMatchObject({
      ok: true,
      systemPromptAppend: 'tail',
      systemPromptBoost: 'boost',
      refusalRetryPrompt: 'retry',
      model: { providerId: 'p', modelId: 'm' },
      thinkingLevel: 'high',
      disabledTools: ['bash'],
    });
  });
  it('automatically updates market sources, leaves expansions pending, and never executes previews', async () => {
    let version = '1';
    let expands = false;
    const market = {
      marketId: 'collabra',
      index: vi.fn(async () => ({
        ok: true,
        stale: false,
        index: { plugins: [{ id: 'enso.runtime', latest: version }] },
      })),
      download: vi.fn(async (_id: string, _version: string | undefined, dest: string) => {
        const manifest = {
          schemaVersion: 1,
          id: 'enso.runtime',
          name: 'Runtime',
          version,
          main: 'main.mjs',
          permissions: expands ? ['ui.notify'] : [],
        };
        writeFileSync(
          dest,
          zip({
            'enso-plugin.json': JSON.stringify(manifest),
            'main.mjs': 'export function activate() {}',
          })
        );
        return { ok: true as const, version };
      }),
    } as unknown as PluginMarket;
    const { service, fork } = setup({ market });
    const notices = vi.fn();
    service.onNotice(notices);
    const preview = await service.stage({ kind: 'market', id: 'enso.runtime' }, 7);
    if (!preview.ok) throw new Error(preview.error);
    await service.commit(preview.preview.token, 7);
    await service.setEnabled('enso.runtime', true);
    version = '2';
    expect(await service.checkUpdates()).toEqual({ checked: 1, available: 0, failed: 0 });
    expect(service.list().plugins[0].version).toBe('2');
    expect(notices).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'auto-updated', version: '2' })
    );
    version = '3';
    expands = true;
    expect(await service.checkUpdates()).toEqual({ checked: 1, available: 1, failed: 0 });
    expect(service.list().plugins[0]).toMatchObject({ version: '2', pendingVersion: '3' });
    expect(fork).not.toHaveBeenCalled();
  });
  it('prepares dynamic tools, forwards progress and resolves only owned artifacts', async () => {
    const { service } = setup();
    await install(
      service,
      { permissions: ['agent.tool'], contributes: { dynamic: { tools: 1 } } },
      `export function activate(e) { e.tools.register('read', async (_args, ctx) => { await ctx.progress('working'); const a = await e.artifacts.write({ name: 'report.txt', text: 'ok' }); return { content: 'ok', artifacts: [a.id, 'unknown'] }; }, { description: 'Read', parameters: { type: 'object', properties: {} } }); }`
    );
    await service.prepareForSpawn();
    expect(service.toolsForSpawn()).toHaveLength(1);
    const progress = vi.fn();
    const result = await tool(service, progress);
    expect(progress).toHaveBeenCalledWith('working');
    expect(result.artifacts).toEqual([
      expect.objectContaining({ pluginId: 'enso.runtime', name: 'report.txt' }),
    ]);
  });
  it('dispatches ordered observe events only to running plugins', async () => {
    const { service, fork } = setup();
    await install(
      service,
      {
        permissions: ['agent.tool', 'agent.observe'],
        contributes: {
          agentTools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
          events: [{ event: 'session_status', mode: 'observe' }],
        },
      },
      `let count=0; export function activate(e) { e.events.on('session_status', () => { count++; }); e.tools.register('read', () => String(count)); }`
    );
    await service.dispatchEvent({
      event: 'session_status',
      sessionId: 's',
      projectRoot: null,
      data: {},
    });
    expect(fork).not.toHaveBeenCalled();
    expect((await tool(service)).content).toBe('0');
    await service.dispatchEvent({
      event: 'session_status',
      sessionId: 's',
      projectRoot: null,
      data: {},
    });
    await flush();
    expect((await tool(service)).content).toBe('1');
  });
  it('merges before-agent-start append and honors failClosed/child exclusions', async () => {
    const { service } = setup();
    await install(
      service,
      {
        permissions: ['agent.intercept'],
        contributes: {
          events: [
            { event: 'before_agent_start', mode: 'intercept' },
            { event: 'tool_call', mode: 'intercept', failClosed: true },
          ],
        },
      },
      `export function activate(e) { e.events.on('before_agent_start', () => ({ append: 'extra rules' })); e.events.on('tool_call', () => { throw new Error('broken'); }); }`
    );
    expect(
      await service.intercept({
        event: 'before_agent_start',
        sessionId: 's',
        projectRoot: null,
        payload: { prompt: 'hello', kind: 'user' },
      })
    ).toEqual({ append: 'extra rules' });
    expect(
      await service.intercept({
        event: 'before_agent_start',
        sessionId: 's',
        projectRoot: null,
        agent: { kind: 'subagent', sessionId: 's::a', name: 'a' },
        payload: { prompt: 'hello', kind: 'user' },
      })
    ).toEqual({});
    const input = {
      event: 'tool_call' as const,
      sessionId: 's',
      projectRoot: null,
      payload: { toolCallId: 't', toolName: 'bash', input: {} },
    };
    for (let i = 0; i < 3; i++)
      expect(await service.intercept(input)).toMatchObject({ block: true });
    expect(await service.intercept(input)).toMatchObject({ block: true });
    expect(service.list().plugins[0].interceptBreakers).toHaveLength(1);
  });
  it('records source, keeps restage owner-bound and hot reload refuses grant expansion', async () => {
    const { service, root } = setup();
    const src = await install(service, {}, 'export function activate() {}');
    expect(service.list().plugins[0].source).toEqual({ kind: 'dir' });
    const raw = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
    expect(raw.plugins[0].source).toEqual(src);
    const staged = await service.restage('enso.runtime', 12);
    if (!staged.ok) throw new Error(staged.error);
    expect(await service.commit(staged.preview.token, 11)).toMatchObject({ ok: false });
    service.discard(staged.preview.token, 12);
    writeFileSync(
      join(src.path, 'enso-plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'enso.runtime',
        name: 'Runtime',
        version: '2',
        permissions: ['fs.write'],
        fs: { write: ['.'] },
      })
    );
    await service.devReloadNow('enso.runtime');
    expect(service.list().plugins[0]).toMatchObject({
      version: '1',
      lastError: { message: expect.stringContaining('授权扩大') },
    });
  });
  it('watches directory changes and schedules only after background starts', async () => {
    let change: (() => void) | undefined;
    const close = vi.fn();
    const { service } = setup({
      devWatch: (_dir, cb) => {
        change = cb;
        return { close };
      },
      devReloadDelayMs: 1,
    });
    const src = await install(
      service,
      {
        permissions: ['agent.tool', 'process.background'],
        contributes: {
          agentTools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
          schedules: [{ id: 'tick', intervalSeconds: 60 }],
        },
      },
      `let n=0; export function activate(e) { e.schedules.register('tick', () => { n++; }); e.tools.register('read', () => String(n)); }`
    );
    expect(service.setDevWatch('enso.runtime', true)).toEqual({ ok: true });
    expect(change).toBeTypeOf('function');
    expect((await tool(service)).content).toBe('0');
    vi.useFakeTimers();
    service.startBackground();
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await tool(service)).content).toBe('1');
    vi.useRealTimers();
    const raw = JSON.parse(readFileSync(join(src.path, 'enso-plugin.json'), 'utf8'));
    raw.version = '2';
    writeFileSync(join(src.path, 'enso-plugin.json'), JSON.stringify(raw));
    change?.();
    await vi.waitFor(() => expect(service.list().plugins[0].version).toBe('2'));
    expect(service.setDevWatch('enso.runtime', false)).toEqual({ ok: true });
    expect(close).toHaveBeenCalled();
  });
});

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name),
      data = Buffer.from(text),
      l = Buffer.alloc(30),
      c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(Buffer.concat([l, n, data]));
    central.push(Buffer.concat([c, n]));
    offset += l.length + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
