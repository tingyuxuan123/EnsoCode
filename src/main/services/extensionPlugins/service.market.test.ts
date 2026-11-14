import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPluginHost } from '../../../pluginHost/host';
import { PLUGIN_STATES, type PluginRecord } from './lifecycle';
import type { PluginMarket as PluginMarketType } from './market';
import { type MarketFetch, PluginMarket } from './market';
import { readRegistry } from './registry';
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
  const dir = mkdtempSync(join(tmpdir(), 'plugin-market-service-'));
  dirs.push(dir);
  return dir;
};
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
const manifestOf = (id: string, version: string) => ({
  schemaVersion: 1,
  id,
  name: 'Notes',
  version,
  main: 'main.mjs',
  permissions: [],
  contributes: {},
});
const packageOf = (id: string, version: string) =>
  zip({
    'enso-plugin.json': JSON.stringify(manifestOf(id, version)),
    'main.mjs': 'export function activate() {}',
  });

function setup(options: Partial<ExtensionPluginServiceOptions> = {}, root = temp()) {
  const service = new ExtensionPluginService({
    root,
    hostVersion: '0.2.80',
    hostPath: '/host',
    env: {},
    fork: () => new Child(),
    gate: {
      fetch: vi.fn(),
      notify: () => true,
      composer: async () => null,
      mcpTools: async () => [],
      mcpCall: async () => ({ content: '', isError: false }),
      now: Date.now,
    },
    ...options,
  });
  services.push(service);
  return { service, root };
}

/** 一个只有目录清单与版本号的市场替身；marketId 是权威身份 */
function fakeMarket(
  over: {
    id?: string;
    latest?: string;
    marketId?: string;
    testedSurfaces?: string[];
    plugins?: { id: string; latest: string; testedSurfaces?: string[] }[];
  } = {}
) {
  const state = {
    id: over.id ?? 'collabra.notes',
    latest: over.latest ?? '1',
    testedSurfaces: over.testedSurfaces ?? [],
  };
  const plugins = over.plugins ?? [];
  const market = {
    marketId: over.marketId ?? 'collabra',
    chinaMirror: () => false,
    setChinaMirror: vi.fn(),
    readme: vi.fn(async () => ({ ok: false as const, error: '没有使用说明' })),
    index: vi.fn(async () => ({
      ok: true as const,
      stale: false,
      index: {
        marketId: over.marketId ?? 'collabra',
        plugins: [
          {
            id: state.id,
            name: 'Notes',
            description: '',
            tier: 'official',
            tags: [],
            latest: state.latest,
            versions: [
              {
                version: state.latest,
                permissions: [],
                path: `packages/${state.id}/${state.latest}.zip`,
                sha256: 'a'.repeat(64),
                size: 1,
                compatibility: {
                  host: 'collabra',
                  apiVersion: 1,
                  minAppVersion: '0.2.80',
                  platforms: ['darwin', 'win32', 'linux'],
                  testedSurfaces: state.testedSurfaces,
                },
              },
            ],
          },
          ...plugins.map((p) => ({
            id: p.id,
            name: p.id,
            description: '',
            tier: 'official',
            tags: [],
            latest: p.latest,
            versions: [
              {
                version: p.latest,
                permissions: [],
                path: `packages/${p.id}/${p.latest}.zip`,
                sha256: 'a'.repeat(64),
                size: 1,
                compatibility: {
                  host: 'collabra',
                  apiVersion: 1,
                  minAppVersion: '0.2.80',
                  platforms: ['darwin', 'win32', 'linux'],
                  testedSurfaces: p.testedSurfaces ?? [],
                },
              },
            ],
          })),
        ],
      },
    })),
    download: vi.fn(async (id: string, version: string | undefined, dest: string) => {
      const resolved = version ?? state.latest;
      writeFileSync(dest, packageOf(id, resolved));
      return { ok: true as const, version: resolved };
    }),
  };
  return { market: market as unknown as PluginMarketType, state, stub: market };
}

const dirSource = (id: string, version = '1') => {
  const path = temp();
  writeFileSync(join(path, 'enso-plugin.json'), JSON.stringify(manifestOf(id, version)));
  writeFileSync(join(path, 'main.mjs'), 'export function activate() {}');
  return { kind: 'dir' as const, path };
};

async function installDir(service: ExtensionPluginService, id: string, version = '1') {
  const staged = await service.stage(dirSource(id, version), 7);
  if (!staged.ok) throw new Error(staged.error);
  expect(await service.commit(staged.preview.token, 7)).toEqual({ ok: true, enabled: true });
}

