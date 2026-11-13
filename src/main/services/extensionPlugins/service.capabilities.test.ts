import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const d = mkdtempSync(join(tmpdir(), 'enso-plugin-cap-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const s of services.splice(0)) s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(root = temp()) {
  const service = new ExtensionPluginService({
    root,
    hostVersion: '0.2.75',
    hostPath: '/host',
    env: {},
    fork: vi.fn(() => new Child()),
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
  return { service, root };
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
  const id = staged.preview.id;
  expect(await s.setEnabled(id, true)).toMatchObject({ ok: true });
  return id;
}

describe('事件计划', () => {
  it('没有订阅也没有注入权限时不下发计划', async () => {
    const { service } = setup();
    await install(service);
    expect(service.eventPlanForSpawn()).toBeNull();
  });

  it('汇总通知型与拦截型订阅，多个插件的工具并集', async () => {
    const { service } = setup();
    await install(service, {
      permissions: ['agent.tool', 'agent.observe', 'agent.intercept', 'agent.inject'],
      contributes: {
        agentTools: [
          { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } },
        ],
        events: [
          { event: 'session_start', mode: 'observe' },
          { event: 'tool_call', mode: 'intercept', tools: ['bash'] },
        ],
      },
    });
    expect(service.eventPlanForSpawn()).toEqual({
      observe: ['session_start'],
      intercept: [{ event: 'tool_call', tools: ['bash'] }],
      inject: true,
    });
  });

  it('宿主事件不进计划', async () => {
    const { service } = setup();
    await install(service, {
      permissions: ['agent.tool', 'agent.observe'],
      contributes: {
        agentTools: [
          { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } },
        ],
        events: [{ event: 'session_status', mode: 'observe' }],
      },
    });
    expect(service.eventPlanForSpawn()).toBeNull();
  });
});

describe('运行期动态贡献', () => {
  it('动态工具进入下发列表，注销后移除', async () => {
    const { service } = setup();
    const id = await install(service, {
      permissions: ['agent.tool'],
      contributes: {
        agentTools: [
          { name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } },
        ],
        dynamic: { tools: 2, commands: 1 },
      },
    });
    expect(() =>
      service.registerContrib(id, {
        kind: 'tool',
        name: 'count',
        description: 'Count',
        parameters: { type: 'object', properties: {} },
      })
    ).not.toThrow();
    expect(service.toolsForSpawn().map((t) => t.name)).toEqual([
      'plugin_enso-test__read',
      'plugin_enso-test__count',
    ]);
    service.unregisterContrib(id, { kind: 'tool', name: 'count' });
    expect(service.toolsForSpawn().map((t) => t.name)).toEqual(['plugin_enso-test__read']);
  });

  it('超出清单配额被拒绝', async () => {
    const { service } = setup();
    const id = await install(service);
    expect(() =>
      service.registerContrib(id, {
        kind: 'tool',
        name: 'count',
        description: 'Count',
        parameters: { type: 'object', properties: {} },
      })
    ).toThrow(/上限|配额/);
  });
});

describe('产出与日志', () => {
  it('写入产出后可列出、取回路径并删除', async () => {
    const { service } = setup();
    const id = await install(service);
    const info = await service.writeArtifact(id, { name: 'report.md', text: '# hi' });
    expect(info).toMatchObject({
      pluginId: id,
      name: 'report.md',
      mime: 'text/plain; charset=utf-8',
    });
    expect(service.listArtifacts(id)).toEqual([info]);
    expect(service.artifactInfo(info.id)).toEqual(info);
    expect(service.artifactPath(info.id)).toEqual(expect.stringContaining(info.id));
    expect(service.deleteArtifact(info.id)).toBe(true);
    expect(service.listArtifacts(id)).toEqual([]);
  });

  it('日志按插件落盘，读取返回尾部', async () => {
    const { service } = setup();
    const id = await install(service);
    service.appendLog(id, 'warn', '慢查询');
    await expect(service.logs(id)).resolves.toContain('[warn] 慢查询');
  });
});

describe('侧栏页面状态', () => {
  it('按插件读写并与日志一起在卸载时清除', async () => {
    const { service } = setup();
    const id = await install(service);
    expect(service.viewStateGet(id)).toEqual({});
    expect(service.viewStateSet(id, { filter: 'open' })).toEqual({ ok: true });
    expect(service.viewStateGet(id)).toEqual({ filter: 'open' });
    expect(service.viewStateSet(id, { filter: null })).toEqual({ ok: true });
    expect(service.viewStateGet(id)).toEqual({});
  });
});
