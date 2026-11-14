import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MARKET_ID,
  MARKET_PAGES_BASE,
  type MarketFetch,
  marketSources,
  PluginMarket,
} from './market';
import { isMarketCompatible } from './marketIndex';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const zip = Buffer.from('PK-fake-zip');
const sha = createHash('sha256').update(zip).digest('hex');

const indexOf = (sequence: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  marketId: MARKET_ID,
  generatedAt: '',
  sequence,
  plugins: [
    {
      id: 'enso.notes',
      name: 'Notes',
      tier: 'official',
      versions: [
        {
          version: '1.0.0',
          path: 'packages/enso.notes/1.0.0.zip',
          sha256: sha,
          size: zip.length,
          compatibility: {
            host: 'collabra',
            apiVersion: 1,
            minAppVersion: '0.2.80',
            platforms: ['darwin', 'win32', 'linux'],
            testedSurfaces: [],
          },
          ...over,
        },
      ],
    },
  ],
});
const signed = (value: unknown) => {
  const index = Buffer.from(JSON.stringify(value));
  return { index, sig: Buffer.from(sign(null, index, privateKey).toString('base64')) };
};

const temps: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-market-'));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 每个源一张路径→内容表；不在表里返回 404，值为 'down' 时抛网络错误 */
function fakeFetch(
  sites: Record<string, Record<string, Buffer> | 'down'>,
  log: string[] = []
): MarketFetch {
  return async (url) => {
    log.push(url);
    const base = Object.keys(sites).find((b) => url.startsWith(b));
    const site = base ? sites[base] : undefined;
    if (!base || site === 'down') throw new Error('network');
    const body = site?.[url.slice(base.length)];
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
}

const site = (seq: number, extra: Record<string, Buffer> = {}) => {
  const s = signed(indexOf(seq));
  return {
    'index.json': s.index,
    'index.json.sig': s.sig,
    'packages/enso.notes/1.0.0.zip': zip,
    ...extra,
  };
};

const market = (
  root: string,
  fetch: MarketFetch,
  sources = ['https://a/v1/', 'https://b/v1/'],
  builtin = null as null | { index: string; signature: string },
  platform = 'darwin'
) =>
  new PluginMarket({
    root,
    marketId: MARKET_ID,
    fetch,
    // fork：下载前要校验并钉住公网地址；测试用固定公网 IP 代替真实 DNS
    resolve: async () => [{ address: '93.184.216.34', family: 4 as const }],
    hostVersion: '0.2.80',
    platform,
    publicKeys: [publicPem],
    sources: () => sources,
    builtin,
  });

describe('marketSources', () => {
  it('自有 Pages 始终是主源，镜像只有 raw 与可选 jsDelivr，不再有旧 Worker', () => {
    const off = marketSources(false);
    const on = marketSources(true);
    expect(off[0]).toBe(MARKET_PAGES_BASE);
    expect(on[0]).toBe(MARKET_PAGES_BASE);
    expect(off.some((url) => url.includes('j3.do'))).toBe(false);
    expect(off.some((url) => url.includes('raw.githubusercontent.com'))).toBe(true);
    expect(on.findIndex((u) => u.includes('jsdelivr'))).toBeLessThan(
      on.findIndex((u) => u.includes('githubusercontent'))
    );
    expect(off.findIndex((u) => u.includes('githubusercontent'))).toBeLessThan(
      off.findIndex((u) => u.includes('jsdelivr'))
    );
    // 镜像不是独立市场：都以同一 v1/ 结尾，指向同一份 index
    for (const url of [...off, ...on]) expect(url.endsWith('/v1/')).toBe(true);
  });
});

describe('PluginMarket.index', () => {
  it('市场身份是 collabra', () => {
    expect(market(temp(), fakeFetch({})).marketId).toBe('collabra');
  });

  it('第一个源挂了用下一个', async () => {
    const log: string[] = [];
    const m = market(temp(), fakeFetch({ 'https://a/v1/': 'down', 'https://b/v1/': site(3) }, log));
    const r = await m.index();
    expect(r.ok && r.index.sequence).toBe(3);
    expect(log[0]).toBe('https://a/v1/index.json');
  });

  it('签名被篡改的源被跳过', async () => {
    const bad = site(9);
    bad['index.json'] = Buffer.from(bad['index.json'].toString().replace('Notes', 'Evil'));
    const r = await market(
      temp(),
      fakeFetch({ 'https://a/v1/': bad, 'https://b/v1/': site(3) })
    ).index();
    expect(r.ok && r.index.sequence).toBe(3);
  });

  it('全部源失败时用磁盘缓存；拒绝比已见更旧的索引', async () => {
    const root = temp();
    await market(root, fakeFetch({ 'https://a/v1/': site(5) })).index();
    const offline = await market(root, fakeFetch({})).index();
    expect(offline.ok && offline.index.sequence).toBe(5);
    expect(offline.ok && offline.stale).toBe(true);
    const rollback = await market(root, fakeFetch({ 'https://a/v1/': site(4) })).index({
      refresh: true,
    });
    expect(rollback.ok && rollback.index.sequence).toBe(5);
  });

  it('缓存与 sequence 按 marketId 隔离，旧上游缓存不会阻断新市场', async () => {
    const root = temp();
    // 旧上游（enso）缓存：不同目录、sequence 更大
    mkdirSync(join(root, 'market'), { recursive: true });
    writeFileSync(join(root, 'market', 'state.json'), JSON.stringify({ maxSequence: 999 }));
    const legacy = signed(indexOf(999, { marketId: 'collabra' }));
    writeFileSync(join(root, 'market', 'index.json'), legacy.index);
    writeFileSync(join(root, 'market', 'index.json.sig'), legacy.sig);
    const r = await market(root, fakeFetch({ 'https://a/v1/': site(5) })).index();
    expect(r.ok && r.index.sequence).toBe(5);
    expect(readFileSync(join(root, 'market', 'collabra', 'state.json'), 'utf8')).toContain('5');
    // 新市场的缓存只写在自己的目录里
    expect(readFileSync(join(root, 'market', 'collabra', 'index.json'))).toEqual(
      signed(indexOf(5)).index
    );
  });

  it('同一个 marketId 的旧 sequence 仍然防回滚', async () => {
    const root = temp();
    await market(root, fakeFetch({ 'https://a/v1/': site(7) })).index();
    const stale = await market(root, fakeFetch({ 'https://a/v1/': site(6) })).index({
      refresh: true,
    });
    expect(stale.ok && stale.index.sequence).toBe(7);
  });

  it('没有缓存时用内置索引，内置索引同样验签且必须是同一市场', async () => {
    const s = signed(indexOf(2));
    const good = await market(temp(), fakeFetch({}), undefined, {
      index: s.index.toString(),
      signature: s.sig.toString(),
    }).index();
    expect(good.ok && good.index.marketId).toBe('collabra');
    const bad = await market(temp(), fakeFetch({}), undefined, {
      index: s.index.toString(),
      signature: 'AAAA',
    }).index();
    expect(bad.ok).toBe(false);
    const foreign = signed({ ...indexOf(2), marketId: 'enso' });
    const r = await market(temp(), fakeFetch({}), undefined, {
      index: foreign.index.toString(),
      signature: foreign.sig.toString(),
    }).index();
    expect(r.ok).toBe(false);
  });

  it('不 refresh 时复用内存结果', async () => {
    const log: string[] = [];
    const m = market(temp(), fakeFetch({ 'https://a/v1/': site(1) }, log));
    await m.index();
    await m.index();
    expect(log.filter((u) => u.endsWith('index.json'))).toHaveLength(1);
  });
});

describe('PluginMarket.download', () => {
  it('下载并校验 sha256；源返回被篡改的包时换下一个源', async () => {
    const root = temp();
    const evil = site(1, { 'packages/enso.notes/1.0.0.zip': Buffer.from('PK-evil-zip') });
    const m = market(root, fakeFetch({ 'https://a/v1/': evil, 'https://b/v1/': site(1) }));
    const dest = join(root, 'x.zip');
    const r = await m.download('enso.notes', undefined, dest);
    expect(r).toEqual({ ok: true, version: '1.0.0' });
    expect(readFileSync(dest).equals(zip)).toBe(true);
  });

  it('所有源的包都不符时失败；未知插件或版本报错', async () => {
    const root = temp();
    const evil = site(1, { 'packages/enso.notes/1.0.0.zip': Buffer.from('PK-evil-zip') });
    const m = market(root, fakeFetch({ 'https://a/v1/': evil }));
    expect((await m.download('enso.notes', undefined, join(root, 'x.zip'))).ok).toBe(false);
    expect((await m.download('enso.nope', undefined, join(root, 'y.zip'))).ok).toBe(false);
    expect((await m.download('enso.notes', '9.9.9', join(root, 'z.zip'))).ok).toBe(false);
  });

  it('不兼容平台/版本的包不能被下载安装', async () => {
    const root = temp();
    const onlyWindows = site(1, {});
    const value = indexOf(1);
    (value.plugins[0].versions[0].compatibility as { platforms: string[] }).platforms = ['win32'];
    const s = signed(value);
    onlyWindows['index.json'] = s.index;
    onlyWindows['index.json.sig'] = s.sig;
    const r = await market(root, fakeFetch({ 'https://a/v1/': onlyWindows })).download(
      'enso.notes',
      undefined,
      join(root, 'w.zip')
    );
    expect(r.ok).toBe(false);
  });
});

describe('PluginMarket.mirror', () => {
  it('国内镜像开关持久化，且不影响市场身份', () => {
    const root = temp();
    market(root, fakeFetch({})).setChinaMirror(true);
    const again = market(root, fakeFetch({}));
    expect(again.chinaMirror()).toBe(true);
    expect(again.marketId).toBe(MARKET_ID);
  });
});

describe('PluginMarket.readme', () => {
  const guide = Buffer.from('# Guide\n');
  const withReadme = (readme: Record<string, unknown>) => {
    const value = indexOf(1);
    (value.plugins[0] as Record<string, unknown>).readme = readme;
    const s = signed(value);
    return market(
      temp(),
      fakeFetch({
        'https://a/v1/': {
          'index.json': s.index,
          'index.json.sig': s.sig,
          'packages/enso.notes/1.readme.md': guide,
        },
      })
    );
  };

  it('校验通过后返回文本', async () => {
    const m = withReadme({
      path: 'packages/enso.notes/1.readme.md',
      sha256: createHash('sha256').update(guide).digest('hex'),
      size: guide.length,
    });
    expect(await m.readme('enso.notes')).toEqual({ ok: true, markdown: '# Guide\n' });
  });

  it('sha256 不符时失败，不返回正文', async () => {
    const m = withReadme({
      path: 'packages/enso.notes/1.readme.md',
      sha256: 'a'.repeat(64),
      size: guide.length,
    });
    expect(await m.readme('enso.notes')).toEqual({ ok: false, error: '使用说明校验失败' });
  });

  it('路径不合法的字段被丢弃，当作没有使用说明', async () => {
    const m = withReadme({
      path: '../secret.md',
      sha256: createHash('sha256').update(guide).digest('hex'),
      size: guide.length,
    });
    expect(await m.readme('enso.notes')).toEqual({ ok: false, error: '没有使用说明' });
  });
});

describe('isMarketCompatible', () => {
  it('缺失字段一律不兼容', () => {
    const base = {
      host: 'collabra',
      apiVersion: 1,
      minAppVersion: '0.2.80',
      platforms: ['darwin'],
      testedSurfaces: [],
    };
    const host = { hostVersion: '0.2.80', platform: 'darwin' };
    expect(isMarketCompatible(base as never, host)).toBe(true);
    expect(isMarketCompatible({ ...base, apiVersion: 2 } as never, host)).toBe(false);
    expect(isMarketCompatible({ ...base, host: 'enso' } as never, host)).toBe(false);
    expect(isMarketCompatible({ ...base, platforms: ['linux'] } as never, host)).toBe(false);
    expect(isMarketCompatible({ ...base, minAppVersion: '0.3.0' } as never, host)).toBe(false);
    expect(isMarketCompatible({ ...base, maxAppVersion: '0.2.79' } as never, host)).toBe(false);
  });
});