function writeLegacyRecord(root: string, record: Partial<PluginRecord>) {
  const pkg = join(root, 'packages', 'collabra.notes', 'legacy');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'enso-plugin.json'), JSON.stringify(manifestOf('collabra.notes', '1')));
  writeFileSync(join(pkg, 'main.mjs'), 'export function activate() {}');
  writeFileSync(
    join(root, 'registry.json'),
    JSON.stringify({
      version: 1,
      plugins: [
        {
          id: 'collabra.notes',
          version: '1',
          dir: 'legacy',
          state: 'enabled' as const,
          grant: {
            permissions: [],
            fsRead: [],
            fsWrite: [],
            netDomains: [],
            mcp: [],
            mcpTools: [],
            renderer: false,
            env: [],
            interop: [],
            intercepts: [],
            resident: false,
            styles: false,
          },
          installedAt: 1,
          ...record,
        },
      ],
    })
  );
}
void PLUGIN_STATES;

describe('市场来源身份', () => {
  it('新市场安装把 marketId 写进 Main 的权威来源记录', async () => {
    const { market } = fakeMarket();
    const { service, root } = setup({ market });
    const preview = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    if (!preview.ok) throw new Error(preview.error);
    await service.commit(preview.preview.token, 7);
    expect(readRegistry(root).plugins[0].source).toEqual({
      kind: 'market',
      id: 'collabra.notes',
      marketId: 'collabra',
    });
    expect(service.list().plugins[0].source).toEqual({
      kind: 'market',
      marketId: 'collabra',
    });
  });

  it('renderer 指定别的市场身份时拒绝，不去下载', async () => {
    const { market, stub } = fakeMarket();
    const { service } = setup({ market });
    const r = await service.stage({ kind: 'market', id: 'collabra.notes', marketId: 'enso' }, 7);
    expect(r.ok).toBe(false);
    expect(!r.ok && /市场/.test(r.error)).toBe(true);
    expect(stub.download).not.toHaveBeenCalled();
  });

  it('本地目录安装的同 id 插件不会被市场条目 claim，也不能从市场覆盖', async () => {
    const { market, stub } = fakeMarket({ latest: '2' });
    const { service } = setup({ market });
    await installDir(service, 'collabra.notes');
    expect(stub.index).not.toHaveBeenCalled();
    expect(await service.checkUpdates()).toEqual({ checked: 0, available: 0, failed: 0 });
    expect(stub.index).not.toHaveBeenCalled();
    expect(stub.download).not.toHaveBeenCalled();
    expect(service.list().plugins[0]).toMatchObject({ version: '1' });
    expect(service.list().plugins[0].availableVersion).toBeUndefined();
    const blocked = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && /来源/.test(blocked.error)).toBe(true);
    expect(stub.download).not.toHaveBeenCalled();
  });

  it('历史无 marketId 的市场记录仍可读取，但不 fetch、不更新、不 restage', async () => {
    const { market, stub } = fakeMarket({ latest: '2' });
    const root = temp();
    writeLegacyRecord(root, { source: { kind: 'market', id: 'collabra.notes' } });
    const { service } = setup({ market }, root);
    expect(service.list().registryError).toBeUndefined();
    expect(service.list().plugins[0]).toMatchObject({
      version: '1',
      source: { kind: 'market' },
    });
    expect(await service.checkUpdates()).toEqual({ checked: 0, available: 0, failed: 0 });
    expect(stub.index).not.toHaveBeenCalled();
    expect(stub.download).not.toHaveBeenCalled();
    const restage = await service.restage('collabra.notes', 7);
    expect(restage.ok).toBe(false);
    expect(!restage.ok && /旧版|旧/.test(restage.error)).toBe(true);
    expect(stub.index).not.toHaveBeenCalled();
  });

  it('市场暂存后别的窗口以目录安装同 id：commit 必须拒绝并保留原记录与数据', async () => {
    const { market } = fakeMarket({ latest: '2' });
    const { service, root } = setup({ market });
    const marketStaged = await service.stage(
      { kind: 'market', id: 'collabra.notes', version: '2' },
      7
    );
    if (!marketStaged.ok) throw new Error(marketStaged.error);
    // 另一个窗口从本地目录安装同名插件
    const dir = dirSource('collabra.notes', '1');
    const dirStaged = await service.stage(dir, 8);
    if (!dirStaged.ok) throw new Error(dirStaged.error);
    expect(await service.commit(dirStaged.preview.token, 8)).toEqual({ ok: true, enabled: true });
    const before = readRegistry(root).plugins[0];
    const committed = await service.commit(marketStaged.preview.token, 7);
    expect(committed.ok).toBe(false);
    expect(committed.error).toMatch(/来源/);
    // 权威记录、启停状态、来源与安装目录全部保持原样
    const after = readRegistry(root).plugins[0];
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      version: '1',
      state: 'enabled',
      source: { kind: 'dir', path: dir.path },
    });
    expect(existsSync(join(root, 'packages', 'collabra.notes', after.dir))).toBe(true);
    // 被拒绝的市场暂存已清理，不能重试提交
    expect((await service.commit(marketStaged.preview.token, 7)).ok).toBe(false);
  });

  it('属于当前市场的记录照常检查并自动更新', async () => {
    const fake = fakeMarket({ latest: '1' });
    const { service } = setup({ market: fake.market });
    const preview = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    if (!preview.ok) throw new Error(preview.error);
    await service.commit(preview.preview.token, 7);
    await service.setEnabled('collabra.notes', true);
    fake.state.latest = '2';
    expect(await service.checkUpdates()).toEqual({ checked: 1, available: 0, failed: 0 });
    expect(service.list().plugins[0].version).toBe('2');
    const restage = await service.restage('collabra.notes', 7);
    expect(restage.ok).toBe(true);
  });

  it('从来源重装会刷新到当前 latest，不沿用自动更新留下的旧 version', async () => {
    const fake = fakeMarket({ latest: '1' });
    const { service, root } = setup({ market: fake.market });
    const first = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    if (!first.ok) throw new Error(first.error);
    await service.commit(first.preview.token, 7);
    await service.setEnabled('collabra.notes', true);
    fake.state.latest = '2';
    expect(await service.checkUpdates()).toEqual({ checked: 1, available: 0, failed: 0 });
    expect(readRegistry(root).plugins[0].source).toMatchObject({
      kind: 'market',
      marketId: 'collabra',
      version: '2',
    });
    fake.state.latest = '3';
    const restaged = await service.restage('collabra.notes', 7);
    if (!restaged.ok) throw new Error(restaged.error);
    expect(restaged.preview.version).toBe('3');
  });

  it('市场下载的版本必须与包内清单一致，否则拒绝安装', async () => {
    const fake = fakeMarket({ latest: '1' });
    fake.stub.download.mockImplementation(
      async (id: string, _version: string | undefined, dest: string) => {
        // 索引说 1，包里却是 2：签名目录描述与真实包不符
        writeFileSync(dest, packageOf(id, '2'));
        return { ok: true as const, version: '1' };
      }
    );
    const { service } = setup({ market: fake.market });
    const staged = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    expect(staged.ok).toBe(false);
    expect(!staged.ok && /版本/.test(staged.error)).toBe(true);
    expect(service.list().plugins).toHaveLength(0);
  });

  it('marketList 按来源判断已安装，而不是只看 id', async () => {
    const { market } = fakeMarket({
      latest: '1',
      testedSurfaces: ['code', 'settings'],
      plugins: [],
    });
    const { service } = setup({ market });
    await installDir(service, 'collabra.notes');
    const list = await service.marketList(false);
    if (!list.ok) throw new Error(list.error);
    expect(list.marketId).toBe('collabra');
    expect(list.plugins[0]).toMatchObject({
      id: 'collabra.notes',
      installedSource: 'other',
      updateAvailable: false,
      compatibility: {
        minAppVersion: '0.2.80',
        testedSurfaces: ['code', 'settings'],
      },
    });
    expect(list.plugins[0].installedVersion).toBeUndefined();
  });

  it('当前市场安装的条目显示已装版本', async () => {
    const { market } = fakeMarket({ latest: '1' });
    const { service } = setup({ market });
    const preview = await service.stage({ kind: 'market', id: 'collabra.notes' }, 7);
    if (!preview.ok) throw new Error(preview.error);
    await service.commit(preview.preview.token, 7);
    const list = await service.marketList(false);
    if (!list.ok) throw new Error(list.error);
    expect(list.plugins[0].installedVersion).toBe('1');
    expect(list.plugins[0].installedSource).toBeUndefined();
  });
});

/** 真实 PluginMarket + 签名索引 fixture：验证新市场协议能被完整安装 */
function signedMarketFixture(options: { marketId?: string } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const packages = new Map<string, Buffer>();
  const addPackage = (id: string, version: string) => {
    const bytes = packageOf(id, version);
    packages.set(`packages/${id}/${version}.zip`, bytes);
    return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const compatibility = (over: Record<string, unknown> = {}) => ({
    host: 'collabra',
    apiVersion: 1,
    minAppVersion: '0.2.80',
    platforms: ['darwin', 'win32', 'linux'],
    testedSurfaces: ['code'],
    ...over,
  });
  const paper10 = addPackage('collabra.paper', '1.0.0');
  const paper20 = addPackage('collabra.paper', '2.0.0');
  const windows = addPackage('collabra.windows', '1.0.0');
  const value = {
    schemaVersion: 2,
    marketId: options.marketId ?? 'collabra',
    generatedAt: '2026-01-01T00:00:00.000Z',
    sequence: 1,
    plugins: [
      {
        id: 'collabra.paper',
        name: 'Collabra Paper',
        description: 'Original neutral theme',
        tier: 'official',
        category: 'themes',
        tags: ['theme'],
        latest: '2.0.0',
        versions: [
          {
            version: '1.0.0',
            permissions: [],
            path: 'packages/collabra.paper/1.0.0.zip',
            ...paper10,
            compatibility: compatibility(),
          },
          {
            version: '2.0.0',
            permissions: [],
            path: 'packages/collabra.paper/2.0.0.zip',
            ...paper20,
            compatibility: compatibility({ minAppVersion: '9.0.0' }),
          },
        ],
      },
      {
        id: 'collabra.windows',
        name: 'Windows only',
        description: '',
        tier: 'community',
        tags: [],
        versions: [
          {
            version: '1.0.0',
            permissions: [],
            path: 'packages/collabra.windows/1.0.0.zip',
            ...windows,
            compatibility: compatibility({ platforms: ['win32'] }),
          },
        ],
      },
    ],
  };
  const index = Buffer.from(JSON.stringify(value));
  const sig = Buffer.from(sign(null, index, privateKey).toString('base64'));
  const fetch: MarketFetch = async (url) => {
    const path = new URL(url).pathname.split('/collabra-plugins/v1/')[1] ?? '';
    const body =
      path === 'index.json' ? index : path === 'index.json.sig' ? sig : packages.get(path);
    if (!body)
      return {
        status: 404,
        headers: new Headers(),
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    return {
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(body));
          c.close();
        },
      }),
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  };
  return { publicPem, fetch };
}

describe('新市场 fixture 端到端', () => {
  const realMarket = (root: string, platform = 'darwin', overrides: { marketId?: string } = {}) => {
    const fixture = signedMarketFixture(overrides);
    return {
      fixture,
      market: new PluginMarket({
        root,
        marketId: 'collabra',
        fetch: fixture.fetch,
        resolve: async () => [{ address: '93.184.216.34', family: 4 as const }],
        hostVersion: '0.2.80',
        platform,
        publicKeys: [fixture.publicPem],
        sources: () => ['https://tingyuxuan123.github.io/collabra-plugins/v1/'],
        builtin: null,
      }),
    };
  };

  it('目录按兼容性挑版本、显示真实覆盖信息，并能完整安装', async () => {
    const root = temp();
    const { market } = realMarket(root);
    const { service } = setup({ market }, root);
    const list = await service.marketList(true);
    if (!list.ok) throw new Error(list.error);
    expect(list.marketId).toBe('collabra');
    expect(list.plugins.map((p) => [p.id, p.latest])).toEqual([['collabra.paper', '1.0.0']]);
    expect(list.plugins[0].compatibility).toEqual({
      minAppVersion: '0.2.80',
      testedSurfaces: ['code'],
    });
    const preview = await service.stage({ kind: 'market', id: 'collabra.paper' }, 7);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.preview).toMatchObject({ id: 'collabra.paper', version: '1.0.0' });
    expect(await service.commit(preview.preview.token, 7)).toEqual({ ok: true, enabled: true });
    expect(readRegistry(root).plugins[0]).toMatchObject({
      id: 'collabra.paper',
      version: '1.0.0',
      source: { kind: 'market', id: 'collabra.paper', marketId: 'collabra' },
    });
  });

  it('平台不匹配的插件不出现在目录里，也不能被安装', async () => {
    const root = temp();
    const { market } = realMarket(root, 'darwin');
    const { service } = setup({ market }, root);
    const list = await service.marketList(true);
    if (!list.ok) throw new Error(list.error);
    expect(list.plugins.map((p) => p.id)).not.toContain('collabra.windows');
    const blocked = await service.stage({ kind: 'market', id: 'collabra.windows' }, 7);
    expect(blocked.ok).toBe(false);
  });

  it('签名索引声明的不是 collabra 市场时整份目录拒绝', async () => {
    const root = temp();
    const { market } = realMarket(root, 'darwin', { marketId: 'enso' });
    const { service } = setup({ market }, root);
    const list = await service.marketList(true);
    expect(list.ok).toBe(false);
  });
});
